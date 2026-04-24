let WebSocket;
if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
    WebSocket = require("../../../browser/ws");
}
else {
    WebSocket = require("ws");
}

const AbstractTransport = require("../abstract/AbstractTransport");
const Peer = require("./peer.js");

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
                this._applyTcpKeepAlive(socket);
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
            let opts = null;
            if(this.options.cookies) {
                opts = {
                    headers: {
                        Cookie: this._formatCookies(this.options.cookies)
                    }
                }
            }
            let ws = new WebSocket((plain ? "ws" : "wss") + '://' + this.options.ip + ':' + this.options.port + '/', opts);
            ws.on('open', socket => {
                connected = true;
                this._applyTcpKeepAlive(ws);
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

    // Enable SO_KEEPALIVE on the underlying TCP socket when the embedder
    // opts in via `tcpKeepAlive: true`. Lets the kernel detect dead peers
    // without any app-level heartbeat — essential when `heartbeatEnabled`
    // is disabled on the AnyProtocol side, or as a backstop on flaky links.
    //
    // Node only exposes the initial-idle time via `setKeepAlive(enable, ms)`.
    // The probe interval and probe count come from system sysctls
    // (`net.ipv4.tcp_keepalive_intvl`, `net.ipv4.tcp_keepalive_probes`).
    // Defaults to 30s idle if not specified.
    _applyTcpKeepAlive(ws) {
        if (!this.options.tcpKeepAlive) return;
        const delay = this.options.tcpKeepAliveInitialDelay || 30000;
        try {
            const sock = (ws && ws._socket) ? ws._socket : ws;
            if (sock && typeof sock.setKeepAlive === 'function') {
                sock.setKeepAlive(true, delay);
            }
        } catch (_) { /* best effort — no-op if the socket doesn't expose it */ }
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
module.exports = WS;