const debug = require('debug')('AnyProtocol');
const EventEmitter = require("../wrappers/events-wrapper");
const FastQ = require('fastq');
const Packet = require("./Packet");
const Utils = require("../wrappers/utils");
const AnyPacker = require("./AnyPacker");
const constants = require("./_constants");
const Frame = require("./Frame");
const E2E = require("./E2E");
const Auth = require("./Auth");
const { errors } = require("./errors");
const ENCRYPTION_SECRET = Symbol("secret key");
const ENCRYPTION_PRIVATE = Symbol("private key");
const ENCRYPTION_NONCE = Symbol("nonce");
const ENCRYPTION_STARTING = Symbol("e2e starting");
const E2E_OFFER = Symbol("our e2e offer");
const E2E_SESSION = Symbol("e2e session");
const E2E_PENDING = Symbol("e2e promise");
const AUTH_CHALLENGE = Symbol("our auth challenge");
const AUTH_PEER_CHALLENGE = Symbol("peer auth challenge");
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
        this[ENCRYPTION_STARTING] = false;
        this[E2E_OFFER] = null;
        this[E2E_SESSION] = null;
        this[E2E_PENDING] = null;
        this[AUTH_CHALLENGE] = null;
        this[AUTH_PEER_CHALLENGE] = null;

        // Negotiated in the AUTH exchange (see _negotiate). 0 until then, and
        // 0 for good against a 0.4.x peer.
        this.protocolVersion = constants.PROTOCOL_VERSION_LEGACY;
        this.remoteProtocolVersion = null;
        this.capabilities = [];
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
            heartbeatInterval: 5 * 1000,
            // How many consecutive missed heartbeats before disconnecting.
            // Default 2 preserves legacy behaviour (disconnect after
            // ~2 * heartbeatInterval of silence). Embedders on flaky links
            // (WiFi+BT coexistence, cellular, etc.) can bump this to tolerate
            // longer transient stalls without tearing down the TCP socket.
            heartbeatsMaxMissed: 2,
            // Disable app-level heartbeats entirely. Useful when the transport
            // itself already provides liveness (SO_KEEPALIVE, WebSocket
            // ping/pong), or when the application already sends regular
            // traffic of its own. With this off, a dead peer is detected
            // only via TCP close / socket errors — pair with `tcpKeepAlive`
            // on the transport for reliable detection.
            heartbeatEnabled: true,
            // A reply that never arrives rejects that one call. Set true for the
            // pre-1.0 behaviour, where one missed reply tore down the whole
            // connection (and every other in-flight call with it).
            disconnectOnReplyTimeout: false,
            // Receive limits. The one that matters is the handshake ceiling:
            // before authenticating, a peer may only be sending a single small
            // AUTH packet, and reassembly used to be unbounded there, so it
            // could pin memory without ever proving who it was.
            //
            // Live traffic is deliberately uncapped. Moving large payloads is
            // the point of the library — a cap here is not much of a defence
            // against a peer that has already authenticated, and a default one
            // silently truncates exactly the transfers it exists to carry. Set
            // maxMessageSize to bound an authenticated peer if that suits your
            // deployment.
            maxPartialPackets: 64,
            maxMessageSize: Infinity,
            maxHandshakeMessageSize: 64 * 1024,
            // Chunks allowed in flight while framing a message. More overlaps
            // framing and encryption with the writes; fewer holds less memory.
            sendWindow: 8,
            // Bytes per 1.0 frame. Measured: on an encrypted 128MB transfer,
            // 1MB frames manage ~105MB/s and 4MB frames ~170MB/s, because the
            // per-frame work stops dominating. 8MB is a little quicker again
            // but holds noticeably more. Only applies to 1.0 frames — a 0.4.x
            // peer keeps 1MB chunks, since its hex-encoded e2e payload would
            // otherwise double past the frame limit.
            maxPacketSize: 4 * 1024 * 1024,
            // How much may sit unflushed in the socket write buffer before a
            // send waits. Measured: 4MB costs about a quarter of the
            // throughput of 16MB, for no real memory saving.
            sendHighWaterMark: 16 * 1024 * 1024,
            // What we announce in the handshake. Narrow it to opt out of a
            // feature; the peer is then never sent it.
            capabilities: constants.CAPABILITIES,
            // The e2e a 0.4.x peer can do: an unauthenticated secp521r1
            // exchange, then AES-256-CBC with no integrity, keyed per packet
            // by PBKDF2 at one iteration. Allowed by default so a fleet can be
            // upgraded a peer at a time; turn it off once it has been, and a
            // 0.4.x peer can no longer be encrypted with it — in either
            // direction.
            allowLegacyE2E: true,
            // Ciphers to offer for e2e, most preferred first. Left unset, this
            // machine ranks them by measuring which it runs faster. Setting it
            // pins a choice — the negotiation still only ever picks one both
            // ends offer.
            e2eCiphers: null
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
            this._heartbeat(true);

            this._recvPacketQueue.push({
                peer: peer,
                recv: recv,
                state: this.ENCRYPTION_STATE
            });
        });

        if (this.peer.isClient() && !this.peerID) {
            this.changeState(constants.PROTOCOL_STATES.AUTHING);
            this.send(this._authPacket());
        }
        if (this.peerID) {
            // A relayed link has no AUTH exchange of its own to negotiate
            // from: it exists because a relay confirmed 1.0 on both of its
            // hops, so both of its endpoints speak 1.0 by construction.
            if (this.isProxy()) {
                this.protocolVersion = constants.PROTOCOL_VERSION;
                this.remoteProtocolVersion = constants.PROTOCOL_VERSION;
            }
            this.changeState(constants.PROTOCOL_STATES.CONNECTED);
        }
    }

    isProxy() {
        return !!this.peer.isProxy;
    }

    /**
     * Did we dial this connection? undefined when the transport cannot say.
     * Reportable metadata — used to settle a duplicate deterministically, never
     * to decide how a peer may be used.
     */
    isOutbound() {
        try {
            return !!this.peer.isClient();
        } catch (_) {
            return undefined;
        }
    }

    /** Can this connection carry a relayed link? */
    supportsRelay() {
        return this.protocolVersion >= constants.PROTOCOL_VERSION;
    }

    isConnected() {
        return this.state != constants.PROTOCOL_STATES.DISCONNECTED;
    }

    send(packet) {
        if (packet.seq == 0)
            packet.setSeq(this._getSeq());

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

    /**
     * Frame a message and feed it to the wire, a chunk at a time.
     *
     * Every chunk used to be built before any of them was sent, which held a
     * second copy of the whole payload — on a large transfer that is the
     * difference between fitting in memory and not. Chunks are produced as the
     * wire drains instead, with a few allowed in flight so the framing and
     * encryption of the next overlap the write of the last.
     */
    _send(packet, resolve, reject) {
        debug(this.peerID, ">>>>", Packet.TYPE._string(packet.type), packet.seq);

        const window = Math.max(1, this.options.sendWindow);
        const chunkSize = this.protocolVersion >= constants.PROTOCOL_VERSION
            ? this.options.maxPacketSize
            : constants.MAX_PACKET_SIZE;
        const chunks = packet.chunks(
            chunkSize, this._encrypt.bind(this), this.protocolVersion
        );

        let inFlight = 0;
        let drained = null;
        let failure = null;

        const settle = () => {
            inFlight--;
            if (drained) {
                const wake = drained;
                drained = null;
                wake();
            }
        };
        const waitForRoom = () => new Promise((wake) => { drained = wake; });

        (async () => {
            for await (const chunk of chunks) {
                if (failure) throw failure;
                while (inFlight >= window) {
                    await waitForRoom();
                    if (failure) throw failure;
                }

                inFlight++;
                this._packetQueue.push({
                    packet: chunk,
                    resolve: settle,
                    reject: (e) => {
                        failure = failure || e;
                        settle();
                    }
                });
            }

            while (inFlight > 0) await waitForRoom();
            if (failure) throw failure;

            resolve();
        })().catch(reject);
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
        return !!this[ENCRYPTION_PRIVATE] || !!(this[E2E_SESSION] && this[E2E_SESSION].ready);
    }

    /**
     * The channel this connection ended up on, for an application that
     * wants to pin its own auth to it. Equal on both ends, and different if
     * anything in the handshake differed — including a forced downgrade.
     */
    getChannelBinding() {
        const session = this[E2E_SESSION];
        return session && session.ready ? session.binding.slice() : null;
    }

    e2eInfo() {
        const session = this[E2E_SESSION];
        if (!session || !session.ready) {
            return this[ENCRYPTION_PRIVATE]
                ? { protocolVersion: 0, kex: "secp521r1", cipher: "aes-256-cbc" }
                : null;
        }
        return { protocolVersion: 1, kex: session.kex, cipher: session.cipher, authenticated: !!session.authenticated };
    }

    /**
     * Encrypt this connection, resolving once it is live.
     *
     * Either end may call it and both may call it at once: the 1.0 exchange
     * is symmetric, so the two offers simply cross and each side derives the
     * same keys from them. There is no initiator to elect, which is what the
     * caller used to have to do for itself.
     */
    e2e() {
        if (this[E2E_PENDING]) return this[E2E_PENDING].promise;

        let settle;
        const promise = new Promise((resolve, reject) => { settle = { resolve, reject }; });
        // Called and forgotten as often as send() is, so a failure must not
        // surface as an unhandled rejection; an awaiting caller still sees it.
        promise.catch(() => {});
        this[E2E_PENDING] = { promise: promise, resolve: settle.resolve, reject: settle.reject };

        if (this.hasE2EEnabled()) {
            this._e2eSettled();
            return promise;
        }

        if (this.protocolVersion >= constants.PROTOCOL_VERSION) {
            this._offerE2E().catch((e) => this.disconnect(e));
        } else {
            if (!this.options.allowLegacyE2E) {
                this[E2E_PENDING].reject(errors.refused(
                    "Legacy e2e is disabled, and this peer cannot do the 1.0 exchange"));
                this[E2E_PENDING] = null;
                return promise;
            }
            this._legacyE2E();
        }

        return promise;
    }

    _e2eSettled() {
        const pending = this[E2E_PENDING];
        if (pending) pending.resolve(this);
    }

    /** Send our half of the exchange. The same message whichever end sends it. */
    async _offerE2E() {
        if (this[E2E_OFFER]) return;

        this[E2E_OFFER] = await E2E.createOffer({ ciphers: this.options.e2eCiphers || undefined });
        if (this.state != constants.PROTOCOL_STATES.SWITCHING_PROTOCOL) {
            this.changeState(constants.PROTOCOL_STATES.SWITCHING_PROTOCOL);
        }
        await this.send(Packet.data(this[E2E_OFFER].wire).setType(Packet.TYPE.SWITCH));
    }

    /**
     * The peer's half. Derives the keys and turns encryption on.
     *
     * Runs to completion before the next received frame is processed, because
     * the receive queue takes one frame at a time — so there is no window
     * where the peer is encrypting and we are not yet ready to decrypt.
     */
    async _acceptE2E(offer) {
        await this._offerE2E();

        const mine = this[E2E_OFFER];
        const kex = E2E.chooseKex(mine.wire.kex, offer.kex);
        const cipher = E2E.chooseCipher(mine.wire.ciphers, offer.ciphers);
        if (!kex || !cipher) {
            throw new Error("no e2e suite in common with " + this.peerID);
        }
        if (!offer.keys || !offer.keys[kex] || !offer.nonce) {
            throw new Error("malformed e2e offer from " + this.peerID);
        }

        const session = await E2E.derive({
            kex: kex,
            cipher: cipher,
            protocolVersion: this.protocolVersion,
            capabilities: this.capabilities,
            localID: this.anysocket.id,
            remoteID: this.peerID,
            localPrivateKey: mine.privates[kex],
            localPublicKey: Frame.fromBase64(mine.wire.keys[kex]),
            localNonce: mine.nonce,
            remotePublicKey: Frame.fromBase64(offer.keys[kex]),
            remoteNonce: Frame.fromBase64(offer.nonce),
            // Only ever set on a connection whose built-in auth succeeded, so the
            // peer has proved it holds the same secret.
            psk: this.anysocket.authSecret() || null
        });

        session.sendCounter = 0;
        session.recvCounter = 0;
        session.ready = true;
        this[E2E_SESSION] = session;

        this.ENCRYPTION_STATE = constants.PROTOCOL_ENCRYPTION.E2EE;
        this.changeState(constants.PROTOCOL_STATES.CONNECTED);
        debug(this.peerID, "e2e up:", session.kex, session.cipher);
        this.emit("e2e", this);
        this._e2eSettled();
    }

    _legacyE2E() {
        // Idempotent. A second call while a switch is in flight — or after one
        // finished — used to start a second key exchange and desync the two
        // ends. Both sides calling e2e() at once is still the caller's problem
        // until 1.0 lands initiator election.
        if (this[ENCRYPTION_STARTING] ||
            this[ENCRYPTION_PRIVATE] ||
            this.state == constants.PROTOCOL_STATES.SWITCHING_PROTOCOL ||
            this.ENCRYPTION_STATE == constants.PROTOCOL_ENCRYPTION.E2EE) {
            return;
        }
        this[ENCRYPTION_STARTING] = true;

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
        return new Promise((resolve, reject) => {
            let invalidPacket = true;

            if (Packet.isForwardPacket(recv)) {
                if (!this._acceptForward(recv)) {
                    return resolve();
                }
                resolve();
            } else {
                let seq = Packet.getSeq(recv);

                if (!this._packets[seq]) {
                    // Reassembly used to be unbounded, so a peer could hold
                    // memory open with partial packets it never finished —
                    // before authenticating, where only AUTH is even legal.
                    const limit = this.state == constants.PROTOCOL_STATES.CONNECTED
                        ? this.options.maxPartialPackets
                        : 1;
                    if (Object.keys(this._packets).length >= limit) {
                        this.disconnect("Too many partial packets");
                        return resolve();
                    }
                    this._packets[seq] = Packet.buffer();
                }
                let packet = this._packets[seq];

                const cap = this.state == constants.PROTOCOL_STATES.CONNECTED
                    ? this.options.maxMessageSize
                    : this.options.maxHandshakeMessageSize;
                packet.bytes = (packet.bytes || 0) + recv.length;
                if (packet.bytes > cap) {
                    delete this._packets[seq];
                    this.disconnect("Message too large");
                    return resolve();
                }

                packet.deserialize(recv, encryptionState, this._decrypt.bind(this))
                    .then(result => {
                        debug(this.peerID, "<<<<", Packet.TYPE._string(packet.type), packet.seq);
                        if (result) {
                            delete this._packets[seq];

                            // Undecodable payload. It used to be dispatched with
                            // data = null, so handlers saw a packet that never
                            // existed; drop the connection instead.
                            if (packet.parseError) {
                                this.disconnect("Invalid Packet!");
                                return resolve();
                            }

                            switch (this.state) {
                                case constants.PROTOCOL_STATES.ESTABLISHED:
                                    if (packet.type == Packet.TYPE.AUTH) {
                                        invalidPacket = false;
                                        this._handleAuth(packet, false).then(resolve);
                                    } else if (packet.type == Packet.TYPE.AUTH_CONFIRM) {
                                        invalidPacket = false;
                                        this._handleAuthConfirm(packet).then(resolve);
                                    }
                                    break;
                                case constants.PROTOCOL_STATES.AUTHING:
                                    if (packet.type == Packet.TYPE.AUTH) {
                                        invalidPacket = false;
                                        this._handleAuth(packet, true).then(resolve);
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

                                        if (this._isE2EOffer(packet.data)) {
                                            this._acceptE2E(packet.data)
                                                .then(resolve)
                                                .catch((e) => { this._e2eFailed(e); resolve(); });
                                            break;
                                        }

                                        if (!this.options.allowLegacyE2E) {
                                            this.disconnect("Legacy e2e refused");
                                            resolve();
                                            break;
                                        }

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

                                        if (this._isE2EOffer(packet.data)) {
                                            this._acceptE2E(packet.data)
                                                .then(resolve)
                                                .catch((e) => { this._e2eFailed(e); resolve(); });
                                            break;
                                        }

                                        if (!this.options.allowLegacyE2E) {
                                            this.disconnect("Legacy e2e refused");
                                            resolve();
                                            break;
                                        }
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

    _isE2EOffer(data) {
        return this.protocolVersion >= constants.PROTOCOL_VERSION && !!data && data.v === 1;
    }

    _e2eFailed(reason) {
        const pending = this[E2E_PENDING];
        if (pending) pending.reject(reason);
        this.disconnect(reason);
    }

    /** Our AUTH packet. Identical whichever end sends it. */
    _authPacket(extra, precomputed) {
        const data = {
            id: this.anysocket.id,
            auth: precomputed ? precomputed.value : this.anysocket.authPacket(),
            pv: constants.PROTOCOL_VERSION,
            caps: this.options.capabilities
        };

        if (this.anysocket.authSecret()) {
            if (!this[AUTH_CHALLENGE]) this[AUTH_CHALLENGE] = Auth.challenge();
            data.ac = Frame.toBase64(this[AUTH_CHALLENGE]);
        }

        return Packet.data(Object.assign(data, extra)).setType(Packet.TYPE.AUTH);
    }

    /**
     * The dialer's proof, which is the last thing the listener waits for.
     *
     * Only reachable while the listener is still in the handshake, so it cannot
     * be used to re-authenticate a live connection.
     */
    async _handleAuthConfirm(packet) {
        const secret = this.anysocket.authSecret();
        if (!secret || !this.peerID || !this[AUTH_PEER_CHALLENGE]) {
            return this.disconnect("Unexpected Auth Confirm!");
        }

        if (!await Auth.verify(secret, this._authParams(this.peerID), packet.data && packet.data.ap)) {
            debug(this.peerID, "refused: bad auth proof from the dialer");
            return this.disconnect("Invalid Auth Packet!");
        }

        this.changeState(constants.PROTOCOL_STATES.CONNECTED);
        this.emit("ready", this);
    }

    /** What both ends sign: the two challenges, the two ids, the version. */
    _authParams(proofFor) {
        return {
            protocolVersion: this.protocolVersion,
            capabilities: this.capabilities,
            localID: this.anysocket.id,
            localChallenge: this[AUTH_CHALLENGE],
            remoteID: this.peerID,
            remoteChallenge: this[AUTH_PEER_CHALLENGE],
            proofFor: proofFor
        };
    }

    /**
     * Take in the peer's challenge. A secret on our side means the peer
     * must be offering the built-in auth too: letting a peer decline it
     * would make requiring it pointless.
     */
    _acceptChallenge(data) {
        if (!this.anysocket.authSecret()) return true;

        if (!data || typeof data.ac != "string" || !data.ac) {
            debug(this.peerID, "refused: peer did not offer the built-in auth");
            return false;
        }

        try {
            this[AUTH_PEER_CHALLENGE] = Frame.fromBase64(data.ac);
        } catch (e) {
            return false;
        }

        return this[AUTH_PEER_CHALLENGE].length == Auth.CHALLENGE_BYTES;
    }

    /**
     * Settle what this connection speaks, from the peer's announcement.
     *
     * Both ends announce and the result is the intersection, so neither side
     * decides for the other and both compute the same answer from the same two
     * inputs — nothing here depends on who dialled. The intersection is sorted
     * so the order each side happened to declare cannot change the outcome,
     * which matters once the result is folded into a transcript hash.
     *
     * A 0.4.x peer sends no `pv`, which reads as legacy and keeps the whole
     * connection on the old frame format.
     */
    _negotiate(data) {
        const remote = Number.isInteger(data && data.pv) ? data.pv : constants.PROTOCOL_VERSION_LEGACY;
        const remoteCaps = Array.isArray(data && data.caps) ? data.caps : [];

        this.remoteProtocolVersion = remote;
        this.protocolVersion = Math.min(constants.PROTOCOL_VERSION, Math.max(remote, constants.PROTOCOL_VERSION_LEGACY));
        this.capabilities = (this.options.capabilities || [])
            .filter((cap) => remoteCaps.indexOf(cap) != -1)
            .sort();

        debug(this.peerID, "negotiated pv", this.protocolVersion, "caps", this.capabilities);
    }

    /**
     * Validate a received AUTH packet and advance the handshake.
     *
     * `onAuth` is awaited, so an `async onAuth` is finally enforced — before
     * 1.0 it returned a Promise, which is truthy, so every peer passed.
     *
     * A synchronous `onAuth` resolves on the microtask queue, and microtasks
     * cannot let another connection's socket event run in between, so a caller
     * that pairs `onAuth` with the `authPacket()` immediately after it — issuing
     * a challenge in one and answering it in the other — keeps that guarantee.
     * A genuinely async `onAuth` does not; such callers should move to the
     * built-in challenge-response auth.
     *
     * @param isReply true when we dialed and this is the listener's AUTH reply.
     */
    async _handleAuth(packet, isReply) {
        let ok = false;
        try {
            ok = !!(packet.data && packet.data.id) && !!(await this.anysocket.onAuth(packet.data));
        } catch (e) {
            debug("onAuth threw", e);
        }

        if (!ok) {
            return this.disconnect("Invalid Auth Packet!");
        }

        // Dialled ourselves — an address list that includes our own. Nothing
        // useful can come of it, and left alone it would reach the duplicate
        // rule with both ends being the same instance.
        if (packet.data.id === this.anysocket.id) {
            return this.disconnect("Connected to self");
        }

        this.peerID = packet.data.id;
        this._negotiate(packet.data);

        const secret = this.anysocket.authSecret();
        if (secret) {
            if (!this._acceptChallenge(packet.data)) {
                return this.disconnect("Invalid Auth Packet!");
            }
            // Our own challenge has to exist before anything is signed over it.
            // The listener has not sent an AUTH packet yet at this point, so
            // nothing else would have created one.
            if (!this[AUTH_CHALLENGE]) this[AUTH_CHALLENGE] = Auth.challenge();
        }

        if (isReply) {
            // We dialed. The listener answered with its own challenge and its
            // proof; check it, then prove ourselves against its challenge.
            if (secret) {
                if (!await Auth.verify(secret, this._authParams(this.peerID), packet.data.ap)) {
                    debug(this.peerID, "refused: bad auth proof from the listener");
                    return this.disconnect("Invalid Auth Packet!");
                }

                try {
                    await this.send(Packet.data({
                        ap: await Auth.prove(secret, this._authParams(this.anysocket.id))
                    }).setType(Packet.TYPE.AUTH_CONFIRM));
                } catch (e) {
                    return;
                }
            }

            this.changeState(constants.PROTOCOL_STATES.CONNECTED);
            this.emit("ready", this);
            return;
        }

        if (secret) {
            // We are the listener. Answer with our challenge and our proof, and
            // stay out of CONNECTED until the dialer has proved itself in turn —
            // otherwise only one direction would ever be authenticated.
            //
            // authPacket() is taken now, before signing. Signing is real
            // asynchronous work, during which another connection's AUTH can be
            // handled — so a caller pairing its onAuth with the authPacket() that
            // follows would otherwise be handed the wrong connection's value.
            const custom = { value: this.anysocket.authPacket() };
            try {
                const proof = await Auth.prove(secret, this._authParams(this.anysocket.id));
                await this.send(this._authPacket({ ap: proof }, custom));
            } catch (e) {
                // send() already tore the connection down.
            }
            return;
        }

        // We are the listener: answer with our own AUTH, then go live. Note the
        // peer is validated before the state change, so the link queues never
        // resume for a connection that is about to be dropped.
        try {
            await this.send(this._authPacket());
        } catch (e) {
            // send() already tore the connection down.
            return;
        }

        this.changeState(constants.PROTOCOL_STATES.CONNECTED);
        this.emit("ready", this);
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
        const pending = this[E2E_PENDING];
        if (pending && !this.hasE2EEnabled()) {
            this[E2E_PENDING] = null;
            pending.reject(reason instanceof Error ? reason : new Error(String(reason)));
        }

        this.changeState(constants.PROTOCOL_STATES.DISCONNECTED);
        this._heartbeat();

        if (this.isProxy()) {
            this.anysocket.unproxy(this.peer.id, this.peer.socket.id, reason);
        } else {
            this.peer.disconnect(reason);
        }
    }

    processPacketQueue(item, cb) {
        const fail = (e) => {
            item.reject(e);
            this._packetQueue.kill();
            cb(null, null);
        };
        const send = (payload) => this.peer.send(payload).then(() => {
            if (item.resolve)
                item.resolve();

            cb(null, null);
        }, fail);

        let sealed;
        try {
            sealed = this._sealFrame(item.packet);
        } catch (e) {
            return fail(e);
        }
        if (sealed && typeof sealed.then === "function") sealed.then(send, fail);
        else send(sealed);
    }

    processLinkPacketQueue(item, cb) {
        this._send(item.packet, item.resolve, item.reject);
        cb(null, null);
    }

    processRecvPacketQueue(item, cb) {
        const reject = (e) => {
            debug(this.peerID, "frame rejected:", e && e.message);
            this.disconnect("Invalid encrypted frame");
            cb(null, null);
        };
        const route = (recv) => {
            item.recv = recv;
            this._routeRecvPacket(item, cb);
        };

        let opened;
        try {
            opened = this._openFrame(item.recv);
        } catch (e) {
            return reject(e);
        }
        if (opened && typeof opened.then === "function") opened.then(route, reject);
        else route(opened);
    }

    _routeRecvPacket(item, cb) {
        if(Packet.isForwardPacket(item.recv)) {
            this._acceptForward(item.recv);
            cb(null, null);
        } else {
            if(this.isLINKMessage(Packet.getType(item.recv))) {
                item.state = this.ENCRYPTION_STATE;
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
        // On a 1.0 connection the frame is sealed as a whole further down, in
        // wire order; the per-chunk hook is only the 0.4.x path.
        if (this.protocolVersion >= constants.PROTOCOL_VERSION) {
            return Promise.resolve(packet);
        }

        return new Promise(resolve => {
            switch (this.ENCRYPTION_STATE) {
                case constants.PROTOCOL_ENCRYPTION.PLAIN:
                    resolve(packet);
                    break;
                case constants.PROTOCOL_ENCRYPTION.E2EE:
                    Utils.getAESSessionKey(this[ENCRYPTION_SECRET], this[ENCRYPTION_NONCE], seq)
                        .then((secretKey) => {
                            // A 1.0 frame carries bytes, and hex-encoding
                            // them would double every encrypted message.
                            if (typeof packet != "string") {
                                return Utils.encryptAESBytes(secretKey, packet).then(resolve);
                            }
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
        if (this.protocolVersion >= constants.PROTOCOL_VERSION) {
            return Promise.resolve(packet);
        }

        return new Promise(resolve => {
            switch (encryptionState) {
                case constants.PROTOCOL_ENCRYPTION.PLAIN:
                    resolve(packet);
                    break;
                case constants.PROTOCOL_ENCRYPTION.E2EE:
                    Utils.getAESSessionKey(this[ENCRYPTION_SECRET], this[ENCRYPTION_NONCE], seq)
                        .then((secretKey) => {
                            if (typeof packet != "string") {
                                return Utils.decryptAESBytes(secretKey, packet).then(resolve);
                            }
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

    /**
     * Gate on a FORWARD frame before anyone acts on it.
     *
     * These used to be handled whatever state the connection was in, so a
     * socket that had not authenticated could have its relayed payload
     * delivered — and the `from` it carries is written by the sender, so it
     * could name any peer. Only a connection that finished the handshake may
     * relay, and AnySocket.onForward re-checks `from` against the peer id we
     * authenticated on THIS connection.
     *
     * @returns true when the frame was handed on.
     */
    _acceptForward(recv) {
        if (this.state != constants.PROTOCOL_STATES.CONNECTED || !this.peerID) {
            this.disconnect("FORWARD before the handshake completed");
            return false;
        }

        this.emit("forward", this.peerID, this._decodeForwardPacket(recv));
        return true;
    }

    /**
     * Encrypt a 1.0 frame on its way out.
     *
     * Done here, in the queue that feeds the socket, because this is the only
     * point where frames are in their final order — two messages serialising
     * at once would otherwise take counters in one order and reach the wire in
     * another. The counter is therefore implied by position in the stream and
     * never sent. The header travels authenticated but in clear, so a frame
     * that was altered, replayed or reordered simply fails to open.
     */
    _sealFrame(packet) {
        const session = this[E2E_SESSION];
        if (!session || !session.ready || !Frame.isFrame(packet)) return packet;

        const bytes = Frame.asBytes(packet);
        const plaintext = bytes.subarray(Frame.HEADER_SIZE);
        const header = bytes.slice(0, Frame.HEADER_SIZE);
        header[0] |= Frame.FLAGS.ENCRYPTED;
        // Taken now, synchronously: this queue is the only place frames are in
        // their final order, so this is the only place a counter can be.
        const counter = session.sendCounter++;

        // Where the runtime can seal synchronously, the whole frame — header,
        // ciphertext, tag — is one allocation and there is no thread-pool
        // round trip, which on a small frame is most of the cost.
        if (E2E.sealsInPlace(session.sendKey)) {
            const out = new Uint8Array(Frame.HEADER_SIZE + plaintext.length + E2E.TAG_BYTES);
            out.set(header, 0);
            return E2E.sealInto(session.sendKey, counter, header, plaintext, out, Frame.HEADER_SIZE);
        }

        return E2E.seal(session.sendKey, counter, header, plaintext)
            .then((sealed) => Frame.concat([header, sealed]));
    }

    /**
     * Decrypt a 1.0 frame on the way in, in arrival order.
     *
     * Once encryption is up every frame must be encrypted, and before it is up
     * none may be: either mismatch is a downgrade attempt and drops the
     * connection rather than being quietly tolerated.
     */
    _openFrame(recv) {
        if (!Frame.isFrame(recv)) return recv;

        const bytes = Frame.asBytes(recv);
        const encrypted = !!(bytes[0] & Frame.FLAGS.ENCRYPTED);
        const session = this[E2E_SESSION];

        if (!session || !session.ready) {
            if (encrypted) throw new Error("encrypted frame before e2e was established");
            return recv;
        }
        if (!encrypted) throw new Error("plaintext frame after e2e was established");

        const header = bytes.subarray(0, Frame.HEADER_SIZE);
        const counter = session.recvCounter;
        const reframe = (plaintext) => {
            // Advanced only once the frame has verified, so a forged one cannot
            // push the counter past the frame that really comes next.
            session.recvCounter = counter + 1;
            const out = new Uint8Array(Frame.HEADER_SIZE + plaintext.length);
            out.set(header, 0);
            out.set(plaintext, Frame.HEADER_SIZE);
            out[0] &= ~Frame.FLAGS.ENCRYPTED;
            return out;
        };

        const opened = E2E.open(session.recvKey, counter, header, bytes.subarray(Frame.HEADER_SIZE));
        return opened && typeof opened.then === "function" ? opened.then(reframe) : reframe(opened);
    }

    /**
     * Wrap a relayed frame for the next hop.
     *
     * Addresses are anysocket ids — UUIDv4, so 32 hex characters — and travel
     * as the 16 bytes they actually are. On a 1.0 hop the whole thing is a
     * proper frame, so the relayed payload keeps its own bytes and does not
     * have to survive being read as text.
     */
    _encodeForwardPacket(to, from, msg) {
        if (this.protocolVersion < constants.PROTOCOL_VERSION) {
            return Packet.TYPE.FORWARD +
                AnyPacker.packHex(to) +
                AnyPacker.packHex(from) +
                msg
                ;
        }

        return Frame.encode({
            flags: Frame.FLAGS.FINAL | Frame.FLAGS.FIRST | Frame.FLAGS.BINARY,
            type: Packet.TYPE.FORWARD,
            seq: 0,
            payload: Frame.concat([
                Frame.idToBytes(to),
                Frame.idToBytes(from),
                Frame.asBytes(msg)
            ])
        });
    }

    _decodeForwardPacket(recv) {
        if (!Frame.isFrame(recv)) {
            const text = Frame.legacyText(recv);
            return {
                to: AnyPacker.unpackHex(text.substr(1, 16)),
                from: AnyPacker.unpackHex(text.substr(17, 16)),
                msg: text.substr(33)
            };
        }

        const payload = Frame.decode(recv).payload;
        return {
            to: Frame.idFromBytes(payload, 0),
            from: Frame.idFromBytes(payload, Frame.ID_BYTES),
            msg: payload.subarray(Frame.ID_BYTES * 2)
        };
    }

    _getSeq() {
        // max 4 bytes
        if (this._seq >= 2147483647) {
            this._seq = 0;
        }
        this._seq++;

        return this._seq;
    }

    _heartbeat(ponged) {
        ponged = ponged || false;
        // proxies are notified by peers if they disconnect
        if(this.isProxy())
            return;

        clearTimeout(this[heartbeatTimer]);

        // Heartbeats disabled — rely on transport-level liveness (TCP
        // keepalive / WebSocket ping / app-level signals). Any still-pending
        // timer is cleared above so state stays consistent if the option is
        // flipped off after startup.
        if(!this.options.heartbeatEnabled)
            return;

        if(ponged) {
            this._heartbeatPong();
        }

        // Nothing may go out in clear once the peer has turned encryption on,
        // and the peer turns it on as soon as it sees our offer. Link traffic
        // is already paused while switching; this keeps heartbeats from
        // slipping out in the same window.
        if(this.state == constants.PROTOCOL_STATES.AUTHING ||
            this.state == constants.PROTOCOL_STATES.SWITCHING_PROTOCOL ||
            this.state == constants.PROTOCOL_STATES.DISCONNECTED)
            return;

        this[heartbeatTimer] = setTimeout(() => {
            if (!this[heartbeatPonged]) {
                this[heartbeatsMissed]++;

                if(this[heartbeatsMissed] >= this.options.heartbeatsMaxMissed) {
                    this.disconnect("Missed Heartbeats");
                    return;
                }

                // Resend a fresh probe in case the original heartbeat was lost
                // in transit (common on lossy wifi). Any incoming packet —
                // including a late pong for the original — will still reset
                // state via peer.on("message") → _heartbeat(true).
                const probe = Packet
                    .data(1)
                    .setType(Packet.TYPE.HEARTBEAT);
                this.send(probe).catch((e) => {
                    debug("Heartbeat Error:", e);
                    this.disconnect(e);
                });

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

    _heartbeatPong(data) {
        if(this.state == constants.PROTOCOL_STATES.SWITCHING_PROTOCOL)
            return;

        if(data == 1) {
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
            this[heartbeatsMissed] = 0;
        }
    }

    isLINKMessage(type) {
        return [Packet.TYPE.INTERNAL, Packet.TYPE.LINK].indexOf(type) != -1;
    }
};