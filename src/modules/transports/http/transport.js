const debug = require("debug")("HTTPTransport");
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

    /**
     * Resolves with the port actually bound. Port 0 asks the OS for a free one,
     * which used to be impossible: `port || 80` turned 0 into 80.
     */
    onListen() {
        return new Promise((resolve, reject) => {
            const secure = !!(
                this.options.cert && this.options.key &&
                fs.existsSync(this.options.cert) && fs.existsSync(this.options.key)
            );
            const requested = this.options.port == null ? (secure ? 443 : 80) : this.options.port;

            if (secure) {
                this.server = https.createServer({
                    key: fs.readFileSync(this.options.key).toString(),
                    cert: fs.readFileSync(this.options.cert).toString()
                }, this._handler.bind(this));
                this.isSecure = true;
            } else {
                this.server = http.createServer(this._handler.bind(this));
            }

            // Registered before listen() so a bind failure cannot slip past.
            // Only the first outcome counts: an error after we are up is the
            // server's business, not this promise's.
            let settled = false;
            this.server.on('error', err => {
                debug("http server error", err && err.code || err);
                if (settled) return;
                settled = true;
                reject(err);
            });

            this.server.listen(requested, this.options.host || "0.0.0.0", () => {
                if (settled) return;
                settled = true;
                const address = this.server.address();
                this.port = address && typeof address == "object" ? address.port : requested;
                resolve(this.port);
            });

            this.server.on('connection', socket => {
                this.addPeer(new Peer(socket));
            });

            this.server.on("upgrade", (req, socket) => {
                this.peers.get(this._getSocket(req).connectionID).emit("upgrade", req, socket);
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