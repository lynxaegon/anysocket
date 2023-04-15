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
            this.ws = new WebSocket.Server({
                server: this.options.server
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

    onConnect(plain) {
        return new Promise((resolve, reject) => {
            let connected = false;
            let opts = this.getOptions();
            let ws = new WebSocket((plain ? "ws" : "wss") + '://' + this.options.ip + ':' + this.options.port + '/', opts);
            ws.on('open', socket => {
                connected = true;
                this.addPeer(new Peer(ws));
                resolve();
            });

            ws.on('error', err => {
                if (!plain && !connected) {
                    this.onConnect(true).then(resolve).catch(reject)
                } else {
                    reject(err);
                }
                connected = false;
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

    getOptions() {
        let opts = {};
        if(this.options.cookies) {
            opts = Object.assign(opts, {
                headers: {
                    Cookie: this._formatCookies(this.options.cookies)
                }
            });
        }
        if(this.options.handshakeTimeout) {
            opts = Object.assign(opts, {
                handshakeTimeout: this.options.handshakeTimeout
            });
        }

        return opts;
    }

    _formatCookies(cookies) {
        let cookieString = [];
        for(let key in cookies) {
            cookieString.push(key+"="+cookies[key]);
        }
        return cookieString.join("; ");
    }
}
module.exports = WS;