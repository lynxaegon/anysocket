const EventEmitter = require("events");
const _private = {
    events: Symbol("events"),
    peers: Symbol("peers"),
    addPeer: Symbol("add"),
    changePeerID: Symbol("changeID"),
    removePeer: Symbol("remove"),
    serverStart: Symbol("serverStart"),
    serverStop: Symbol("serverStop"),
    clientStart: Symbol("clientStart"),
    clientStop: Symbol("clientStop")
};

class AbstractTransport extends EventEmitter{
    constructor(anysocket, options) {
        super();
        this.anysocket = anysocket;
        this.options = options;

        this.type = AbstractTransport.TYPE.NONE;
        this[_private.peers] = new Map();
        this.started = false;

        if(this.options.server) {
            this.type = AbstractTransport.TYPE.SERVER;
        } else if(this.options.client) {
            this.type = AbstractTransport.TYPE.CLIENT;
        } else {
            throw new Error("Invalid Transport Type!");
        }
    }

    start() {
        return new Promise((resolve, reject) => {
            if (this.started) {
                resolve();
                return;
            }

            let fnc = null;
            if(this.type == AbstractTransport.TYPE.SERVER) {
                fnc = this[_private.serverStart];
            }
            else {
                fnc = this[_private.clientStart];
            }


            fnc.bind(this)().then(() => {
                this.started = true;
                resolve();
            }).catch((err) => {
                reject(err);
            });
        });
    }

    stop() {
        return new Promise((resolve, reject) => {
            if (!this.started) {
                resolve();
                return;
            }

            let fnc = null;
            if(this.type == AbstractTransport.TYPE.SERVER) {
                fnc = this[_private.serverStop];
            }
            else {
                fnc = this[_private.clientStop];
            }

            // TODO: Check if needed, it shouldn't be needed...
            for (const peer of this[_private.peers].values()) {
                peer.disconnect("Local Connection Closed");
            }

            fnc.bind(this)().then(() => {
                this.started = false;
                resolve();
            }).catch((err) => {
                reject(err);
            });
        });
    }

    [_private.addPeer](peer) {
        const _peerSend = peer.send.bind(peer);
        peer.send = ((message) => {
            message = this.anysocket.encodeMessage(peer, message);
            return _peerSend(message);
        });

        peer.on('connected', () => {
            this[_private.peers].set(peer.connectionID, peer);
            this.emit('connected', peer);

            if(this.options.client) {
                this.emit("requestAuth", peer);
            }
        });

        peer.on('disconnected', (peer, reason) => {
            this[_private.peers].delete(peer.connectionID);
            this.emit('disconnected', peer, reason);
        });

        peer.on('authed', (peer) => {
            this.emit('authed', peer);
        });

        peer.on('message', (peer, message) => {
            this.emit('message', peer, message);
        });

        peer.init();
    }

    [_private.serverStart]() {
        throw new Error('serverStart() must be implemented');
    }

    [_private.serverStop]() {
        throw new Error('serverStop() must be implemented');
    }

    [_private.clientStart]() {
        throw new Error('clientStart() must be implemented');
    }

    [_private.clientStop]() {
        throw new Error('clientStop() must be implemented');
    }
}

module.exports = AbstractTransport;
AbstractTransport._private = _private;
AbstractTransport.TYPE = {
    NONE: 0,
    CLIENT: 1,
    SERVER: 2
};