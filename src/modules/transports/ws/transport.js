const AbstractTransport = require("../abstract/AbstractTransport");
const Peer = require("./peer.js");
const WebSocket = require("ws");

class WS extends AbstractTransport {
    constructor(type, options) {
        super(type, options);
    }

    static scheme() {
        return "ws";
    }

    onListen() {
        return new Promise((resolve, reject) => {
            console.log("listen", this.options);
            this.ws = new WebSocket.Server({
                port: this.options.port,
                host: this.options.ip
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

    onConnect() {
        return new Promise((resolve, reject) => {
            let ws = new WebSocket('ws://' + this.options.ip + ':' + this.options.port + '/');

            ws.on('open', socket => {
                this.addPeer(new Peer(ws));
            });

            resolve();
        });
    }

    onStop() {
        return new Promise((resolve, reject) => {
            if (this.ws) {
                this.ws.close();
                this.ws = null;
            }
            resolve();
        });
    }
}
module.exports = WS;