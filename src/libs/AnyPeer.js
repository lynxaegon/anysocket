const debug = require('debug')('AnyPeer');
const constants = require("./_constants");
const EventEmitter = require("events");
const Packet = require("./Packet");
const AnyPacket = require("./AnyPacket");
const _protocol = Symbol("private protocol");
const _packets = Symbol("packets");
const _links = Symbol("links");
const _heartbeatReq = Symbol("heartbeat raw");
const isBoolean = function(obj) {
    return obj === true || obj === false || toString.call(obj) === '[object Boolean]';
};

module.exports = class AnyPeer extends EventEmitter {
    constructor(protocol) {
        super();

        this[_links] = {};
        this[_protocol] = protocol;
        this[_packets] = {};

        this.id = protocol.peerID;
        this.lag = -1;
        this.connectionID = protocol.connectionID;
        this._heartbeat = false;

        const self = this;
        const handlers = {
            get: (target, name) => {
                const prop = target[name];
                if (prop != null) { return prop; }

                if(!target.path)
                    target.path = [];

                target.path.push(name);
                return new Proxy(target, {
                    get: handlers.get,
                    apply: (target, name, args) => {
                        let path = target.path;
                        target.path = [];
                        return new Promise((resolve, reject) => {
                            const packet = Packet
                                .data({
                                    type: constants.INTERNAL_PACKET_TYPE.RPC,
                                    method: path,
                                    params: args || null
                                })
                                .setType(constants.PACKET_TYPE.INTERNAL);

                            this._send(packet, true)
                                .then((packet) => {
                                    resolve(packet.msg);
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
            this.heartbeat();
        });
        protocol.on("disconnected", (peer, reason) => {
            this.emit("disconnected", peer, reason);
        });
    }

    isProxy() {
        return this[_protocol].isProxy();
    }

    heartbeat(forceOnce) {
        if(forceOnce) {
            return new Promise((resolve, reject) => {
                this[_heartbeatReq]().then(() => {
                    resolve(this);
                }).catch((e) => {
                    reject(this, e);
                });
            });
        }

        if(this.isProxy())
            return;

        if(this._heartbeat)
            clearTimeout(this._heartbeat);
        this._heartbeat = setTimeout(() => {
            this.heartbeat();
        }, this[_protocol].options.heartbeatInterval);

        this[_heartbeatReq]().then(() => {}).catch(() => {});
    }

    [_heartbeatReq]() {
        return new Promise((resolve, reject) => {
            const startTime = (new Date()).getTime();
            const packet = Packet
                .data()
                .setType(constants.PACKET_TYPE.HEARTBEAT);

            this._send(packet, true, this[_protocol].options.heartbeatTimeout).then(() => {
                this.lag = (new Date()).getTime() - startTime;
                resolve();
                this.emit("heartbeat", this);
            }).catch((e) => {
                debug("Heartbeat Error:", e);
                this.disconnect(e);
                reject(e);
            });
        });
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

    e2e() {
        clearTimeout(this._heartbeat);
        this[_protocol].e2e();
    }

    isE2EEnabled() {
        return this[_protocol].peer.hasE2EEnabled();
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

        if (message.type == constants.PACKET_TYPE.HEARTBEAT) {
            // reply
            const packet = Packet
                .data()
                .setType(constants.PACKET_TYPE.HEARTBEAT);
            this._send(packet, message.seq);
        } else if (message.type == constants.PACKET_TYPE.INTERNAL) {
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
        clearTimeout(this._heartbeat);

        this[_protocol].disconnect(reason);
    }

    _send(packet, awaitReply, timeout) {
        return new Promise((resolve, reject) => {
            if(!this[_protocol].isConnected()) {
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
                            this.disconnect("Missed reply timeout! Packet Type: " + Packet.TYPE.toString(packet.type))
                            msg.reject("Timeout!");
                        }
                    }, timeout || this[_protocol].options.replyTimeout)
                };
            }
        });
    }

    _recvForward(packet) {
        this[_protocol].onPacket(this[_protocol].peer, packet.msg);
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