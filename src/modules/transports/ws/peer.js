const AbstractPeer = require("../abstract/AbstractPeer");

module.exports = class WSPeer extends AbstractPeer {
    onConnect() {
        this.socket.on("close", () => {
            this.disconnect("Remote Connection Closed");
        });

        this.socket.on("error", (err) => {
            this.emit("error", this, err);
        });

        this.socket.on("message", (message) => {
            this.emit("message", this, message);
        });
    }

    /**
     * Hand the data to the socket, waiting for it to drain only when the
     * socket has fallen behind.
     *
     * send() used to return immediately, always, so a large transfer piled up
     * in the socket's own write buffer and nothing upstream could tell. Waiting
     * for every flush instead is just as bad the other way: the send queue runs
     * one at a time, so each chunk would wait a full round of latency and
     * throughput halves.
     *
     * So: resolve straight away while the buffer is below the mark, which lets
     * the next chunk be framed and written while this one is in flight, and
     * once it is above, let the flush callback do the resolving — which is the
     * backpressure.
     */
    send(message) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const done = (err) => {
                if (settled) return;
                settled = true;
                if (err) reject(err);
                else resolve();
            };

            try {
                this.socket.send(message, done);

                const mark = this.highWaterMark || (4 * 1024 * 1024);
                if ((this.socket.bufferedAmount || 0) <= mark) {
                    done();
                }
            } catch (e) {
                done(e);
            }
        });
    }

    onDisconnect() {
        if (this.socket) {
            this.socket.close();
            this.socket.terminate();
            this.socket = null;
        }
    }
};