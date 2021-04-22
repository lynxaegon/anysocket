const AbstractTransport = require("../abstract/AbstractTransport");
const Peer = require("./peer.js");
const http = require("http");
const https = require("https");
const fs = require("fs");

class HTTP extends AbstractTransport {
    constructor(type, options) {
        super(type, options);
        this.type = AbstractTransport.TYPE.HTTP;
    }

    static scheme() {
        return "http";
    }

    _handler(req, res) {
        this.peers.get(req.socket.connectionID).emit("message", req, res);
    }

    onListen() {
        return new Promise((resolve, reject) => {
            if(
                this.options.cert && this.options.key &&
                fs.existsSync(this.options.cert) && fs.existsSync(this.options.key)
            ) {
                this.http = https.createServer({
                    key: fs.readFileSync(this.options.key).toString(),
                    cert: fs.readFileSync(this.options.cert).toString()
                }, this._handler.bind(this));
                this.http.listen(this.options.port, this.options.host, () => {
                    resolve();
                });
            } else {
                this.http = http.createServer(this._handler.bind(this));
                this.http.listen(this.options.port, this.options.host, () => {
                    resolve();
                });
            }

            this.http.on('connection', socket => {
                this.addPeer(new Peer(socket));
            });

            this.http.on('error', err => {
                console.log("http err", err);
                reject(err);
            });
        });
    }

    onConnect() {
        throw new Error("not implemented!");
        // return new Promise((resolve, reject) => {
        //     let ws = new WebSocket('ws://' + this.options.ip + ':' + this.options.port + '/');
        //
        //     ws.on('open', socket => {
        //         this.addPeer(new Peer(ws));
        //         resolve();
        //     });
        //
        //     ws.on('error', err => {
        //         reject(err);
        //     });
        // });
    }

    onStop() {
        return new Promise((resolve) => {
            if (this.http) {
                this.http.close();
                this.http = null;
            }
            resolve();
        });
    }
}
module.exports = HTTP;