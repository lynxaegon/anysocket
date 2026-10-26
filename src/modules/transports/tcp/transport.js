const net = require("net");
const AbstractTransport = require("../abstract/AbstractTransport");
const Peer = require("./peer.js");

/**
 * Plain tcp. The cheapest way between two processes on a network: none of a
 * websocket's per-frame header, and no masking of every byte a client sends.
 * Not reachable from a browser, which is what ws is for.
 *
 *   server.listen("tcp", { port: 3000 })
 *   client.connect("tcp", "10.0.0.2", 3000)
 *
 * It can also share a port an http(s) server already listens on (see
 * _share): browsers and ws peers keep reaching that server, and tcp peers
 * reach anysocket, on the one port.
 */

// How long a connection on a shared port may stay silent before it is
// dropped, undecided. Both kinds of client speak first, at once.
const SHARED_SNIFF_TIMEOUT = 30000;
class TCP extends AbstractTransport {
    constructor(type, options) {
        super(type, options);
    }

    static scheme() {
        return "tcp";
    }

    /** Where to listen or dial, in the form net.Server / net.connect take. */
    _address() {
        return {
            port: this.options.port == null ? 0 : this.options.port,
            host: this.options.host || this.options.ip || "0.0.0.0"
        };
    }

    _dialAddress() {
        return { port: this.options.port, host: this.options.ip };
    }

    _peer(socket) {
        // Small protocol messages should go out as soon as they are written
        // rather than wait to be coalesced; bulk sends are corked per message.
        if (typeof socket.setNoDelay == "function") socket.setNoDelay(true);
        this._applyKeepAlive(socket);
        return new Peer(socket, this.options);
    }

    _applyKeepAlive(socket) {
        if (!this.options.tcpKeepAlive || typeof socket.setKeepAlive != "function") return;
        socket.setKeepAlive(true, this.options.tcpKeepAliveInitialDelay || 30000);
    }

    /** Resolves with the address actually bound (a port, or a path). */
    onListen() {
        if (this.options.server) {
            return this._share(this.options.server);
        }
        return new Promise((resolve, reject) => {
            this.server = net.createServer((socket) => {
                this.addPeer(this._peer(socket));
            });

            let settled = false;
            this.server.on("error", (err) => {
                if (settled) return;
                settled = true;
                reject(err);
            });

            this.server.listen(this._address(), () => {
                if (settled) return;
                settled = true;
                const address = this.server.address();
                this.port = address && typeof address == "object" ? address.port : address;
                resolve(this.port);
            });
        });
    }

    onConnect() {
        return new Promise((resolve, reject) => {
            const socket = net.connect(this._dialAddress());
            let connected = false;

            socket.once("connect", () => {
                connected = true;
                this.addPeer(this._peer(socket));
                resolve();
            });

            socket.once("error", (err) => {
                if (!connected) reject(err);
            });

            if (this.options.connectTimeout) {
                socket.setTimeout(this.options.connectTimeout, () => {
                    if (connected) return;
                    socket.destroy();
                    reject(new Error("connect timed out after " + this.options.connectTimeout + "ms"));
                });
            }
        });
    }

    /**
     * Share the port `server` already listens on.
     *
     * Each new connection is told apart by its first byte. A tcp peer opens
     * with a frame, whose u32 length starts with 0 for any first frame under
     * 16MB — and the first is an AUTH, far smaller. An http request opens with
     * a method name, a TLS handshake with 0x16: never 0. So 0 is ours, and
     * anything else goes to the server's own handlers, the bytes read put back
     * first, as though nothing had looked.
     */
    _share(server) {
        const handlers = server.listeners("connection");
        const sniff = (socket) => {
            const timer = setTimeout(() => socket.destroy(), this.options.sniffTimeout || SHARED_SNIFF_TIMEOUT);
            const onError = () => clearTimeout(timer);
            socket.once("error", onError);
            socket.once("data", (chunk) => {
                clearTimeout(timer);
                socket.removeListener("error", onError);
                socket.pause();
                socket.unshift(chunk);

                if (chunk[0] === 0x00) {
                    this.addPeer(this._peer(socket));
                } else {
                    for (const handler of handlers) handler.call(server, socket);
                }
                process.nextTick(() => socket.resume());
            });
        };

        server.removeAllListeners("connection");
        server.on("connection", sniff);
        this.shared = { server, handlers, sniff };

        const address = server.address();
        this.port = address && typeof address == "object" ? address.port : address;
        return Promise.resolve(this.port);
    }

    onStop() {
        return new Promise((resolve) => {
            if (this.shared) {
                // Give the port back to the server it belongs to.
                const { server, handlers, sniff } = this.shared;
                server.removeListener("connection", sniff);
                for (const handler of handlers) server.on("connection", handler);
                this.shared = null;
                return resolve();
            }
            if (!this.server) return resolve();
            this.server.close(() => resolve());
            this.server = null;
        });
    }
}

/**
 * A local socket: a unix domain socket, or a named pipe on Windows. Same
 * framing as tcp; for processes on one machine that should not need a port.
 *
 *   server.listen("ipc", { path: "/tmp/app.sock" })
 *   client.connect("ipc", "/tmp/app.sock")
 */
class IPC extends TCP {
    static scheme() {
        return "ipc";
    }

    _address() {
        return { path: this.options.path || this.options.ip };
    }

    _dialAddress() {
        return { path: this.options.path || this.options.ip };
    }
}

module.exports = { TCP, IPC };
