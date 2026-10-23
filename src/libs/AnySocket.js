const debug = require('debug')('AnySocket');
const fs = require("fs");
const EventEmitter = require("../wrappers/events-wrapper");
const Utils = require("../wrappers/utils");
const BufferUtils = require("../wrappers/utils_buffer");
const constants = require("./_constants");
const AnyHTTPPeer = require("./AnyHTTPPeer");
const AnyRouter = require("./AnyHTTPRouter");
const Packet = require("./Packet");
const Maintainer = require("./Maintainer");

/**
 * A thrown Error has no enumerable fields, so JSON.stringify turned every
 * rejected RPC into {} on the wire. Reduce whatever was thrown to a string
 * the caller can actually read.
 */
const errorMessage = (e) => {
    if (e instanceof Error) return e.message || e.name || "Error";
    if (typeof e === "string") return e;
    if (e && typeof e.message === "string") return e.message;
    try { return JSON.stringify(e); } catch (_) { return String(e); }
};

const _private = {
    peersConnected: Symbol("peers connected"),
    peers: Symbol("ready peers"),
    transports: Symbol("transports"),
    onForward: Symbol("onForward"),
    onPeerConnected: Symbol("onPeerConnected"),
    onProtocolReady: Symbol("onPeerReady"),
    onPeerDisconnected: Symbol("onPeerDisconnected"),
    onPeerInternalMessage: Symbol("onPeerInternalMessage"),
    findTransport: Symbol("findTransport"),
    startTransport: Symbol("startTransport"),
    httpServerFor: Symbol("httpServerFor"),
    keepsExisting: Symbol("keepsExisting"),
    httpBundle: Symbol("http bundle js"),
    httpServer: Symbol("HTTPServer"),
    httpServers: Symbol("HTTP servers by port"),
    maintainers: Symbol("maintainers")
};

const AnyPeer = require("./AnyPeer");
const AnyProtocol = require("./AnyProtocol");
const ProxyPeer = require("./ProxyPeer");

class AnySocket extends EventEmitter {
    constructor(options) {
        super();

        this.options = Object.assign({}, options);
        this._started = false;
        this.id = Utils.uuidv4();
        this.http = new AnyRouter();
        debug("AnySocketID:", this.id);

        this.rpc = {};
        this[_private.peersConnected] = {};
        this[_private.peers] = {};
        this[_private.transports] = {};
        this[_private.httpServer] = null;
        this[_private.httpServers] = new Map();
        this[_private.maintainers] = new Set();
        if (typeof window === 'undefined') {
            // nodejs
            this[_private.httpBundle] = fs.readFileSync(__dirname + "/../../dist/anysocket.browser.js");
        }

        return this;
    }

    filter(options) {
        // something smart to filter
    }

    broadcast(message, awaitReply) {
        awaitReply = awaitReply || false;

        // Resolves with one entry per peer — including an empty array when
        // there are none. It used to await inside the loop and never settle
        // for an instance with no peers.
        const promises = [];
        for (let id in this[_private.peers]) {
            promises.push(this[_private.peers][id].send(message, awaitReply));
        }

        const result = Promise.all(promises);
        result.catch(() => {});
        return result;
    }

    setRPC(rpc) {
        this.rpc = rpc;
    }

    canProxy(peerID, otherPeerID) {
        return false;
    }

    proxy(peerID, throughPeerID) {
        return new Promise((resolve, reject) => {
            if(peerID == throughPeerID || peerID == this.id) {
                reject("Cannot proxy loopback!");
                return;
            }
            if(this[_private.peers][throughPeerID].isProxy())
            {
                // TODO: this requires to implement a full network graph (map)
                // TODO: this will enable to send messages without having multiple forward headers
                reject("Cannot proxy via a proxy! atm... :)");
                return;
            }
            if(!this[_private.peers][throughPeerID].supportsRelay()) {
                reject("Cannot proxy: the relay connection is not protocol version 1");
                return;
            }

            this[_private.peers][throughPeerID].sendInternal({
                type: constants.INTERNAL_PACKET_TYPE.PROXY,
                action: "proxy",
                id: peerID
            }, true).then((packet) => {
                if(packet.msg.ok && !this[_private.peers][peerID]) {
                    let protocol = new AnyProtocol(this, new ProxyPeer(true, this.id, peerID, this[_private.peers][throughPeerID]), this[_private.peers][throughPeerID].options);
                    this[_private.onProtocolReady](protocol);
                    resolve(this[_private.peers][peerID]);
                } else {
                    reject("Cannot proxy" + (packet.msg.reason ? ": " + packet.msg.reason : "!"));
                }
            }).catch(reject);
        })
    }

