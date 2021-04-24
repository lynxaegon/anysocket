const AbstractTransport = require("../abstract/AbstractTransport");
const Peer = require("./peer.js");
const WebSocket = require("ws");
const https = require("https");
const fs = require("fs");

class WSS extends AbstractTransport {
    constructor(type, options) {
        super(type, options);
    }

    static scheme() {
        return "wss";
    }

    onListen() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket.Server({
                server: https.createServer({
                    key: fs.readFileSync(this.options.key).toString(),
                    cert: fs.readFileSync(this.options.cert).toString(),
                    port: this.options.port,
                    host: this.options.ip
                })
            });
            this.ws.on('connection', socket => {
                this.addPeer(new Peer(socket));
            });

            this.ws.on('error', err => {
                reject(err);
            });

            this.ws.on('listening', () => {
                resolve();
            });
        });
    }

    onConnect() {
        return new Promise((resolve, reject) => {
            let ws = new WebSocket(WSS.scheme() + '://' + this.options.ip + ':' + this.options.port + '/');

            ws.on('open', socket => {
                this.addPeer(new Peer(ws));
                resolve();
            });

            ws.on('error', err => {
                reject(err);
            });
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
module.exports = WSS;