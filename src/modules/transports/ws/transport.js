let WebSocket;
const inBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
if (inBrowser) {
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
                server: this.options.server,
                // `ws` allows 100MB per frame by default, which an
                // unauthenticated peer can make us buffer. Derived from the
                // frame size so raising maxPacketSize does not quietly start
                // tripping the transport limit.
                maxPayload: this._maxPayload()
            });
            this.ws.on("connection", socket => {
                this._applyTcpKeepAlive(socket);
                this.addPeer(this._peer(socket));
            });

            this.ws.on('error', err => {
                reject(err);
            });

            this.ws.on('listening', () => {
                resolve();
            });

            // ws only forwards a *future* "listening" from the server it is
            // attached to, so on a server that is already up — the http
            // transport sharing its port, or one passed in — it would wait
            // forever.
            if (this.options.server && this.options.server.listening) {
                resolve();
            }
        });
    }

    onConnect(plain) {
        return new Promise((resolve, reject) => {
            let connected = false;
            const url = (plain ? "ws" : "wss") + '://' + this.options.ip + ':' + this.options.port + '/';

            let ws;
            let timer = null;
            let timedOut = false;
            if(inBrowser) {
                // Only the URL. A browser's WebSocket reads a second argument as
                // its subprotocols and throws on anything else, so the node
                // options below broke every dial that set connectTimeout or
                // cookies. It has no handshake timeout of its own either, so
                // connectTimeout is a timer here: a dial that has not opened in
                // time is closed and treated as failed, as node treats its own
                // handshake timeout: final, or retried as plain ws when
                // allowInsecureWSFallback is set.
                ws = new WebSocket(url);
                if(this.options.connectTimeout) {
                    timer = setTimeout(() => {
                        if (connected) return;
                        timedOut = true;
                        try { ws.close(); } catch (_) {}
                        if (!plain && this.options.allowInsecureWSFallback === true) this.onConnect(true).then(resolve).catch(reject);
                        else reject(new Error("Opening handshake has timed out"));
                    }, this.options.connectTimeout);
                }
            } else {
                let opts = { maxPayload: this._maxPayload() };   // the limit we announce
                if(this.options.cookies) {
                    opts.headers = { Cookie: this._formatCookies(this.options.cookies) };
                }
                // connectTimeout means the same here as on tcp: a dial that never
                // answers is abandoned rather than left to the OS's own timeout.
                if(this.options.connectTimeout) {
                    opts.handshakeTimeout = this.options.connectTimeout;
                }
                ws = new WebSocket(url, opts);
            }

            ws.on('open', socket => {
                clearTimeout(timer);
                if (timedOut) return;
                connected = true;
                this._applyTcpKeepAlive(ws);
                this.addPeer(this._peer(ws));
                resolve();
            });

            ws.on('error', err => {
                clearTimeout(timer);
                // Closing a dial that timed out can raise an error of its own; that
                // must not start the plain-ws retry.
                if (timedOut) return;
                // A failed wss dial is final: anyone on the path can make it fail, so
                // retrying as plain ws is a downgrade they could force. Opt back in
                // with allowInsecureWSFallback: true.
                if (!plain && !connected && this.options.allowInsecureWSFallback === true) {
                    this.onConnect(true).then(resolve).catch(reject)
                } else {
                    reject(err);
                }
                connected = false;
            });

        });
    }

    // The largest message the socket takes in: a frame of maxPacketSize, with
    // 1MB of headroom for its header, an e2e tag and a relay's wrapping, and
    // never under 8MB. It used to be twice the frame size, for hex-encoded
    // payloads that are no longer sent.
    _maxPayload() {
        if (this.options.maxPayload) return this.options.maxPayload;
        const frame = this.options.maxPacketSize || 4 * 1024 * 1024;
        return Math.max(8 * 1024 * 1024, frame + 1024 * 1024);
    }

    _peer(socket) {
        const peer = new Peer(socket);
        peer.highWaterMark = this.options.sendHighWaterMark || 16 * 1024 * 1024;
        // Announced in the handshake, so the other end chunks to fit it.
        peer.maxPayload = this._maxPayload();
        return peer;
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