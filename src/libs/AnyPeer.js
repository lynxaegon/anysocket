const EventEmitter = require("events");
const _protocol = Symbol("private protocol");

module.exports = class AnyPeer extends EventEmitter {
    constructor(protocol) {
        super();

        this[_protocol] = protocol;
        this.id = protocol.peerID;
        this.connectionID = protocol.connectionID;

        protocol.on("message", (message) => {
            this.emit("message", {
                peer: this,
                data: message
            });
        });
    }

    send(message) {
        return new Promise((resolve, reject) => {
            this[_protocol].send(this[_protocol].MESSAGE_TYPE.INTERNAL, message)
                .then(resolve)
                .catch(reject);
        });
    }

    disconnect(reason) {
        reason = reason || "Unknown";
        this[_protocol].disconnect(reason);
    }
};