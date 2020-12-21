const EventEmitter = require("events");
const AnyPacket = require("./AnyPacket");
const _protocol = Symbol("private protocol");

module.exports = class AnyPeer extends EventEmitter {
    constructor(protocol) {
        super();

        this[_protocol] = protocol;
        this.id = protocol.peerID;
        this.connectionID = protocol.connectionID;

        protocol.on("message", (peer, message) => {
            this.emit("message", {
                peer: this,
                data: message
            });
        });

        protocol.on("e2e", (peer) => {
            this.emit("e2e", this);
        });
    }

    e2e() {
        this[_protocol].e2e();
    }

    send(message) {
        return new Promise((resolve, reject) => {
            this[_protocol].send(AnyPacket.data(message).setType(this[_protocol].PACKET_TYPE.LINK))
                .then(resolve)
                .catch(reject);
        });
    }

    disconnect(reason) {
        reason = reason || "Unknown";
        this[_protocol].disconnect(reason);
    }
};