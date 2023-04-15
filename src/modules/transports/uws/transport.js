const AbstractTransport = require("../abstract/AbstractTransport");
const Peer = require("./peer.js");
const uWebSocket = require("uWebSockets.js");
const UWSSocket = require("./uws_socket");

class UWS extends AbstractTransport {
    static scheme() {
        return "uws";
    }

    onListen() {
        return new Promise((resolve, reject) => {
            this.ws = uWebSocket.App().ws("/*", {
                sendPingsAutomatically: false,
                open: (socket) => {
                    socket._uwssocket = new UWSSocket(socket)
                    this.addPeer(new Peer(socket._uwssocket));
                },
                message: (socket, message, isBinary) => {
                    socket._uwssocket.emit("message", String.fromCharCode.apply(null, new Uint8Array(message)));
                },
                close: (socket, code, message) => {
                    socket._uwssocket.emit("close");
                    reject(code);
                }
            }).listen(this.options.ip, this.options.port, (listenSocket) => {
                if(listenSocket) {
                    resolve();
                } else {
                    reject("Error!" + listenSocket);
                }
            });
        });
    }

    onConnect(plain) {
        return new Promise((resolve, reject) => {
            reject("Not implemented!")
            // let connected = false;
            // let opts = null;
            // if(this.options.cookies) {
            //     opts = {
            //         headers: {
            //             Cookie: this._formatCookies(this.options.cookies)
            //         }
            //     }
            // }
            // let ws = new WebSocket((plain ? "ws" : "wss") + '://' + this.options.ip + ':' + this.options.port + '/', opts);
            // ws.on('open', socket => {
            //     connected = true;
            //     this.addPeer(new Peer(ws));
            //     resolve();
            // });
            //
            // ws.on('error', err => {
            //     if (!plain && !connected) {
            //         this.onConnect(true).then(resolve).catch(reject)
            //     } else {
            //         reject(err);
            //     }
            //     connected = false;
            // });
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

    _formatCookies(cookies) {
        let cookieString = [];
        for(let key in cookies) {
            cookieString.push(key+"="+cookies[key]);
        }
        return cookieString.join("; ");
    }
}
module.exports = UWS;