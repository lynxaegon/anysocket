const AbstractPeer = require("../abstract/AbstractPeer");

module.exports = class HTTPPeer extends AbstractPeer {
    onConnect() {
        this.socket.connectionID = this.connectionID;
        this.socket.on("close", () => {
            this.disconnect("Remote Connection Closed");
        });

        this.socket.on("error", (err) => {
            console.log("error", err);
            this.emit("error", this, err);
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
            this.socket = null;
        }
    }
};