const EventEmitter = require("events");
const FastQ = require('fastq');
const AnyPacket = require("./AnyPacket");
const Utils = require("./utils");

const PACKET_TYPE = {
    AUTH: 1,
    LINK: 2,
    SWITCH: 3,
    HEARTBEAT: 4
};
const PROTOCOL_STATES = {
    ESTABLISHED: 0,
    AUTHING: 1,
    CONNECTED: 2,
    SWITCHING_PROTOCOL: 3,
    DISCONNECTED: 4
};
const PROTOCOL_ENCRYPTION = {
    PLAIN: "1",
    AES: "2",
    E2E: "3"
};

const MAX_PACKET_SIZE = 2020;
module.exports = class AnyProtocol extends EventEmitter {
    constructor(anysocketID, peer) {
        super();

        this._seq = 0;

        this.peerID = null;
        this.peer = peer;
        this.connectionID = this.peer.connectionID;
        this.anysocketID = anysocketID;

        this.PACKET_TYPE = PACKET_TYPE;
        this._packetQueue = FastQ(this, this.processPacketQueue, 1);
        this._linkPacketQueue = FastQ(this, this.processLinkPacketQueue, 1);
        this._buffer = false;

        this.changeState(PROTOCOL_STATES.ESTABLISHED);
        this.ENCRYPTION_STATE = PROTOCOL_ENCRYPTION.PLAIN;

        this.peer.on("message", this.onPacket.bind(this));

        if(this.peer.isClient()) {
            this.changeState(PROTOCOL_STATES.AUTHING);
            this.send(AnyPacket.data({
                id: this.anysocketID
            }).setType(PACKET_TYPE.AUTH));
        }
    }

    isConnected() {
        return this.state != PROTOCOL_STATES.DISCONNECTED;
    }

    send(packet) {
        if(packet.seq == 0)
            packet.setSeq(this._getSeq());

        return new Promise((resolve, reject) => {
            const rejectFnc = (e) => {
                this.disconnect(e);
                reject(e);
            };

            if(packet.type == PACKET_TYPE.LINK && this.state != PROTOCOL_STATES.CONNECTED) {
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
        try {
            packet = packet.serialize(MAX_PACKET_SIZE, this._encrypt.bind(this));
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
        } catch (e) {
            reject(e);
        }
    }

    e2e() {
        if(this.peer.hasE2EEnabled())
            return;

        this.send(AnyPacket.data({
            type: PROTOCOL_ENCRYPTION.E2E,
            key: this.peer.getPublicKey()
        }).setType(PACKET_TYPE.SWITCH)).then(() => {
            this.changeState(PROTOCOL_STATES.SWITCHING_PROTOCOL);
        });
    }

    onPacket(peer, recv) {
        // TODO: to implement forward without parsing, just read the PACKET_TYPE (substr(1,1))
        let invalidPacket = true;
        this._buffer = this._buffer || AnyPacket.buffer();
        const packet = this._buffer;
        if(packet.deserialize(recv, this._decrypt.bind(this))) {
            this._buffer = false;

            switch (this.state) {
                case PROTOCOL_STATES.ESTABLISHED:
                    if(packet.type == PACKET_TYPE.AUTH) {
                        invalidPacket = false;
                        if(!packet.data.id) {
                            return this.disconnect("Invalid Auth Packet!");
                        }
                        this.peerID = packet.data.id;

                        this.send(AnyPacket.data({
                            id: this.anysocketID
                        }).setType(PACKET_TYPE.AUTH)).then(() => {
                            this.changeState(PROTOCOL_STATES.CONNECTED);
                            this.emit("ready", this);
                        });
                    }
                    break;
                case PROTOCOL_STATES.AUTHING:
                    if(packet.type == PACKET_TYPE.AUTH) {
                        invalidPacket = false;
                        this.changeState(PROTOCOL_STATES.CONNECTED);
                        if(!packet.data.id) {
                            return this.disconnect("Invalid Auth Packet!");
                        }
                        this.peerID = packet.data.id;

                        this.emit("ready", this);
                    }
                    break;
                case PROTOCOL_STATES.CONNECTED:
                    if(packet.type == PACKET_TYPE.LINK) {
                        invalidPacket = false;
                        this.emit("message", this, {
                            seq: packet.seq,
                            data: packet.data
                        });
                    } else if(packet.type == PACKET_TYPE.SWITCH) {
                        invalidPacket = false;

                        let publicKey = this.peer.getPublicKey();
                        this.peer.setPublicKey(packet.data.key);

                        this.send(AnyPacket.data({
                            type: PROTOCOL_ENCRYPTION.E2E,
                            key: publicKey
                        }).setType(PACKET_TYPE.SWITCH)).then(() => {
                            this.ENCRYPTION_STATE = PROTOCOL_ENCRYPTION.E2E;
                            this.changeState(PROTOCOL_STATES.CONNECTED);
                            this.emit("e2e", this);
                        });

                        this.changeState(PROTOCOL_STATES.SWITCHING_PROTOCOL);
                    } else if(packet.type == PACKET_TYPE.HEARTBEAT) {
                        invalidPacket = false;
                        this.emit("internal", this, {
                            seq: packet.seq,
                            type: packet.type,
                            data: packet.data
                        });
                    }
                    break;
                case PROTOCOL_STATES.SWITCHING_PROTOCOL:
                    if(packet.type == PACKET_TYPE.LINK) {
                        invalidPacket = false;
                        this.emit("message", this, {
                            seq: packet.seq,
                            data: packet.data
                        });
                    }
                    else if(packet.type == PACKET_TYPE.SWITCH) {
                        invalidPacket = false;
                        this.peer.setPublicKey(packet.data.key);
                        this.ENCRYPTION_STATE = PROTOCOL_ENCRYPTION.E2E;
                        this.changeState(PROTOCOL_STATES.CONNECTED);
                        this.emit("e2e", this);
                    } else if(packet.type == PACKET_TYPE.HEARTBEAT) {
                        invalidPacket = false;
                        this.emit("internal", this, {
                            seq: packet.seq,
                            type: packet.type,
                            data: packet.data
                        });
                    }
                    break;
                case PROTOCOL_STATES.DISCONNECTED:
                    invalidPacket = false;
                    this.disconnect("Already disconnected!");
                    break;
            }

            if(invalidPacket) {
                console.error("Invalid packet received!");
                console.log(packet);
            }
        }
    }

    changeState(state) {
        this.state = state;
        switch(this.state) {
            case PROTOCOL_STATES.ESTABLISHED:
                this._linkPacketQueue.pause();
                break;
            case PROTOCOL_STATES.AUTHING:
                this._linkPacketQueue.pause();
                break;
            case PROTOCOL_STATES.CONNECTED:
                this._linkPacketQueue.resume();
                break;
            case PROTOCOL_STATES.SWITCHING_PROTOCOL:
                this._linkPacketQueue.pause();
                break;
            case PROTOCOL_STATES.DISCONNECTED:
                this._packetQueue.pause();
                this._packetQueue.kill();

                this._linkPacketQueue.pause();
                this._linkPacketQueue.kill();
                break;
        }
    }

    disconnect(reason) {
        this.changeState(PROTOCOL_STATES.DISCONNECTED);
        this.peer.disconnect(reason);
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

    _encrypt(packet) {
        switch (this.ENCRYPTION_STATE) {
            case PROTOCOL_ENCRYPTION.PLAIN:
                return packet;
            case PROTOCOL_ENCRYPTION.AES:
                return packet;
            case PROTOCOL_ENCRYPTION.E2E:
                return Utils.encryptRSA(this.peer.getPublicKey(), packet);
        }
    }

    _decrypt(packet) {
        switch (this.ENCRYPTION_STATE) {
            case PROTOCOL_ENCRYPTION.PLAIN:
                return packet;
            case PROTOCOL_ENCRYPTION.AES:
                return packet;
            case PROTOCOL_ENCRYPTION.E2E:
                return Utils.decryptRSA(this.peer.getPrivateKey(), packet);
        }
    }

    _getSeq() {
        if (this._seq >= Number.MAX_SAFE_INTEGER) {
            this._seq = 0;
        }
        this._seq++;

        return this._seq;
    }
};