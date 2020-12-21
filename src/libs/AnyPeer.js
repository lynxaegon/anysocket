const EventEmitter = require("events");
const Packet = require("./Packet");
const AnyPacket = require("./AnyPacket");
const _protocol = Symbol("private protocol");
const _packets = Symbol("packets");

const TIMEOUTS = {
    REPLY: 30 * 1000,
    HEARTBEAT: 5 * 1000
};
const isBoolean = function(obj) {
    return obj === true || obj === false || toString.call(obj) === '[object Boolean]';
};

module.exports = class AnyPeer extends EventEmitter {
    constructor(protocol) {
        super();

        this[_protocol] = protocol;
        this[_packets] = {};

        this.id = protocol.peerID;
        this.lag = -1;
        this.connectionID = protocol.connectionID;
        this._heartbeat = false;
        protocol.on("internal", this.onInternalComs.bind(this));
        protocol.on("message", this.onMessage.bind(this));
        protocol.on("e2e", () => {
            this.onE2E();
            this.heartbeat();
        });
    }

    heartbeat() {
        if(this._heartbeat)
            clearTimeout(this._heartbeat);
        this._heartbeat = setTimeout(() => {
            this.heartbeat();
        }, TIMEOUTS.HEARTBEAT);


        const startTime = (new Date()).getTime();
        const packet = Packet
            .data()
            .setType(this[_protocol].PACKET_TYPE.HEARTBEAT);

        this._send(packet, true).then(() => {
            this.lag = (new Date()).getTime() - startTime;
            this.emit("lag", this, this.lag);
        });
    }

    e2e() {
        clearTimeout(this._heartbeat);
        this[_protocol].e2e();
    }

    send(message, awaitReply, timeout) {
        const packet = Packet
            .data(message)
            .setType(this[_protocol].PACKET_TYPE.LINK);

        return this._send(packet, awaitReply, timeout);
    }

    onMessage(peer, message) {
        if (message.seq < 0) {
            if (!this._resolveReply(message)) {
                console.log("Dropped reply " + message.seq + ". Delivered after Timeout");
            }
            return;
        }

        this.emit("message", new AnyPacket(this, message, this.send.bind(this)));
    }

    onE2E() {
        this.emit("e2e", this);
    }

    onInternalComs(peer, message) {
        if (message.seq < 0) {
            if (!this._resolveReply(message)) {
                console.log("Dropped reply " + message.seq + ". Delivered after Timeout");
            }
            return;
        }

        if(message.type == this[_protocol].PACKET_TYPE.HEARTBEAT) {
            // reply
            const packet = Packet
                .data()
                .setType(this[_protocol].PACKET_TYPE.HEARTBEAT);
            this._send(packet, message.seq);
        } else {
            console.error("Dropped internal packet!");
            console.log(message);
        }
    }

    disconnect(reason) {
        for (let seq in this[_packets]) {
            clearTimeout(this[_packets][seq].timeout);
            this[_packets][seq].reject("Peer disconnected!");
        }
        this[_packets] = {};
        clearTimeout(this._heartbeat);

        reason = reason || "Unknown";
        this[_protocol].disconnect(reason);
    }

    _send(packet, awaitReply, timeout) {
        return new Promise((resolve, reject) => {
            if(!this[_protocol].isConnected()) {
                console.log(packet);
                reject("Cannot send message. Peer is disconnected");
                return;
            }

            if (!isBoolean(awaitReply) && awaitReply && awaitReply > 0) {
                packet.setReplyTo(awaitReply);
            }

            this[_protocol].send(packet);

            if (isBoolean(awaitReply) && awaitReply === true) {
                this[_packets][packet.seq] = {
                    time: (new Date()).getTime(),
                    resolve: resolve,
                    reject: reject,
                    timeout: setTimeout(() => {
                        if (this[_packets][packet.seq]) {
                            let msg = this[_packets][packet.seq];
                            delete this[_packets][packet.seq];
                            console.log("Dropped reply " + packet.seq + ". Timeout");
                            msg.reject("Timeout!");
                        }
                    }, timeout || TIMEOUTS.REPLY)
                };
            }
        });
    }

    _resolveReply(message) {
        message.seq *= -1;
        if (this[_packets][message.seq]) {
            const tmp = this[_packets][message.seq];
            delete this[_packets][message.seq];
            clearTimeout(tmp.timeout);
            tmp.resolve(new AnyPacket(this, message, () => {
                console.error("Cannot reply to a reply packet!");
            }));
            return true;
        }

        return false;
    }
};