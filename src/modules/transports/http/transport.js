const AbstractTransport = require("../abstract/AbstractTransport");
const Peer = require("./peer.js");
const http = require("http");
const https = require("https");
const fs = require("fs");

class HTTP extends AbstractTransport {
    constructor(type, options) {
        super(type, options);
        this.type = AbstractTransport.TYPE.HTTP;
        this.server = null;
        this.isSecure = false;
    }

    static scheme() {
        return "http";
    }

    _getSocket(req) {
        let socket = req.socket._parent;
        if(!socket){
            socket = req.socket;
        }
        return socket
    }

    _handler(req, res) {
        this.peers.get(this._getSocket(req).connectionID).emit("message", req, res);
    }

    onListen() {
        return new Promise((resolve, reject) => {
            if(
                this.options.cert && this.options.key &&
                fs.existsSync(this.options.cert) && fs.existsSync(this.options.key)
            ) {
                this.server = https.createServer({
                    key: fs.readFileSync(this.options.key).toString(),
                    cert: fs.readFileSync(this.options.cert).toString()
                }, this._handler.bind(this));
                this.isSecure = true;
                this.server.listen(this.options.port || 443, this.options.host || "0.0.0.0", () => {
                    resolve();
                });
            } else {
                this.server = http.createServer(this._handler.bind(this));
                this.server.listen(this.options.port || 80, this.options.host || "0.0.0.0", () => {
                    resolve();
                });
            }

            this.server.on('connection', socket => {
                this.addPeer(new Peer(socket));
            });

            this.server.on("upgrade", (req, socket) => {
                this.peers.get(this._getSocket(req).connectionID).emit("upgrade", req, socket);
            });

            this.server.on('error', err => {
                console.log("http err", err);
                reject(err);
            });
        });
    }

    onConnect() {
        throw new Error("not implemented!");
    }

    onStop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close();
                this.server = null;
            }
            resolve();
        });
    }
}
module.exports = HTTP;