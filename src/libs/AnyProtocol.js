const EventEmitter = require("events");

const PROTOCOL_TYPE = {
    INTERNAL: "1",
    DATA: "2"
};
const PROTOCOL_ENCRYPTION = {
    PLAIN: "1",
    AES: "2",
    E2E: "3"
};
const PROTOCOL_MESSAGE_TYPE = {
    FULL: "1",
    PARTIAL: "2"
};
const MAX_PACKET_SIZE = 4000;

module.exports = class AnyProtocol extends EventEmitter {
    constructor(peer) {
        super();

        this.peerID = null;
        this.peer = peer;
        this.connectionID = this.peer.connectionID;

        this._packetQueue = [];
        this._queueRunning = false;
        this.ENCRYPTION_STATE = PROTOCOL_ENCRYPTION.PLAIN;

        this.MESSAGE_TYPE = PROTOCOL_TYPE;

        this.peer.on("message", this.onPacket.bind(this));

        if(this.peer.isClient()) {
            // init protocol
            this.send(PROTOCOL_TYPE.INTERNAL, {
                hello: "world"
            });
        }
    }

    send(protocol, packet) {
        return new Promise((resolve, reject) => {
            const rejectFnc = (e) => {
                this.peer.disconnect(e);
                reject(e);
            };
            try {
                this._queue(protocol, packet)
                    .then(resolve)
                    .catch(rejectFnc);
            } catch (e) {
                rejectFnc(e);
            }
        });
    }

    onPacket(peer, message) {
        message = this._deserialize(message);
        console.log(message);
        this.emit("message", message);
    }

    disconnect(reason) {
        this.peer.disconnect(reason);
    }

    _queue(protocol, packet) {
        return new Promise((resolve, reject) => {
            try {
                packet = [JSON.stringify(packet)];
                if (packet[0].length > MAX_PACKET_SIZE) {
                    packet = packet[0].match(/(.{1,4})/g);
                }

                console.log("serializing", packet);
                for (let i = 0; i < packet.length; i++) {
                    packet[i] = this._serialize(
                        protocol,
                        i == packet.length -1 ? PROTOCOL_MESSAGE_TYPE.FULL : PROTOCOL_MESSAGE_TYPE.PARTIAL,
                        this._encrypt(packet)
                    );
                }

                this._packetQueue.push({
                    packets: packet,
                    resolve: resolve,
                    reject: reject
                });
            } catch (e) {
                reject(e);
            }
            this._processQueue();
        });
    }

    _processQueue() {
        if (this._queueRunning == true)
            return;

        this._queueRunning = true;
        if (this._packetQueue.length > 0) {
            const item = this._packetQueue[0];
            try {
                const packet = item.packets.shift();
                if (!packet) {
                    // finished, run callbacks
                    this._packetQueue.shift();
                    item.resolve();

                    this._queueRunning = false;
                    setImmediate(this._processQueue.bind(this));
                } else {
                    this.peer.send(packet).then(() => {
                        this._queueRunning = false;
                        setImmediate(this._processQueue.bind(this));
                    }).catch((e) => {
                        this._packetQueue.shift();
                        item.reject(e);

                        this._queueRunning = false;
                        setImmediate(this._processQueue.bind(this));
                    });
                }
            } catch (e) {
                this._packetQueue.shift();
                item.reject(e);

                this._queueRunning = false;
                setImmediate(this._processQueue.bind(this));
            }
        } else {
            this._queueRunning = false;
        }
    }

    _serialize(type, msgType, message) {
        return type.toString() +
            msgType.toString() +
            this.ENCRYPTION_STATE.toString() +
            message;
    }

    _deserialize(message) {
        console.log(message);
        return {
            protocol_type: message.substr(0,1),
            message_type: message.substr(1,1),
            encryption: message.substr(2, 1),
            data: message.substr(3)
        };
    }

    _encrypt(packet) {
        switch (this.ENCRYPTION_STATE) {
            case PROTOCOL_ENCRYPTION.PLAIN:
                return packet;
            case PROTOCOL_ENCRYPTION.AES:
                return packet;
            case PROTOCOL_ENCRYPTION.E2E:
                return packet;
        }
    }

    _decrypt(packet) {
        switch (this.ENCRYPTION_STATE) {
            case PROTOCOL_ENCRYPTION.PLAIN:
                return packet;
            case PROTOCOL_ENCRYPTION.AES:
                return packet;
            case PROTOCOL_ENCRYPTION.E2E:
                return packet;
        }
    }
};