    unproxy(peerID, throughPeerID, reason) {
        reason = reason || "Proxy Connection Closed";
        if(this[_private.peers][peerID] && this[_private.peers][peerID].isProxy() ) {
            this[_private.peers][throughPeerID].sendInternal({
                type: constants.INTERNAL_PACKET_TYPE.PROXY,
                action: "unproxy",
                id: peerID
            });
            this[_private.onPeerDisconnected](this[_private.peers][peerID], reason);
        }
    }

    hasPeer(id) {
        return !!this[_private.peers][id];
    }

    /** The connected peer with this id, or null. */
    getPeer(id) {
        return this[_private.peers][id] || null;
    }

    /**
     * Keep a peer connected: dial it, and dial it again with backoff whenever the
     * link drops. Returns a handle with connected / disconnected / retry /
     * abandoned events, fail(reason) and stop(). See Maintainer for the policy
     * options and what it does beyond a plain retry loop.
     */
    maintain(scheme, ip, port, options, policy) {
        const handle = new Maintainer(this, { scheme: scheme, ip: ip, port: port, options: options }, policy);
        this[_private.maintainers].add(handle);
        return handle;
    }

    _forgetMaintainer(handle) {
        this[_private.maintainers].delete(handle);
    }

    hasDirectPeer(id) {
        return !!(this[_private.peers][id] && !this[_private.peers][id].isProxy());
    }

    //region Networking Connect/Listen/Stop
    server(scheme, options) {
        return this.listen(scheme, options);
    }

    /**
     * Start listening. Resolves with the port actually bound, so port 0
     * ("any free port") is usable.
     *
     * ws rides on an http server, and http and ws asked for on the same
     * port share one — that is how the http router and websocket upgrades
     * live together. Three things used to go wrong here:
     *
     * - The http server was started without being awaited, so a failure
     *   to bind raised a second rejection nobody could catch. Under node's
     *   default that **crashes the process**, even when the caller handles
     *   the error from listen() itself.
     * - There was a single http-server slot, so a second ws listen —
     *   another port, or a retry after a failure — reused the first server
     *   and never bound anything.
     * - `port || 80` made port 0 impossible.
     */
    listen(scheme, options) {
        // server
        this._started = true;
        options = options || {};
        if(typeof options == 'number'){
            options = { port: options };
        }

        options.ip = options.ip || "0.0.0.0";
        // ipc listens on a path, not a port; everything else needs a port (or 0
        // for any free one), except http and ws, which default to 80.
        const kind = scheme.toLowerCase();
        if(kind == "ipc") {
            if(!options.path) throw new Error("ipc needs a path");
        } else if(["http", "ws"].indexOf(kind) == -1 && options.port == null) {
            throw new Error("Invalid port!");
        }

        if(scheme.toLowerCase() == "ws") {
            return this[_private.httpServerFor](options).then(({ server, port }) => {
                // Keep the caller's options and only add the server to them. They
                // used to be replaced outright, so everything a listening side
                // configured — auth/e2e timeouts, heartbeat settings, receive
                // limits — was silently dropped for the ws transport, and only
                // dialling peers ever had their options honoured.
                return this[_private.startTransport]("ws", Object.assign({}, options, { server: server }))
                    .then(() => port);
            });
        }

        if(scheme.toLowerCase() == "http") {
            return this[_private.httpServerFor](options).then(({ port }) => port);
        }

        return this[_private.startTransport](scheme, options).then((result) => {
            return result === undefined ? options.port : result;
        });
    }

    connect(scheme, ip, port, options) {
        return new Promise((resolve, reject) => {
            this._started = true;
            options = Object.assign(options || {}, {
                ip: ip,
                port: port
            });

            // client
            let transport = this[_private.findTransport](scheme);
            transport = new transport("client", options);

            // start transport
            transport.on("connected", (peer) => {
                this[_private.transports][transport.id] = transport;
                this[_private.onPeerConnected](peer, transport.options, resolve);
                debug("Transports Added", transport.id, Object.keys(this[_private.transports]).length);
            });
            transport.on("disconnected", (peer, reason) => {
                this[_private.transports][transport.id].stop();
                delete this[_private.transports][transport.id];
                this[_private.onPeerDisconnected](peer, reason);
                debug("Transports left", transport.id, Object.keys(this[_private.transports]).length);

                // protocol was never ready
                if(!this[_private.peers][peer.id]) {
                    reject(reason);
                }
            });
            transport.connect().catch(reject);
        });
    }

