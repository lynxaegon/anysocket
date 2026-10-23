const debug = require('debug')('AnyPeer');
const constants = require("./_constants");
const EventEmitter = require("../wrappers/events-wrapper");
const Packet = require("./Packet");
const AnyPacket = require("./AnyPacket");
const AnyPacker = require("./AnyPacker");
const _protocol = Symbol("private protocol");
const _packets = Symbol("packets");
const _links = Symbol("links");
const BufferUtils = require("../wrappers/utils_buffer");
const { errors } = require("./errors");

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

        const makeRPC = (rpc = {}, base = "", callOptions = {}) => {
            return new Proxy(() => {},
                {
                    get: (target, name) => {
                        const prop = target[name];
                        if (prop != null) { return prop; }
                        return makeRPC(rpc, base + "/" + name, callOptions);
                    },
                    apply: (target, thisArg, args) => {
                        let path = base.split("/").slice(1);
                        return new Promise((resolve, reject) => {
                            // Between 1.0 peers a binary argument travels as
                            // its own bytes, attached beside the call; to a
                            // 0.4.x peer it still has to be base64 inside it.
                            const native = this.protocolVersion() >= constants.PROTOCOL_VERSION;
                            const attached = [];
                            let binary = [];
                            for (let item in args) {
                                if (BufferUtils.isBuffer(args[item])) {
                                    if (native) {
                                        attached.push(args[item]);
                                        args[item] = null;
                                    } else {
                                        args[item] = AnyPacker.packBytes(args[item]);
                                    }
                                    binary.push(item);
                                }
                            }
                            const body = {
                                type: constants.INTERNAL_PACKET_TYPE.RPC,
                                method: path,
                                params: args || null,
                                bin: binary
                            };
                            if (attached.length) body[Packet.ATTACHMENTS] = attached;

                            const packet = Packet
                                .data(body)
                                .setType(constants.PACKET_TYPE.INTERNAL);

                            this._send(packet, true, callOptions.timeout, callOptions.signal)
                                .then((packet) => {
                                    if (packet.msg.error) {
                                        reject(packet.msg);
                                    } else {
                                        let result = packet.msg.result;
                                        if (packet.msg.bin) {
                                            const attachedResult = packet.msg[Packet.ATTACHMENTS];
                                            result = attachedResult && attachedResult.length
                                                ? attachedResult[0]
                                                : AnyPacker.unpackBytes(result);
                                        }
                                        resolve(result);
                                    }
                                })
                                .catch((e) => {
                                    // The reason, not the request. Rejecting with
                                    // packet.data handed the caller its own outgoing
                                    // call — method and arguments, whatever secrets
                                    // they held — in place of what went wrong.
                                    reject(e);
                                });
                        });
                    }
                }
            );
        };
        this.rpc = makeRPC();

        /**
         * The same RPC proxy with options for these calls:
         *
         *   await peer.rpcWith({ timeout: 45000 }).reset("node-3");
         *   await peer.rpcWith({ signal: controller.signal }).slow();
         *
         * `timeout` replaces replyTimeout, in either direction — a caller
         * that has to wait longer than the default could not, and one that
         * gave up sooner by racing its own timer left the call registered
         * until the default ran out. A method, not a property on `rpc`,
         * so it cannot collide with a remote method name.
         */
        this.rpcWith = (options) => makeRPC({}, "", Object.assign({}, options));

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

    /**
     * For a proxied peer, the id of the peer relaying it; null when we talk to
     * it directly. Used to check that a relayed packet really arrived over the
     * relay that peer belongs to.
     */
    get relayID() {
        const protocol = this[_protocol];
        if (!protocol.isProxy()) return null;

        const relay = protocol.peer && protocol.peer.socket;
        return (relay && relay.id) || null;
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

    /**
     * The frame format and handshake this connection settled on: 1 when both
     * ends speak 1.0, 0 against a 0.4.x peer.
     */
    protocolVersion() {
        return this[_protocol].protocolVersion;
    }

    /**
     * Can this connection carry a relayed link? Relaying needs the 1.0 frame
     * format, because a relayed frame is opaque bytes that each hop re-wraps.
     */
    supportsRelay() {
        return this[_protocol].supportsRelay();
    }

    /** The optional features both ends announced. */
    capabilities() {
        return this[_protocol].capabilities.slice();
    }

    /**
     * Did we dial this peer? Reportable metadata only — everything about how a
     * peer is used is identical either way, and nothing in the protocol may
     * depend on this.
     */
    isOutbound() {
        return this[_protocol].isOutbound();
    }

    /**
     * Retire this peer in favour of another connection to the same id. Detached
     * from its protocol first, so the resulting disconnect cannot be mistaken
     * for the replacement going away.
     */
    _supersede(reason) {
        // Anything still waiting on this connection would otherwise sit out
        // the full reply timeout for an answer that can no longer arrive.
        this._rejectPending(errors.superseded());
        this[_protocol].peerID = null;
        this[_protocol].disconnect(reason);
    }

    _rejectPending(reason) {
        for (let seq in this[_packets]) {
            clearTimeout(this[_packets][seq].timeout);
            this[_packets][seq].reject(reason);
        }
        this[_packets] = {};
    }

    /**
     * Encrypt this connection. Resolves once it is live.
     *
     * Either end may call it, and both may call it at once — the exchange is
     * symmetric, so no caller has to work out which end it is.
     */
    e2e() {
        return this[_protocol].e2e();
    }

    /**
     * A value unique to this encrypted channel, identical on both ends. An
     * application can mix it into its own authentication so a proof is only
     * good on the channel it was made for, which is what stops an on-path
     * attacker from carrying a captured proof onto a channel of its own.
     * Null until e2e is up.
     */
    getChannelBinding() {
        return this[_protocol].getChannelBinding();
    }

    /** Which exchange and cipher this connection settled on, or null. */
    e2eInfo() {
        return this[_protocol].e2eInfo();
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
        this._rejectPending(errors.disconnected());

        this[_protocol].disconnect(reason);
    }

    _send(packet, awaitReply, timeout, signal) {
        const result = this._sendInner(packet, awaitReply, timeout, signal);
        // send() never settled before 1.0, so code everywhere calls it without
        // awaiting or catching. Now that it can reject, an unhandled failure
        // would crash the process under node's default. A handler on the very
        // promise returned keeps that from happening, while a caller that does
        // await it still sees the rejection.
        result.catch(() => {});
        return result;
    }

    _sendInner(packet, awaitReply, timeout, signal) {
        return new Promise((resolve, reject) => {
            if (!this[_protocol].isConnected()) {
                reject(errors.notConnected());
                return;
            }

            if (!isBoolean(awaitReply) && awaitReply && awaitReply > 0) {
                packet.setReplyTo(awaitReply);
            }

            // Assigns packet.seq synchronously, so it is safe to key on below.
            const sent = this[_protocol].send(packet);

            if (isBoolean(awaitReply) && awaitReply === true) {
                // Resolves when the reply lands; a failed send still rejects.
                sent.catch(reject);
                this[_packets][packet.seq] = {
                    time: (new Date()).getTime(),
                    resolve: resolve,
                    reject: reject,
                    timeout: setTimeout(() => {
                        if (this[_packets][packet.seq]) {
                            let msg = this[_packets][packet.seq];
                            delete this[_packets][packet.seq];
                            // Only this call fails. Tearing down the connection
                            // (pre-1.0 behaviour) also killed every other
                            // in-flight call and any healthy traffic with it.
                            if (this[_protocol].options.disconnectOnReplyTimeout) {
                                this.disconnect("Missed reply timeout! Packet Type: " + Packet.TYPE._string(packet.type) + " - " + packet.seq);
                            }
                            msg.reject(errors.timeout({ after: timeout || this[_protocol].options.replyTimeout }));
                        }
                    }, timeout || this[_protocol].options.replyTimeout)
                };

                // The caller can give up early. The entry is removed rather than
                // left for its timer, so a late reply is simply dropped.
                if (signal) {
                    const abort = () => {
                        const entry = this[_packets][packet.seq];
                        if (!entry) return;
                        clearTimeout(entry.timeout);
                        delete this[_packets][packet.seq];
                        entry.reject(errors.aborted(signal.reason));
                    };
                    if (signal.aborted) abort();
                    else signal.addEventListener("abort", abort, { once: true });
                }
                return;
            }

            // Fire and forget: resolve once the transport has taken the packet.
            // It used to never settle, so awaiting a plain send() hung forever.
            sent.then(() => resolve(), reject);
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