const EventEmitter = require("events");

class AbstractTransport extends EventEmitter {
    constructor(options) {
        super();
        this.options = options;

        this.type = AbstractTransport.TYPE.NONE;
        this.peers = new Map();
        this.started = false;

        if (this.options.server) {
            this.type = AbstractTransport.TYPE.SERVER;
        } else if (this.options.client) {
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
            if (this.type == AbstractTransport.TYPE.SERVER) {
                fnc = this.serverStart;
            } else {
                fnc = this.clientStart;
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
            if (this.type == AbstractTransport.TYPE.SERVER) {
                fnc = this.serverStop;
            } else {
                fnc = this.clientStop;
            }

            for (const peer of this.peers.values()) {
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

    addPeer(peer) {
        peer.type = this.type;
        peer.on('connected', () => {
            this.peers.set(peer.connectionID, peer);
            this.emit('connected', peer);
        });

        peer.on('disconnected', (peer, reason) => {
            this.peers.delete(peer.connectionID);
            this.emit('disconnected', peer, reason);
        });

        peer.on('message', (peer, message) => {
            this.emit('message', peer, message);
        });

        peer.init();
    }

    serverStart() {
        throw new Error('serverStart() must be implemented');
    }

    serverStop() {
        throw new Error('serverStop() must be implemented');
    }

    clientStart() {
        throw new Error('clientStart() must be implemented');
    }

    clientStop() {
        throw new Error('clientStop() must be implemented');
    }
}

module.exports = AbstractTransport;
AbstractTransport.TYPE = {
    NONE: 0,
    CLIENT: 1,
    SERVER: 2
};