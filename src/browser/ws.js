module.exports = class BrowserWS {
    constructor(...args) {
        this.ws = new WebSocket(...args);
        // Binary frames should arrive as bytes we can read synchronously; the
        // default is Blob, which would have to be awaited.
        this.ws.binaryType = "arraybuffer";
    }

    on(event, fnc) {
        switch (event) {
            case "open":
                this.ws.onopen = fnc;
                break;
            case "error":
                this.ws.onerror = fnc;
                break;
            case "message":
                this.ws.onmessage = (packet) => {
                    // A text message stays a string; a binary one is handed on
                    // as bytes, matching what the node transport delivers.
                    fnc(packet.data instanceof ArrayBuffer ? new Uint8Array(packet.data) : packet.data);
                };
                break;
            case "close":
                this.ws.onclose = fnc;
                break;
            default:
                throw new Error("Not implemented in browser! (" + event + ")");
        }
    }

    send(data, cb) {
        // This used to forward the whole arguments array, which the browser
        // stringified — so it only ever worked by accident for a single string
        // and would have mangled binary outright.
        this.ws.send(data);

        // The browser offers no completion callback, so report straight away.
        // Backpressure there would have to come from polling bufferedAmount.
        if (cb) cb();
    }

    close() {
        this.ws.close();
    }

    terminate() {
        // do nothing
    }
};