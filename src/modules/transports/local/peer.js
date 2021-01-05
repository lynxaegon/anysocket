const AbstractPeer = require("../abstract/AbstractPeer");

module.exports = class LocalPeer extends AbstractPeer {
    constructor() {
        super();

        this.isLocal = true;
    }
    onConnect() {
    }

    send(message) {
        return new Promise((resolve, reject) => {
            try {
                setImmediate(() => {
                    this.emit("message", this, message);
                });
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    }

    onDisconnect() {
    }
};