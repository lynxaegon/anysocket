const AbstractPeer = require("../abstract/AbstractPeer");

module.exports = class WSPeer extends AbstractPeer {
    constructor(socket) {
        super(socket);
    }

    onConnect() {
        this.socket.on("close", () => {
            this.disconnect("Remote Connection Closed");
        });

        this.socket.on("error", (err) => {
            console.log("err", err);
            this[AbstractPeer._private.events].emit("error", this, err);
        });

        this.socket.on("message", (message) => {
            this[AbstractPeer._private.events].emit("message", this, message);
        });

        this[AbstractPeer._private.events].emit("connected", this);
    }

    send(message) {
        return new Promise((resolve, reject) => {
            try {
                this.socket.send(message);
                resolve();
            }
            catch (e) {
                reject(e);
            }
        });
    }

    onDisconnect() {
        if(this.socket) {
            this.socket.close();
            this.socket = null;
        }
    }
};