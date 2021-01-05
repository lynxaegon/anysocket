const AbstractTransport = require("../abstract/AbstractTransport");
const Peer = require("./peer.js");

class Local extends AbstractTransport {
    constructor(type, options) {
        super(type, options);
    }

    static scheme() {
        return "local";
    }

    onListen() {
        return new Promise((resolve, reject) => {
            this.addPeer(new Peer());
            resolve();
        });
    }

    onConnect() {
        return new Promise((resolve, reject) => {
            reject("Only listening is supported!");
        });
    }

    onStop() {
        return new Promise((resolve, reject) => {
            resolve();
        });
    }
}
module.exports = Local;