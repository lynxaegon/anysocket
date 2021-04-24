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

    _handler(req, res) {
        let socket = req.socket._parent;
        if(!socket){
            socket = req.socket;
        }

        this.peers.get(socket.connectionID).emit("message", req, res);
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
                this.server.listen(this.options.port, this.options.host, () => {
                    resolve();
                });
            } else {
                this.server = http.createServer(this._handler.bind(this));
                this.server.listen(this.options.port, this.options.host, () => {
                    resolve();
                });
            }

            this.server.on('connection', socket => {
                this.addPeer(new Peer(socket));
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