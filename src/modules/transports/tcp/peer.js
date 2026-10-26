const AbstractPeer = require("../abstract/AbstractPeer");

/**
 * A connection over a byte stream — tcp, or a local socket.
 *
 * A stream has no message boundaries, and the protocol above needs whole
 * messages, so each one travels as a 4-byte big-endian length then its bytes,
 * and the receiving side cuts the stream back into messages. That is the whole
 * of the transport's job; everything else is the same protocol as over ws.
 */

const LENGTH_BYTES = 4;

module.exports = class StreamPeer extends AbstractPeer {
    constructor(socket, options) {
        super(socket);
        options = options || {};

        // What may sit unflushed before a send waits for the socket to drain.
        this.highWaterMark = options.sendHighWaterMark || 16 * 1024 * 1024;
        // The largest message we will allocate for. Checked against the length
        // prefix before allocating, so a peer cannot make us reserve gigabytes
        // by announcing them.
        this.maxPayload = options.maxPayload || 64 * 1024 * 1024;
        // A tighter limit for now, set by the protocol while the other end has not
        // authenticated. null for none.
        this._limit = null;

        this._chunks = [];
        this._buffered = 0;
        this._expected = -1;
    }

    onConnect() {
        this.socket.on("data", (data) => this._receive(data));

        this.socket.on("close", () => {
            this.disconnect("Remote Connection Closed");
        });

        this.socket.on("error", (err) => {
            this.emit("error", this, err);
        });
    }

    /** Cut whole messages out of whatever the stream delivered. */
    _receive(data) {
        this._chunks.push(data);
        this._buffered += data.length;

        while (true) {
            if (this._expected < 0) {
                if (this._buffered < LENGTH_BYTES) return;
                this._expected = this._take(LENGTH_BYTES).readUInt32BE(0);

                if (this._expected > (this._limit ? Math.min(this._limit, this.maxPayload) : this.maxPayload)) {
                    this.disconnect("Message too large");
                    return;
                }
            }

            if (this._buffered < this._expected) return;

            const message = this._take(this._expected);
            this._expected = -1;
            this.emit("message", this, message);

            if (!this.connected) return;
        }
    }

    limitReceive(bytes) {
        this._limit = bytes || null;
    }

    /** The next `length` buffered bytes, copying only when they span chunks. */
    _take(length) {
        this._buffered -= length;
        const first = this._chunks[0];

        if (first.length == length) {
            this._chunks.shift();
            return first;
        }
        if (first.length > length) {
            this._chunks[0] = first.subarray(length);
            return first.subarray(0, length);
        }

        const out = Buffer.allocUnsafe(length);
        let at = 0;
        while (at < length) {
            const chunk = this._chunks[0];
            const want = length - at;
            if (chunk.length <= want) {
                chunk.copy(out, at);
                at += chunk.length;
                this._chunks.shift();
            } else {
                chunk.copy(out, at, 0, want);
                this._chunks[0] = chunk.subarray(want);
                at += want;
            }
        }
        return out;
    }

    /**
     * Resolves once the socket has the message. Waits for it to drain only when
     * it has fallen behind, which bounds memory on a large transfer without
     * costing a round of latency per message.
     */
    send(message) {
        return new Promise((resolve, reject) => {
            if (!this.socket || this.socket.destroyed) {
                reject(new Error("socket closed"));
                return;
            }

            const body = typeof message == "string" ? Buffer.from(message, "utf8") : message;
            const length = Buffer.allocUnsafe(LENGTH_BYTES);
            length.writeUInt32BE(body.length, 0);

            try {
                // One packet on the wire where possible, without first joining
                // the length and the body into a new buffer.
                this.socket.cork();
                this.socket.write(length);
                const flushed = this.socket.write(body);
                this.socket.uncork();

                if (flushed || this.socket.writableLength <= this.highWaterMark) {
                    resolve();
                } else {
                    // A socket that closes before it drains never emits 'drain', and
                    // this send never settled.
                    const socket = this.socket;
                    const settle = (err) => {
                        socket.off("drain", onDrain);
                        socket.off("close", onClose);
                        if (err) reject(err);
                        else resolve();
                    };
                    const onDrain = () => settle();
                    const onClose = () => settle(new Error("socket closed"));
                    socket.once("drain", onDrain);
                    socket.once("close", onClose);
                }
            } catch (e) {
                reject(e);
            }
        });
    }

    onDisconnect() {
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
        this._chunks = [];
        this._buffered = 0;
    }
};
