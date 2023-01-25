const debug = require('debug')('AnyPeer');
const constants = require("./_constants");
const EventEmitter = require("events");
const Packet = require("./Packet");
const AnyPacket = require("./AnyPacket");
const _packets = Symbol("packets");

const isBoolean = function(obj) {
    return obj === true || obj === false || toString.call(obj) === '[object Boolean]';
};

module.exports = class AnyPeer extends EventEmitter {
    constructor(protocol) {
        super();

        this.protocol = protocol;
        this[_packets] = {};

        this.id = protocol.peerID;
        this.connectionID = protocol.connectionID;
        this.options = protocol.options;

        protocol.on("internal", this.onInternalComs.bind(this));
        protocol.on("message", this.onMessage.bind(this));
        protocol.on("e2e", () => {
            this.onE2E();
        });
        protocol.on("disconnected", (peer, reason) => {
            this.emit("disconnected", peer, reason);
        });
    }



    e2e() {
        this.protocol.e2e();
    }

    isE2EEnabled() {
        return this.protocol.hasE2EEnabled();
    }

    send(message, awaitReply, timeout) {
        const packet = Packet
            .data(message)
            .setType(constants.PACKET_TYPE.LINK);

        return this._send(packet, awaitReply, timeout);
    }

    forward(packet) {
        this.protocol.forward(packet);
    }

    sendInternal(message, awaitReply, timeout) {
        // console.log("Sent internal", message, this.id);
        const packet = Packet
            .data(message)
            .setType(constants.PACKET_TYPE.INTERNAL);

        return this._send(packet, awaitReply, timeout);
    }

    onMessage(peer, message) {
        if (message.seq < 0) {
            if (!this._resolveReply(message)) {
                debug("Dropped reply " + message.seq + ". Delivered after Timeout");
            }
            return;
        }

        this.emit("message", new AnyPacket(this, message, this.send.bind(this)));
    }

    onE2E() {
        this.emit("e2e", this);
    }

    isProxy() {
        return this.protocol.isProxy();
    }

    onInternalComs(peer, message) {
        if (message.seq < 0) {
            if (!this._resolveReply(message)) {
                debug("Dropped reply " + message.seq + ". Delivered after Timeout");
            }
            return;
        }

        if (message.type == constants.PACKET_TYPE.INTERNAL) {
            this.emit("internal", new AnyPacket(this, message, this.sendInternal.bind(this)));
        }
        else {
            debug("Dropped internal packet!", message);
        }
    }

    disconnect(reason) {
        for (let seq in this[_packets]) {
            clearTimeout(this[_packets][seq].timeout);
            this[_packets][seq].reject("Peer disconnected!");
        }
        this[_packets] = {};

        this.protocol.disconnect(reason);
    }

    _send(packet, awaitReply, timeout) {
        return new Promise((resolve, reject) => {
            if(!this.protocol.isConnected()) {
                reject("Cannot send message. Peer is disconnected");
                return;
            }

            if (!isBoolean(awaitReply) && awaitReply && awaitReply > 0) {
                packet.setReplyTo(awaitReply);
            }

            this.protocol.send(packet);

            if (isBoolean(awaitReply) && awaitReply === true) {
                this[_packets][packet.seq] = {
                    time: (new Date()).getTime(),
                    resolve: resolve,
                    reject: reject,
                    timeout: setTimeout(() => {
                        if (this[_packets][packet.seq]) {
                            let msg = this[_packets][packet.seq];
                            delete this[_packets][packet.seq];
                            this.disconnect("Missed reply timeout! Packet Type: " + Packet.TYPE._string(packet.type) + " - " +  packet.seq);
                            msg.reject("Timeout!");
                        }
                    }, timeout || this.protocol.options.replyTimeout)
                };
            }
        });
    }

    _recvForward(packet) {
        this.protocol._recvPacketQueue.push({
            peer: this.protocol.peer,
            recv: packet.msg,
            state: this.protocol.ENCRYPTION_STATE
        });
    }

    _resolveReply(message) {
        message.seq *= -1;
        if (this[_packets][message.seq]) {
            const tmp = this[_packets][message.seq];
            delete this[_packets][message.seq];
            clearTimeout(tmp.timeout);
            tmp.resolve(new AnyPacket(this, message, () => {
                debug("Cannot reply to a reply packet!");
            }));
            return true;
        }

        return false;
    }
};