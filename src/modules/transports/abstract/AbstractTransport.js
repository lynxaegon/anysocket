const EventEmitter = require("events");
const Utils = require("../../../libs/utils");

class AbstractTransport extends EventEmitter {
    constructor(type, options) {
        super();

        this.id = Utils.uuidv4();
        this.options = Object.assign({
            replyTimeout: 30 * 1000,
            heartbeatTimeout: 5 * 1000,
            heartbeatInterval: 5 * 1000
        }, options);

        this.type = type;
        this.peers = new Map();
        this.started = false;
    }

    listen() {
        return new Promise((resolve, reject) => {
            if (this.started) {
                resolve();
                return;
            }

            this.onListen().then(() => {
                this.started = true;
                resolve();
            }).catch((err) => {
                reject(err);
            });
        });
    }

    connect() {
        return new Promise((resolve, reject) => {
            if (this.started) {
                resolve();
                return;
            }
            this.onConnect().then(() => {
                this.started = true;
                resolve();
            }).catch((err) => {
                reject(err);
            })
        });
    }

    stop() {
        return new Promise((resolve, reject) => {
            if (!this.started) {
                resolve();
                return;
            }
            this.started = false;

            for (const peer of this.peers.values()) {
                peer.disconnect("Local Connection Closed");
            }

            this.onStop().then(() => {
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

    onConnect() {
        throw new Error('onConnect() must be implemented');
    }

    onListen() {
        throw new Error('onListen() must be implemented');
    }

    onStop() {
        throw new Error('onStop() must be implemented');
    }

    static scheme = () => {
        throw new Error("static scheme() must be implemented");
    }
}

module.exports = AbstractTransport;
AbstractTransport.TYPE = {
    CLIENT: "client",
    SERVER: "server"
};