    stop() {
        this._started = false;
        // Before anything closes, or each closing link would be redialled.
        for (const handle of Array.from(this[_private.maintainers])) handle.stop();
        return new Promise((resolve, reject) => {
            const promises = [];
            for (let id in this[_private.transports]) {
                promises.push(
                    this[_private.transports][id].stop()
                );
            }

            Promise.all(promises).then(() => {
                this[_private.peersConnected] = {};
                this[_private.peers] = {};
                this[_private.transports] = {};
                // Closed servers must not be found by a later listen() on the
                // same port, or the ws side would attach to one and wait forever.
                this[_private.httpServer] = null;
                this[_private.httpServers] = new Map();

                resolve();
            }).catch(reject);
        });
    }

    onAuth(packet) {
        return true;
    }

    /**
     * The shared secret for the built-in mutual auth, if one was given as
     * `new AnySocket({ auth: { secret } })`. With a secret set, a peer that
     * cannot prove it is refused, and a peer that does not offer the
     * built-in auth at all is refused too — otherwise an attacker could
     * simply decline it.
     */
    authSecret() {
        return (this.options.auth && this.options.auth.secret) || null;
    }

    authPacket() {
        return undefined;
    }

    //endregion

    //region Private Functions

    /** Create a transport, wire it up, and start it listening. */
    [_private.startTransport](scheme, options) {
        let transport = this[_private.findTransport](scheme);
        transport = new transport("server", options);
        this[_private.transports][transport.id] = transport;

        transport.on("connected", (peer) => {
            this[_private.onPeerConnected](peer, transport.options);
        });
        transport.on("disconnected", (peer, reason) => {
            this[_private.onPeerDisconnected](peer, reason);
        });

        return transport.listen().then((result) => {
            if (scheme == "http") {
                this[_private.httpServer] = transport.server;
            }
            return result === undefined ? transport.port : result;
        }).catch((e) => {
            // A transport that never came up must not linger, or stop() would
            // try to stop it and a retry would trip over it.
            delete this[_private.transports][transport.id];
            throw e;
        });
    }

    /**
     * The http server a ws listen should ride on: the one already serving
     * that port if there is one, otherwise a new one. Port 0 never shares —
     * each such request is for a fresh port of its own.
     */
    [_private.httpServerFor](options) {
        const requested = options.port == null ? 80 : options.port;
        const shareable = requested !== 0;

        if (shareable && this[_private.httpServers].has(requested)) {
            return this[_private.httpServers].get(requested);
        }

        const starting = this[_private.startTransport]("http", Object.assign({}, options))
            .then((port) => {
                const transport = Object.values(this[_private.transports])
                    .find((t) => t.type == "http" && t.port == port);
                const entry = { server: transport ? transport.server : this[_private.httpServer], port: port };
                // Also findable by the port it actually bound — which is the only
                // way to share one that was asked for as port 0.
                this[_private.httpServers].set(port, Promise.resolve(entry));
                return entry;
            })
            .catch((e) => {
                // Forget a server that failed to bind, so a retry starts clean.
                if (shareable) this[_private.httpServers].delete(requested);
                throw e;
            });

        if (shareable) this[_private.httpServers].set(requested, starting);
        return starting;
    }
    [_private.findTransport](scheme) {
        for (let name in AnySocket.Transport) {
            if(!AnySocket.Transport.hasOwnProperty(name))
                continue;

            const candidate = AnySocket.Transport[name];
            // The browser build stubs out the transports it cannot have, so not
            // every entry is a transport class.
            if(!candidate || typeof candidate.scheme != "function")
                continue;

            if(candidate.scheme() == scheme) {
                return candidate;
            }
        }

        throw new Error("Invalid scheme '"+ scheme +"'");
    }

