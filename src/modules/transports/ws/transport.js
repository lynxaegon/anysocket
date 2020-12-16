const AbstractTransport = require("../abstract/AbstractTransport");
const Peer = require("./peer.js");
const WebSocket = require("ws");

class WS extends AbstractTransport {
    constructor(anysocket, options) {
        super(anysocket, options);
    }

    serverStart() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket.Server({
                port: this.options.server.port,
                host: this.options.server.host ? this.options.server.host : "0.0.0.0"
            });
            this.ws.on('connection', socket => {
                this.addPeer(new Peer(socket));
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

    serverStop() {
        return new Promise((resolve, reject) => {
            console.log("stopped");
            this.ws.close();
            this.ws = null;
            resolve();
        });
    }

    clientStart() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket('ws://' + this.options.client.host + '/');

            this.ws.on('open', socket => {
                this.addPeer(new Peer(this.ws));
            });

            resolve();
        });
    }

    clientStop() {
        return new Promise((resolve, reject) => {
            this.ws.close();
            this.ws = null;
            resolve();
        });
    }
}

module.exports = WS;