module.exports = class BrowserWS {
    constructor(...args) {
        this.ws = new WebSocket(...args);
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
                    fnc(packet.data);
                };
                break;
            case "close":
                this.ws.onclose = fnc;
                break;
            default:
                throw new Error("Not implemented in browser! (" + event + ")");
        }
    }

    send(...args) {
        this.ws.send(args);
    }

    close() {
        this.ws.close();
    }

    terminate() {
        // do nothing
    }
};