    [_private.onPeerConnected](peer, options, resolve) {
        debug("Peer connected");
        if(peer.type == "http") {
            peer.on("upgrade", (req, socket) => {
                let httpPeer = new AnyHTTPPeer(req, socket);
                httpPeer.header("ANYSOCKET-ID", this.id);
                this.http._processUpgrade(httpPeer);
                this.emit("http_upgrade", httpPeer, req, socket);
            });

            peer.on("message", (req, res) => {
                if(req.url == "/@anysocket") {
                    let httpPeer = new AnyHTTPPeer(req, res);
                    httpPeer.body(this[_private.httpBundle]);
                    httpPeer.end();
                    return;
                }

                req.body = '';
                req.on('error', (err) => {
                    console.log("Err", err);
                }).on('data', (chunk) => {
                    req.body += chunk;
                    // Too much POST data, kill the connection!
                    // 1e7 === 1 * Math.pow(10, 7) === 1 * 10000000 ~~~ 10MB
                    if (req.body.length > 1e7)
                        req.connection.destroy();
                }).on('end', () => {
                    req.body = req.body.toString();
                    let httpPeer = new AnyHTTPPeer(req, res);
                    httpPeer.header("ANYSOCKET-ID", this.id);
                    this.http._process(httpPeer);
                    this.emit("http", httpPeer, req, res);
                });
            });
            return;
        }
        const anyprotocol = new AnyProtocol(this, peer, options);
        this[_private.peersConnected][peer.connectionID] = anyprotocol;
        // register protocol messages
        anyprotocol.on("forward", this[_private.onForward].bind(this));
        anyprotocol.once("ready", (protocol) => {
            this[_private.onProtocolReady](protocol, resolve)
        });
    }

    /**
     * A relayed packet, arriving over the connection we authenticated as
     * `peerID`. Its `to`/`from` are written by the sender, so neither can be
     * trusted on its own: `from` used to be taken at face value, which let a
     * packet be delivered as though it came from any peer the receiver knew.
     * Everything here is checked against `peerID`, the one thing the sender
     * cannot choose.
     */
    [_private.onForward](peerID, packet) {
        const sender = this[_private.peers][peerID];

        if(this.id == packet.to) {
            // Last hop. `from` must be a peer we reached *through this relay* —
            // never a peer we talk to directly, and never one relayed by
            // somebody else.
            const origin = this[_private.peers][packet.from];
            if(!origin || !origin.isProxy() || origin.relayID != peerID) {
                debug("Dropping forward: " + packet.from + " is not relayed by " + peerID);
                if(sender) sender.disconnect("Invalid forward packet!");
                return;
            }

            origin._recvForward(packet);
            return;
        }

        // Relay hop. The sender may only ever speak for itself, and the route
        // has to be one we actually allow.
        if(packet.from != peerID) {
            debug("Dropping forward: " + peerID + " tried to relay as " + packet.from);
            if(sender) sender.disconnect("Invalid forward packet!");
            return;
        }

        if(!this.canProxy(packet.from, packet.to) || !this.hasDirectPeer(packet.to)) {
            debug("Dropping forward: no permitted route from " + packet.from + " to " + packet.to);
            if(sender) sender.disconnect("Invalid forward packet!");
            return;
        }

        this[_private.peers][packet.to].forward(packet);
    }

    /**
     * Two peers that dial each other end up with two connections, and both ends
     * have to retire the same one. Each end used to drop whichever became ready
     * second, which is a local race: the two ends routinely chose opposite
     * connections, each closed the other's keeper, and **both** connections
     * died. An application that re-dials would then do it again, which looks
     * like a peer that will not stay connected.
     *
     * So the choice is made from the two ids instead, which both ends know: the
     * surviving connection is the one dialled by the peer whose id sorts lower.
     * No timing involved, and nothing depending on which end is asking.
     *
     * Only consulted when there is actually a duplicate — a single connection is
     * kept whichever way it was dialled.
     */
    [_private.keepsExisting](existing, incoming) {
        const existingOutbound = existing.isOutbound();
        const incomingOutbound = incoming.isOutbound();

        // Can't tell a direction, or both run the same way (an application that
        // dialled twice): keep what we have, as before.
        if (typeof existingOutbound != "boolean" || typeof incomingOutbound != "boolean") return true;
        if (existingOutbound === incomingOutbound) return true;

        // The lower id is the designated dialler, so our keeper is outbound
        // exactly when our own id is the lower one.
        const weShouldDial = String(this.id) < String(incoming.peerID);
        return existingOutbound === weShouldDial;
    }

