const AbstractPeer = require("../abstract/AbstractPeer");

module.exports = class UWSPeer extends AbstractPeer {
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

    send(message) {
        return new Promise((resolve, reject) => {
            try {
                this.socket.send(message);
                resolve();
            } catch (e) {
                reject(e);
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