const debug = require('debug')('AnyPeer');
const constants = require("./_constants");
const EventEmitter = require("events");
const Packet = require("./Packet");
const AnyPacket = require("./AnyPacket");
const AnyPacker = require("./AnyPacker");
const _protocol = Symbol("private protocol");
const _packets = Symbol("packets");
const _links = Symbol("links");
const BufferUtils = require("./utils_buffer");

const isBoolean = function (obj) {
    return obj === true || obj === false || toString.call(obj) === '[object Boolean]';
};

module.exports = class AnyPeer extends EventEmitter {
    constructor(protocol) {
        super();

        this[_links] = {};
        this[_protocol] = protocol;
        this[_packets] = {};

        this.id = protocol.peerID;
        this.connectionID = protocol.connectionID;
        this.syncedTime = null;
        this.options = protocol.options;

        const handlers = {
            get: (target, name) => {
                const prop = target[name];
                if (prop != null) {
                    return prop;
                }

                if (!target.path)
                    target.path = [];

                target.path.push(name);
                return new Proxy(target, {
                    get: handlers.get,
                    apply: (target, name, args) => {
                        let path = target.path;
                        target.path = [];
                        return new Promise((resolve, reject) => {
                            let binary = [];
                            for (let item in args) {
                                if (BufferUtils.isBuffer(args[item])) {
                                    args[item] = AnyPacker.packBytes(args[item]);
                                    binary.push(item);
                                }
                            }
                            const packet = Packet
                                .data({
                                    type: constants.INTERNAL_PACKET_TYPE.RPC,
                                    method: path,
                                    params: args || null,
                                    bin: binary
                                })
                                .setType(constants.PACKET_TYPE.INTERNAL);

                            this._send(packet, true)
                                .then((packet) => {
                                    if (packet.msg.error) {
                                        reject(packet.msg);
                                    } else {
                                        let result = packet.msg.result;
                                        if (packet.msg.bin)
                                            result = AnyPacker.unpackBytes(result);
                                        resolve(result);
                                    }
                                })
                                .catch((e) => {
                                    reject(packet.msg)
                                });
                        });
                    }
                });
            }
        };

        this.rpc = new Proxy(() => {}, handlers);

        protocol.on("internal", this.onInternalComs.bind(this));
        protocol.on("message", this.onMessage.bind(this));
        protocol.on("e2e", () => {
            this.onE2E();
        });
        protocol.on("disconnected", (peer, reason) => {
            this.emit("disconnected", peer, reason);
        });
    }

    isProxy() {
        return this[_protocol].isProxy();
    }

    addLink(peer) {
        this[_links][peer.id] = peer;
    }

    removeLink(peer) {
        delete this[_links][peer.id];
    }

    getLinks() {
        return this[_links];
    }

    getSyncedTime(refresh) {
        refresh = refresh || false;
        return new Promise((resolve, reject) => {
            if(!refresh && this.syncedTime) {
                resolve(
                    Object.assign({
                        time: Date.now() + this.syncedTime.offset
                    }, this.syncedTime)
                );
            } else {
                let clientTimestamp = Date.now();
                this.sendInternal({
                    type: constants.INTERNAL_PACKET_TYPE.SYNCED_TIME,
                    time: clientTimestamp
                }, true).then(packet => {
                    const T1 = packet.msg.o; // origin time
                    const T2 = packet.msg.t; // receive time
                    const T3 = packet.msg.t; // transmit time
                    const T4 = Date.now(); // now

                    this.syncedTime = {
                        rtt: (T4 - T1) - (T3 - T2),
                        offset: ((T2 - T1) - (T4 - T3)) / 2
                    };
                    resolve(
                        Object.assign({
                            time: Date.now() + this.syncedTime.offset
                        }, this.syncedTime)
                    );
                }).catch(reject);
            }
        });
    }

    e2e() {
        this[_protocol].e2e();
    }

    isE2EEnabled() {
        return this[_protocol].hasE2EEnabled();
    }

    send(message, awaitReply, timeout) {
        const packet = Packet
            .data(message)
            .setType(constants.PACKET_TYPE.LINK);

        return this._send(packet, awaitReply, timeout);
    }

    forward(packet) {
        this[_protocol].forward(packet);
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

    onInternalComs(peer, message) {
        if (message.seq < 0) {
            if (!this._resolveReply(message)) {
                debug("Dropped reply " + message.seq + ". Delivered after Timeout");
            }
            return;
        }

        if (message.type == constants.PACKET_TYPE.INTERNAL) {
            this.emit("internal", new AnyPacket(this, message, this.sendInternal.bind(this)));
        } else {
            debug("Dropped internal packet!", message);
        }
    }

    disconnect(reason) {
        for (let seq in this[_packets]) {
            clearTimeout(this[_packets][seq].timeout);
            this[_packets][seq].reject("Peer disconnected!");
        }
        this[_packets] = {};

        this[_protocol].disconnect(reason);
    }

    _send(packet, awaitReply, timeout) {
        return new Promise((resolve, reject) => {
            if (!this[_protocol].isConnected()) {
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
                            this.disconnect("Missed reply timeout! Packet Type: " + Packet.TYPE._string(packet.type) + " - " + packet.seq);
                            msg.reject("Timeout!");
                        }
                    }, timeout || this[_protocol].options.replyTimeout)
                };
            }
        });
    }

    _recvForward(packet) {
        this[_protocol]._recvPacketQueue.push({
            peer: this[_protocol].peer,
            recv: packet.msg,
            state: this[_protocol].ENCRYPTION_STATE
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