    [_private.onProtocolReady](protocol, resolve) {
        const existing = this[_private.peers][protocol.peerID];
        if(existing) {
            if(this[_private.keepsExisting](existing, protocol)) {
                // A dial that got as far as authenticating has reached that peer;
                // it just was not the connection both ends kept. So it succeeds
                // with the one that was. Rejecting it left a caller that had only
                // ever lost this race unable to learn it was connected at all.
                //
                // Resolved before the disconnect, not after: the disconnect runs
                // the transport's own handler synchronously, and that rejects the
                // same promise — after which resolving does nothing.
                if(resolve) resolve(existing);
                protocol.peerID = null;
                protocol.disconnect("Duplicated AnySocket ID found!");
                return;
            }

            // The incoming connection is the one both ends will settle on, so
            // retire ours here. Unhooked from the map first so its own
            // disconnect cannot take the replacement down with it.
            debug("Replacing the duplicate connection to", protocol.peerID);
            delete this[_private.peers][existing.id];
            existing._supersede("Superseded by the agreed connection");
            // The application may hold this peer object, so tell it that one is
            // gone; the replacement arrives as its own "connected" below.
            this.emit("disconnected", existing, "Superseded by the agreed connection");
        }

        debug("Peer ready");
        const anypeer = new AnyPeer(protocol);
        this[_private.peers][protocol.peerID] = anypeer;

        anypeer.on("message", (packet) => {
            this.emit("message", packet);
        });
        anypeer.on("e2e", (peer) => {
            this.emit("e2e", peer);
        });
        anypeer.on("internal",this[_private.onPeerInternalMessage].bind(this));

        if(resolve) {
            resolve(anypeer);
        }

        // allow resolve to run before emitting event
        setTimeout(() => {
            // Deferred, so the peer may already be gone — dropped by the far
            // end, or retired by the duplicate rule. Announcing it then would
            // hand out a dead peer, after its own "disconnected".
            if (this[_private.peers][anypeer.id] !== anypeer) return;
            this.emit("connected", anypeer);
        }, 0);

        return anypeer;
    }

    [_private.onPeerDisconnected](peer, reason) {
        debug("Peer disconnected", reason, peer.id);
        let anypeerID = null;
        if (this[_private.peersConnected][peer.connectionID]) {
            anypeerID = this[_private.peersConnected][peer.connectionID].peerID;
            delete this[_private.peersConnected][peer.connectionID];
        }

        if(this[_private.peers][peer.id]) {
            anypeerID = peer.id;
        }

        const anypeer = anypeerID ? this[_private.peers][anypeerID] : null;
        if (anypeer) {
            delete this[_private.peers][anypeerID];

            const links = anypeer.getLinks();
            for(let peerID in links) {
                links[peerID].sendInternal({
                    type: constants.INTERNAL_PACKET_TYPE.NETWORK,
                    action: "disconnected",
                    id: anypeer.id
                }).catch(() => {
                    // ignore, peer maybe already disconnected
                });
                anypeer.removeLink(links[peerID]);
                if(this[_private.peers][peerID]) {
                    this[_private.peers][peerID].removeLink(anypeer);
                }
            }

            anypeer.disconnect();
            this.emit("disconnected", anypeer, reason);
        } else {
            peer.disconnect();
        }
    }

