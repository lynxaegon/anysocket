const debug = require('debug')('AnyProtocol');
const EventEmitter = require("../wrappers/events-wrapper");
const FastQ = require('fastq');
const Packet = require("./Packet");
const Utils = require("../wrappers/utils");
const AnyPacker = require("./AnyPacker");
const constants = require("./_constants");
const ENCRYPTION_SECRET = Symbol("secret key");
const ENCRYPTION_PRIVATE = Symbol("private key");
const ENCRYPTION_NONCE = Symbol("nonce");
const heartbeatTimer = Symbol("heartbeat timer");
const heartbeatsMissed = Symbol("heartbeats missed");
const heartbeatPonged = Symbol("heartbeat ponged");
const authTimeout = Symbol("authTimeout");
const e2eTimeout = Symbol("e2eTimeout");

module.exports = class AnyProtocol extends EventEmitter {
    constructor(anysocket, peer, options) {
        super();

        this._seq = 0;

        this[ENCRYPTION_SECRET] = null;
        this[ENCRYPTION_PRIVATE] = null;
        this[ENCRYPTION_NONCE] = null;
        this[heartbeatTimer] = 0;
        this[heartbeatsMissed] = 0;
        this[heartbeatPonged] = true;
        this[authTimeout] = false;
        this[e2eTimeout] = false;

        this.peerID = peer.id;
        this.peer = peer;
        this.options = Object.assign({
            authTimeout: 5 * 1000,
            e2eTimeout: 5 * 1000,
            replyTimeout: 30 * 1000,
            heartbeatInterval: 5 * 1000
        }, options);
        this.connectionID = this.peer.connectionID;
        this.anysocket = anysocket;

        this._packetQueue = FastQ(this, this.processPacketQueue.bind(this), 1);
        this._linkPacketQueue = FastQ(this, this.processLinkPacketQueue.bind(this), 1);
        this._recvPacketQueue = FastQ(this, this.processRecvPacketQueue.bind(this), 1);
        this._recvLinkPacketQueue = FastQ(this, this.processRecvLinkPacketQueue.bind(this), 1);
        this._packets = {};

        this.changeState(constants.PROTOCOL_STATES.ESTABLISHED);
        this.ENCRYPTION_STATE = constants.PROTOCOL_ENCRYPTION.PLAIN;

        this.peer.on("message", (peer, recv) => {
            this._recvPacketQueue.push({
                peer: peer,
                recv: recv,
                state: this.ENCRYPTION_STATE
            });
        });

        if (this.peer.isClient() && !this.peerID) {
            this.changeState(constants.PROTOCOL_STATES.AUTHING);
            this.send(Packet.data({
                id: this.anysocket.id,
                auth: this.anysocket.authPacket()
            }).setType(Packet.TYPE.AUTH));
        }
        if (this.peerID) {
            this.changeState(constants.PROTOCOL_STATES.CONNECTED);
        }
    }

    isProxy() {
        return !!this.peer.isProxy;
    }

    isConnected() {
        return this.state != constants.PROTOCOL_STATES.DISCONNECTED;
    }

    send(packet) {
        if (packet.seq == 0)
            packet.setSeq(this._getSeq());

        if (packet.type != Packet.TYPE.HEARTBEAT) {
            this._heartbeat();
        }

        return new Promise((resolve, reject) => {
            const rejectFnc = (e) => {
                this.disconnect(e);
                reject(e);
            };

            if (this.isLINKMessage(packet.type)) {
                this._linkPacketQueue.push({
                    packet: packet,
                    resolve: resolve,
                    reject: rejectFnc
                });
            } else {
                this._send(packet, resolve, rejectFnc);
            }
        });
    }

    _send(packet, resolve, reject) {
        debug(this.peerID, ">>>>", Packet.TYPE._string(packet.type), packet.seq);
        packet.serialize(constants.MAX_PACKET_SIZE, this._encrypt.bind(this))
            .then((packet) => {
                for (let i = 0; i < packet.length; i++) {
                    const item = {
                        packet: packet[i],
                        reject: reject
                    };
                    if (i == packet.length - 1) {
                        item.resolve = resolve;
                    }

                    this._packetQueue.push(item);
                }
            }).catch(reject);
    }

    forward(packet) {
        // console.log("FORWARD", packet);
        return new Promise((resolve, reject) => {
            this._packetQueue.push({
                packet: this._encodeForwardPacket(packet.to, packet.from, packet.msg),
                resolve: resolve,
                reject: reject
            });
        });
    }

    hasE2EEnabled() {
        return !!this[ENCRYPTION_PRIVATE];
    }

    e2e() {
        Utils.generateAESKey().then((result) => {
            this[ENCRYPTION_PRIVATE] = result.private;
            this[ENCRYPTION_NONCE] = result.nonce;

            this.changeState(constants.PROTOCOL_STATES.SWITCHING_PROTOCOL);
            this.send(Packet.data({
                type: constants.PROTOCOL_ENCRYPTION.E2EE,
                key: result.public,
                nonce: result.nonce
            }).setType(Packet.TYPE.SWITCH));
        }).catch((e) => {
            this.disconnect(e);
        });
    }

    onPacket(peer, recv, encryptionState) {
        this._heartbeat();

        return new Promise((resolve, reject) => {
            let invalidPacket = true;

            if (Packet.isForwardPacket(recv)) {
                this.emit("forward", this.peerID, this._decodeForwardPacket(recv));
                resolve();
            } else {
                let seq = Packet.getSeq(recv);

                if (!this._packets[seq]) {
                    this._packets[seq] = Packet.buffer();
                }
                let packet = this._packets[seq];

                packet.deserialize(recv, encryptionState, this._decrypt.bind(this))
                    .then(result => {
                        debug(this.peerID, "<<<<", Packet.TYPE._string(packet.type), packet.seq);
                        if (result) {
                            delete this._packets[seq];

                            switch (this.state) {
                                case constants.PROTOCOL_STATES.ESTABLISHED:
                                    if (packet.type == Packet.TYPE.AUTH) {
                                        invalidPacket = false;
                                        if (!packet.data.id || !this.anysocket.onAuth(packet.data)) {
                                            return this.disconnect("Invalid Auth Packet!");
                                        }
                                        this.peerID = packet.data.id;

                                        this.send(Packet.data({
                                            id: this.anysocket.id,
                                            auth: this.anysocket.authPacket()
                                        }).setType(Packet.TYPE.AUTH)).then(() => {
                                            this.changeState(constants.PROTOCOL_STATES.CONNECTED);
                                            this.emit("ready", this);
                                        });
                                        resolve();
                                    }
                                    break;
                                case constants.PROTOCOL_STATES.AUTHING:
                                    if (packet.type == Packet.TYPE.AUTH) {
                                        invalidPacket = false;
                                        this.changeState(constants.PROTOCOL_STATES.CONNECTED);
                                        if (!packet.data.id || !this.anysocket.onAuth(packet.data)) {
                                            return this.disconnect("Invalid Auth Packet!");
                                        }
                                        this.peerID = packet.data.id;

                                        this.emit("ready", this);
                                        resolve();
                                    }
                                    break;
                                case constants.PROTOCOL_STATES.CONNECTED:
                                    if (packet.type == Packet.TYPE.LINK) {
                                        invalidPacket = false;
                                        this.emit("message", this, {
                                            seq: packet.seq,
                                            data: packet.data
                                        });
                                        resolve();
                                    } else if (packet.type == Packet.TYPE.INTERNAL) {
                                        invalidPacket = false;
                                        this.emit("internal", this, {
                                            seq: packet.seq,
                                            type: packet.type,
                                            data: packet.data
                                        });
                                        resolve();
                                    } else if (packet.type == Packet.TYPE.SWITCH) {
                                        invalidPacket = false;

                                        Utils.generateAESKey().then((result) => {
                                            this[ENCRYPTION_PRIVATE] = result.private;
                                            this[ENCRYPTION_NONCE] = packet.data.nonce + result.nonce;
                                            return Utils.getAESSessionKey(this[ENCRYPTION_NONCE], this.peerID, 0)
                                                .then((nonce) => {
                                                    this[ENCRYPTION_NONCE] = nonce;
                                                    return Utils.computeAESsecret(this[ENCRYPTION_PRIVATE], packet.data.key)
                                                        .then((secret) => {
                                                            this[ENCRYPTION_SECRET] = secret;
                                                            this.send(Packet.data({
                                                                type: constants.PROTOCOL_ENCRYPTION.E2EE,
                                                                key: result.public,
                                                                nonce: result.nonce
                                                            }).setType(Packet.TYPE.SWITCH)).then(() => {
                                                                this.ENCRYPTION_STATE = constants.PROTOCOL_ENCRYPTION.E2EE;
                                                                this.changeState(constants.PROTOCOL_STATES.CONNECTED);
                                                                this.emit("e2e", this);
                                                                resolve();
                                                            });
                                                        });
                                                });
                                        }).catch((e) => {
                                            this.disconnect(e);
                                        });
                                    } else if (packet.type == Packet.TYPE.HEARTBEAT) {
                                        invalidPacket = false;
                                        this._heartbeatPong(packet.data);
                                        resolve();
                                    }
                                    break;
                                case constants.PROTOCOL_STATES.SWITCHING_PROTOCOL:
                                    if (packet.type == Packet.TYPE.SWITCH) {
                                        invalidPacket = false;
                                        this[ENCRYPTION_NONCE] = this[ENCRYPTION_NONCE] + packet.data.nonce;
                                        Utils.getAESSessionKey(this[ENCRYPTION_NONCE], this.anysocket.id, 0)
                                            .then((nonce) => {
                                                this[ENCRYPTION_NONCE] = nonce;
                                                return Utils.computeAESsecret(this[ENCRYPTION_PRIVATE], packet.data.key)
                                                    .then((secret) => {
                                                        this[ENCRYPTION_SECRET] = secret;
                                                        this.ENCRYPTION_STATE = constants.PROTOCOL_ENCRYPTION.E2EE;
                                                        this.changeState(constants.PROTOCOL_STATES.CONNECTED);
                                                        this.emit("e2e", this);
                                                        resolve();
                                                    })
                                            })
                                            .catch((e) => {
                                                this.disconnect(e);
                                            });
                                    }
                                    break;
                                case constants.PROTOCOL_STATES.DISCONNECTED:
                                    invalidPacket = false;
                                    resolve();
                                    break;
                            }

                            if (invalidPacket) {
                                console.log("Invalid packet received! RECV:", packet);
                                return this.disconnect("Invalid Packet!");
                            }
                        } else {
                            // continue processing data
                            resolve();
                        }
                    });
            }
        });
    }

    changeState(state) {
        this.state = state;
        switch (this.state) {
            case constants.PROTOCOL_STATES.ESTABLISHED:
                this[authTimeout] = setTimeout(() => {
                    this.disconnect("auth timed out");
                }, this.options.authTimeout);
                this._linkPacketQueue.pause();
                this._recvLinkPacketQueue.pause();
                break;
            case constants.PROTOCOL_STATES.AUTHING:
                // clear for client
                clearTimeout(this[authTimeout]);
                this[authTimeout] = false;

                this._linkPacketQueue.pause();
                this._recvLinkPacketQueue.pause();
                break;
            case constants.PROTOCOL_STATES.CONNECTED:
                // clear for server
                clearTimeout(this[authTimeout]);
                this[authTimeout] = false;

                clearTimeout(this[e2eTimeout]);
                this[e2eTimeout] = false;

                this._linkPacketQueue.resume();
                this._recvLinkPacketQueue.resume();
                break;
            case constants.PROTOCOL_STATES.SWITCHING_PROTOCOL:
                this[e2eTimeout] = setTimeout(() => {
                    this.disconnect("e2e timed out");
                }, this.options.e2eTimeout);

                this._linkPacketQueue.pause();
                this._recvLinkPacketQueue.pause();
                break;
            case constants.PROTOCOL_STATES.DISCONNECTED:
                this._packetQueue.pause();
                this._packetQueue.kill();

                this._linkPacketQueue.pause();
                this._linkPacketQueue.kill();

                this._recvPacketQueue.pause();
                this._recvPacketQueue.kill();

                this._recvLinkPacketQueue.pause();
                this._recvLinkPacketQueue.kill();

                break;
        }
    }

    disconnect(reason) {
        this.changeState(constants.PROTOCOL_STATES.DISCONNECTED);
        this._heartbeat();

        if (this.isProxy()) {
            this.anysocket.unproxy(this.peer.id, this.peer.socket.id, reason);
        } else {
            this.peer.disconnect(reason);
        }
    }

    processPacketQueue(item, cb) {
        this.peer.send(item.packet).then(() => {
            if (item.resolve)
                item.resolve();

            cb(null, null);
        }).catch((e) => {
            item.reject(e);
            this._packetQueue.kill();
            cb(null, null);
        });
    }

    processLinkPacketQueue(item, cb) {
        this._send(item.packet, item.resolve, item.reject);
        cb(null, null);
    }

    processRecvPacketQueue(item, cb) {
        if(Packet.isForwardPacket(item.recv)) {
            this.emit("forward", this.peerID, this._decodeForwardPacket(item.recv));
            cb(null, null);
        } else {
            if(this.isLINKMessage(Packet.getType(item.recv))) {
                this._recvLinkPacketQueue.push(item);
                cb(null, null);
            } else {
                this.onPacket(item.peer, item.recv, item.state).then(() => {
                    cb(null, null);
                });
            }
        }
    }

    processRecvLinkPacketQueue(item, cb) {
        this.onPacket(item.peer, item.recv, item.state).then(() => {
            cb(null, null);
        });
    }

    _encrypt(packet, seq) {
        return new Promise(resolve => {
            switch (this.ENCRYPTION_STATE) {
                case constants.PROTOCOL_ENCRYPTION.PLAIN:
                    resolve(packet);
                    break;
                case constants.PROTOCOL_ENCRYPTION.E2EE:
                    Utils.getAESSessionKey(this[ENCRYPTION_SECRET], this[ENCRYPTION_NONCE], seq)
                        .then((secretKey) => {
                            return Utils.encryptAES(secretKey, packet).then(resolve);
                        }).catch((e) => {
                        this.disconnect(e);
                    });
                    break;
                default:
                    throw new Error("[encrypt] Encryption state '" + this.ENCRYPTION_STATE + "' not implemented!");
            }
        });
    }

    _decrypt(encryptionState, packet, seq) {
        return new Promise(resolve => {
            switch (encryptionState) {
                case constants.PROTOCOL_ENCRYPTION.PLAIN:
                    resolve(packet);
                    break;
                case constants.PROTOCOL_ENCRYPTION.E2EE:
                    Utils.getAESSessionKey(this[ENCRYPTION_SECRET], this[ENCRYPTION_NONCE], seq)
                        .then((secretKey) => {
                            return Utils.decryptAES(secretKey, packet).then(resolve);
                        }).catch((e) => {
                        this.disconnect(e);
                    });
                    break;
                default:
                    throw new Error("[decrypt] Encryption state '" + encryptionState + "' not implemented!");
            }
        });
    }

    _encodeForwardPacket(to, from, msg) {
        return Packet.TYPE.FORWARD +
            AnyPacker.packHex(to) +
            AnyPacker.packHex(from) +
            msg
            ;
    }

    _decodeForwardPacket(recv) {
        recv = {
            to: AnyPacker.unpackHex(recv.substr(1, 16)),
            from: AnyPacker.unpackHex(recv.substr(17, 16)),
            msg: recv.substr(33)
        };
        return recv;
    }

    _getSeq() {
        // max 4 bytes
        if (this._seq >= 2147483647) {
            this._seq = 0;
        }
        this._seq++;

        return this._seq;
    }

    _heartbeat() {
        // proxies are notified by peers if they disconnect
        if(this.isProxy())
            return;

        clearTimeout(this[heartbeatTimer]);
        if(this.state == constants.PROTOCOL_STATES.AUTHING || this.state == constants.PROTOCOL_STATES.DISCONNECTED)
            return;

        this[heartbeatTimer] = setTimeout(() => {
            if (!this[heartbeatPonged]) {
                this[heartbeatsMissed]++;

                if(this[heartbeatsMissed] >= 2) {
                    this.disconnect("Missed Heartbeats");
                    return;
                }

                this._heartbeat();
                return;
            }

            this[heartbeatsMissed] = 0;
            this[heartbeatPonged] = false;
            const packet = Packet
                .data(1)
                .setType(Packet.TYPE.HEARTBEAT);

            this.send(packet).catch((e) => {
                debug("Heartbeat Error:", e);
                this.disconnect(e);
            });
        }, this.options.heartbeatInterval)
    }

    _heartbeatPong(type) {
        if(type == 1) {
            const packet = Packet
                .data(2)
                .setType(Packet.TYPE.HEARTBEAT);

            this.send(packet).catch((e) => {
                debug("Heartbeat Error:", e);
                this.disconnect(e);
            });
        } else {
            // reply received
            this[heartbeatPonged] = true;
        }
    }

    isLINKMessage(type) {
        return [Packet.TYPE.INTERNAL, Packet.TYPE.LINK].indexOf(type) != -1;
    }
};