const AbstractTransport = require("../abstract/AbstractTransport");
const Peer = require("./peer.js");
const WebSocket = require("ws");

class WS extends AbstractTransport {
    constructor(anysocket, options) {
        super(anysocket, options);
    }

    [AbstractTransport._private.serverStart]() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket.Server({
                port: this.options.server.port,
                host: this.options.server.host ? this.options.server.host : "0.0.0.0"
            });
            this.ws.on('connection', socket => {
                this[AbstractTransport._private.addPeer](new Peer(socket));
            });

            this.ws.on('error', err => {
                console.error("Unhandled WS Error:", err);
                reject(err);
            });

            this.ws.on('listening', () => {
                resolve();
            });
        });
    }

    [AbstractTransport._private.serverStop]() {
        return new Promise((resolve, reject) => {
            console.log("stopped");
            this.ws.close();
            this.ws = null;
            resolve();
        });
    }

    [AbstractTransport._private.clientStart]() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket('ws://'+ this.options.client.host +'/');

            this.ws.on('open', socket => {
                this[AbstractTransport._private.addPeer](new Peer(this.ws));
            });

            resolve();
        });
    }

    [AbstractTransport._private.clientStop]() {
        return new Promise((resolve, reject) => {
            this.ws.close();
            this.ws = null;
            resolve();
        });
    }
}

module.exports = WS;