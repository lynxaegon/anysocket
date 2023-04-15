const EventEmitter = require("events");

module.exports = class UWSSocket extends EventEmitter {
    constructor(socket) {
        super();
        this.socket = socket;
    }

    send(message) {
        if(this.socket) {
            this.socket.send(message);
        }
    }

    close() {
        if(this.socket) {
            try {
                this.socket.close();
            }
            catch(e) {
                // ignored
            }
            this.socket = null;
        }
    }

    terminate() {
        this.close();
    }
};