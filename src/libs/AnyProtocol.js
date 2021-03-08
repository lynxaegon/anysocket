const debug = require('debug')('AnyProtocol');
const EventEmitter = require("events");
const FastQ = require('fastq');
const Packet = require("./Packet");
const Utils = require("./utils");
const AnyPacker = require("./AnyPacker");
const constants = require("./_constants");
const ENCRYPTION_SECRET = Symbol("secret key");
const ENCRYPTION_PRIVATE = Symbol("private key");
const ENCRYPTION_NONCE = Symbol("nonce");

module.exports = class AnyProtocol extends EventEmitter {
    constructor(anysocket, peer, options) {
        super();

        this._seq = 0;

        this[ENCRYPTION_SECRET] = null;
        this[ENCRYPTION_PRIVATE] = null;
        this[ENCRYPTION_NONCE] = null;

        this.peerID = peer.id;
        this.peer = peer;
        this.options = Object.assign({
            replyTimeout: 30 * 1000,
            heartbeatTimeout: 5 * 1000,
            heartbeatInterval: 5 * 1000
        }, options);
        this.connectionID = this.peer.connectionID;
        this.anysocket = anysocket;

        this._packetQueue = FastQ(this, this.processPacketQueue.bind(this), 1);
        this._linkPacketQueue = FastQ(this, this.processLinkPacketQueue.bind(this), 1);
        this._recvPacketQueue = FastQ(this, this.processRecvPacketQueue.bind(this), 1);
        this._packets = {};

        this.changeState(constants.PROTOCOL_STATES.ESTABLISHED);
        this.ENCRYPTION_STATE = constants.PROTOCOL_ENCRYPTION.PLAIN;

        this.peer.on("message", (peer, recv) => {
            this._recvPacketQueue.push([peer, recv]);
        });

        if(this.peer.isClient() && !this.peerID) {
            this.changeState(constants.PROTOCOL_STATES.AUTHING);
            this.send(Packet.data({
                id: this.anysocket.id
            }).setType(Packet.TYPE.AUTH));
        }
        if(this.peerID) {
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
        if(packet.seq == 0)
            packet.setSeq(this._getSeq());

        return new Promise((resolve, reject) => {
            const rejectFnc = (e) => {
                this.disconnect(e);
                reject(e);
            };

            if([Packet.TYPE.INTERNAL, Packet.TYPE.LINK, Packet.TYPE.HEARTBEAT, Packet.TYPE.FORWARD].indexOf(packet.type) != -1 && this.state != constants.PROTOCOL_STATES.CONNECTED) {
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
        debug(this.peerID,">>>>", Packet.TYPE._string(packet.type), packet.seq);
        packet.serialize(constants.MAX_PACKET_SIZE, this._encrypt.bind(this))
            .then((packet) => {
                for(let i = 0; i < packet.length; i++) {
                    const item = {
                        packet: packet[i],
                        reject: reject
                    };
                    if(i == packet.length - 1) {
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

    onPacket(peer, recv) {
        return new Promise((resolve, reject) => {
            let invalidPacket = true;

            if(Packet.isForwardPacket(recv)) {
                this.emit("forward", this.peerID, this._decodeForwardPacket(recv));
                resolve();
            }
            else {
                let seq = Packet.getSeq(recv);
                if(!this._packets[seq]) {
                    this._packets[seq] = Packet.buffer();
                }
                let packet = this._packets[seq];

                packet.deserialize(recv, this._decrypt.bind(this))
                    .then(result => {
                        debug(this.peerID, "<<<<", Packet.TYPE._string(packet.type), packet.seq);
                        if (result) {
                            delete this._packets[seq];

                            switch (this.state) {
                                case constants.PROTOCOL_STATES.ESTABLISHED:
                                    if (packet.type == Packet.TYPE.AUTH) {
                                        invalidPacket = false;
                                        if (!packet.data.id) {
                                            return this.disconnect("Invalid Auth Packet!");
                                        }
                                        this.peerID = packet.data.id;

                                        this.send(Packet.data({
                                            id: this.anysocket.id
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
                                        if (!packet.data.id) {
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
                                    }
                                    else if (packet.type == Packet.TYPE.INTERNAL) {
                                        invalidPacket = false;
                                        this.emit("internal", this, {
                                            seq: packet.seq,
                                            type: packet.type,
                                            data: packet.data
                                        });
                                        resolve();
                                    }
                                    else if (packet.type == Packet.TYPE.SWITCH) {
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
                                    }
                                    else if (packet.type == Packet.TYPE.HEARTBEAT) {
                                        invalidPacket = false;
                                        this.emit("internal", this, {
                                            seq: packet.seq,
                                            type: packet.type,
                                            data: packet.data
                                        });
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
                                    else if (packet.type == Packet.TYPE.INTERNAL) {
                                        invalidPacket = false;
                                        this.emit("internal", this, {
                                            seq: packet.seq,
                                            type: packet.type,
                                            data: packet.data
                                        });
                                        resolve();
                                    }
                                    else if (packet.type == Packet.TYPE.HEARTBEAT) {
                                        invalidPacket = false;
                                        this.emit("internal", this, {
                                            seq: packet.seq,
                                            type: packet.type,
                                            data: packet.data
                                        });
                                        resolve();
                                    }
                                    break;
                                case constants.PROTOCOL_STATES.DISCONNECTED:
                                    invalidPacket = false;
                                    resolve();
                                    break;
                            }

                            if (invalidPacket) {
                                debug("Invalid packet received! RECV:", packet);
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
        switch(this.state) {
            case constants.PROTOCOL_STATES.ESTABLISHED:
                this._linkPacketQueue.pause();
                break;
            case constants.PROTOCOL_STATES.AUTHING:
                this._linkPacketQueue.pause();
                break;
            case constants.PROTOCOL_STATES.CONNECTED:
                this._linkPacketQueue.resume();
                break;
            case constants.PROTOCOL_STATES.SWITCHING_PROTOCOL:
                this._linkPacketQueue.pause();
                break;
            case constants.PROTOCOL_STATES.DISCONNECTED:
                this._packetQueue.pause();
                this._packetQueue.kill();

                this._linkPacketQueue.pause();
                this._linkPacketQueue.kill();
                break;
        }
    }

    disconnect(reason) {
        this.changeState(constants.PROTOCOL_STATES.DISCONNECTED);
        if(this.isProxy()) {
            this.anysocket.unproxy(this.peer.id, this.peer.socket.id, reason);
        } else {
            this.peer.disconnect(reason);
        }
    }

    processPacketQueue(item, cb) {
        this.peer.send(item.packet).then(() => {
            if(item.resolve)
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
        this.onPacket(...item).then(() => {
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
                    throw new Error("Encryption state '"+ this.ENCRYPTION_STATE +"' not implemented!");
            }
        });
    }

    _decrypt(packet, seq) {
        return new Promise(resolve => {
            switch (this.ENCRYPTION_STATE) {
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
                    throw new Error("Encryption state '"+ this.ENCRYPTION_STATE +"' not implemented!");
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
        // max 2 bytes
        if (this._seq >= 32767) {
            this._seq = 0;
        }
        this._seq++;

        return this._seq;
    }
};