    [_private.onPeerInternalMessage](packet) {
        if(packet.msg.type == constants.INTERNAL_PACKET_TYPE.NETWORK) {
            if(packet.msg.action == "connected") {
                if(!this[_private.peers][packet.msg.id]) {
                    let protocol = new AnyProtocol(this, new ProxyPeer(false, this.id, packet.msg.id, this[_private.peers][packet.peer.id]));
                    this[_private.onProtocolReady](protocol);
                }
            }
            else if(packet.msg.action == "disconnected") {
                if(!this[_private.peers][packet.msg.id]) {
                    packet.peer.disconnect("Invalid proxy request!");
                    return;
                }

                this[_private.onPeerDisconnected](this[_private.peers][packet.msg.id], "Proxy Connection Closed");
            }
        }
        else if(packet.msg.type == constants.INTERNAL_PACKET_TYPE.PROXY) {
            if(packet.msg.action == "proxy") {
                // initialize mesh
                if(!this.canProxy(packet.peer.id, packet.msg.id) || !this[_private.peers][packet.msg.id]) {
                    packet.peer.disconnect("Invalid proxy request!");
                    return;
                }

                if(this[_private.peers][packet.msg.id].isProxy())
                {
                    packet.reply({
                        ok: false,
                        reason: "cannot relay through a relayed peer"
                    });
                    // TODO: this requires to implement a full network graph (map)
                    // TODO: this will enable to send messages without having multiple forward headers
                    return;
                }

                // Both hops must speak 1.0. A relayed frame is opaque bytes the
                // relay re-wraps for each hop, so its format has to be one that
                // every hop can carry — and an endpoint cannot see the version
                // of a hop further along. Requiring it here is what makes the
                // relayed link's format knowable at both ends.
                if(!this[_private.peers][packet.peer.id].supportsRelay() ||
                    !this[_private.peers][packet.msg.id].supportsRelay()) {
                    packet.reply({
                        ok: false,
                        reason: "relaying needs protocol version 1 on both hops"
                    });
                    return;
                }

                this[_private.peers][packet.msg.id].addLink(this[_private.peers][packet.peer.id]);
                this[_private.peers][packet.peer.id].addLink(this[_private.peers][packet.msg.id]);

                this[_private.peers][packet.msg.id].sendInternal({
                    type: constants.INTERNAL_PACKET_TYPE.NETWORK,
                    action: "connected",
                    id: packet.peer.id
                });
                packet.reply({
                    ok: true
                });
            }
            else if(packet.msg.action == "unproxy") {
                // destroy mesh
                if(!this.canProxy(packet.peer.id, packet.msg.id) || !this[_private.peers][packet.msg.id]) {
                    packet.peer.disconnect("Invalid proxy request!");
                    return;
                }

                this[_private.peers][packet.msg.id].removeLink(this[_private.peers][packet.peer.id]);
                this[_private.peers][packet.peer.id].removeLink(this[_private.peers][packet.msg.id]);

                this[_private.peers][packet.msg.id].sendInternal({
                    type: constants.INTERNAL_PACKET_TYPE.NETWORK,
                    action: "disconnected",
                    id: packet.peer.id
                });
            }
        }
        else if(packet.msg.type == constants.INTERNAL_PACKET_TYPE.RPC) {
            // RUN RPC, send reply
            let parent = false;
            let tmp = this.rpc;
            for(let key in packet.msg.method){
                parent = tmp;
                tmp = tmp[packet.msg.method[key]];
                if(!tmp)
                    break;
            }

            // method not found
            if(!parent || !tmp || typeof tmp != "function") {
                packet.reply({
                    error: "Method not found!",
                    details: "method: '" + packet.msg.method + "'",
                    code: 404
                });
            } else {
                try {
                    // Attached bytes when the caller is 1.0, base64 when it is 0.4.x.
                    const attached = packet.msg[Packet.ATTACHMENTS];
                    packet.msg.bin.forEach((item, i) => {
                        packet.msg.params[item] = attached && attached.length
                            ? attached[i]
                            : AnySocket.Packer.unpack(packet.msg.params[item]);
                    });

                    Promise.resolve(tmp.apply(parent, [...packet.msg.params, packet.peer]))
                        .then((result) => {
                            if(!BufferUtils.isBuffer(result)) {
                                packet.reply({ result: result, bin: false });
                                return;
                            }

                            // Bytes back as bytes to a 1.0 caller; base64 to 0.4.x.
                            if(packet.peer.protocolVersion() >= constants.PROTOCOL_VERSION) {
                                const reply = { result: null, bin: true };
                                reply[Packet.ATTACHMENTS] = [result];
                                packet.reply(reply);
                            } else {
                                packet.reply({ result: AnySocket.Packer.pack(result), bin: true });
                            }
                        })
                        .catch((e) => {
                            packet.reply({
                                error: errorMessage(e),
                                details: "method: '" + packet.msg.method + "'",
                                code: 500
                            });
                        });
                }
                catch(e) {
                    packet.reply({
                        error: errorMessage(e),
                        details: "method: '" + packet.msg.method + "'",
                        code: 500
                    });
                }
            }
        }
        else if(packet.msg.type == constants.INTERNAL_PACKET_TYPE.RPC_NOTIFY) {
            // RUN RPC, don't reply
            console.log("RPC_NOTIFY", packet.msg);
        }
        else if(packet.msg.type == constants.INTERNAL_PACKET_TYPE.SYNCED_TIME) {
            packet.reply({
                o: packet.msg.time,
                t: Date.now()
            });
        }
        else {
            packet.peer.disconnect("Invalid internal message");
        }
    }
    //endregion
}

module.exports = AnySocket;