const debug = require('debug')('AnySocket');
const fs = require("fs");
const EventEmitter = require("events");
const Utils = require("./utils");
const BufferUtils = require("./utils_buffer");
const constants = require("./_constants");
const AnyHTTPPeer = require("./AnyHTTPPeer");
const AnyRouter = require("./AnyHTTPRouter");

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
    httpBundle: Symbol("http bundle js")
};

const AnyPeer = require("./AnyPeer");
const AnyProtocol = require("./AnyProtocol");
const ProxyPeer = require("./ProxyPeer");

class AnySocket extends EventEmitter {
    constructor() {
        super();

        this.id = Utils.uuidv4();
        this.http = new AnyRouter();
        debug("AnySocketID:", this.id);

        this[_private.peersConnected] = {};
        this[_private.peers] = {};
        this[_private.transports] = {};
        if (typeof window === 'undefined') {
            // nodejs
            this[_private.httpBundle] = fs.readFileSync(__dirname + "/../../dist/anysocket.bundle.js");
        }

        return this;
    }

    filter(options) {
        // something smart to filter
    }

    broadcast(message, awaitReply) {
        awaitReply = awaitReply || false;

        return new Promise((resolve, reject) => {
            const promises = [];
            for (let p in this[_private.peers]) {
                p = this[_private.peers][p];
                promises.push(
                    p.send(message, awaitReply)
                );
                Promise.all(promises).then(resolve).catch(reject);
            }
        });
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
                    reject("Cannot proxy!");
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

    hasDirectPeer(id) {
        return !!(this[_private.peers][id] && !this[_private.peers][id].isProxy());
    }

    //region Networking Connect/Listen/Stop
    server(scheme, options) {
        return this.listen(scheme, options);
    }

    listen(scheme, options) {
        // server
        if(typeof options == 'number'){
            options = { port: options };
        }

        options.ip = options.ip || "0.0.0.0";
        if(!options.port)
            throw new Error("Invalid port!");

        let transport = this[_private.findTransport](scheme);
        transport = new transport("server", options);
        this[_private.transports][transport.id] = transport;

        // start transport
        transport.on("connected", (peer) => {
            this[_private.onPeerConnected](peer, transport.options);
        });
        transport.on("disconnected", (peer, reason) => {
            this[_private.onPeerDisconnected](peer, reason);
        });
        return transport.listen();
    }

    connect(scheme, ip, port, options) {
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
            this[_private.onPeerConnected](peer, transport.options);
            debug("Transports Added", transport.id, Object.keys(this[_private.transports]).length);
        });
        transport.on("disconnected", (peer, reason) => {
            this[_private.transports][transport.id].stop();
            delete this[_private.transports][transport.id];
            this[_private.onPeerDisconnected](peer, reason);
            debug("Transports left", transport.id, Object.keys(this[_private.transports]).length);
        });
        return transport.connect();
    }

    stop() {
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

                resolve();
            }).catch(err => {
                throw err;
            });
        });
    }

    //endregion

    //region Private Functions
    [_private.findTransport](scheme) {
        for (let name in AnySocket.Transport) {
            if(!AnySocket.Transport.hasOwnProperty(name))
                continue;

            if(AnySocket.Transport[name].scheme() == scheme) {
                return AnySocket.Transport[name];
            }
        }

        throw new Error("Invalid scheme '"+ scheme +"'");
    }

    [_private.onPeerConnected](peer, options) {
        debug("Peer connected");
        if(peer.type == "http") {
            peer.on("message", (req, res) => {
                let httpPeer = new AnyHTTPPeer(req, res);
                if(httpPeer.url == "/@anysocket") {
                    httpPeer.body(this[_private.httpBundle]);
                    httpPeer.end();
                    return;
                }

                req.body = [];
                req.on('error', (err) => {
                    console.log("Err", err);
                }).on('data', (chunk) => {
                    req.body.push(chunk);
                }).on('end', () => {
                    req.body = Buffer.concat(req.body).toString();
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
            this[_private.onProtocolReady](protocol);
        });
    }

    [_private.onForward](peerID, packet) {
        if(this.id == packet.to) {
            if(!this[_private.peers][packet.from]) {
                this[_private.peers][peerID].disconnect("Invalid forward packet! Client doesn't exist!");
                return;
            }

            this[_private.peers][packet.from]._recvForward(packet);
        }
        else if(this.hasDirectPeer(packet.to)) {
            this[_private.peers][packet.to].forward(packet);
        } else {
            console.error("FORWARD ERROR! We do not have the peer", packet.to);
        }
    }

    [_private.onProtocolReady](protocol) {
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

        this.emit("connected", anypeer);
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

        if (anypeerID) {
            const anypeer = this[_private.peers][anypeerID];
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
                        ok: false
                    });
                    // TODO: this requires to implement a full network graph (map)
                    // TODO: this will enable to send messages without having multiple forward headers
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
                    error: "Method not found",
                    code: 404
                });
            } else {
                try {
                    for(let item of packet.msg.bin) {
                        packet.msg.params[item] = AnySocket.Packer.unpack(packet.msg.params[item]);
                    }

                    Promise.resolve(tmp.apply(parent, packet.msg.params))
                        .then((result) => {
                            let binary = false;
                            if(BufferUtils.isBuffer(result)) {
                                result = AnySocket.Packer.pack(result)
                                binary = true;
                            }
                            packet.reply({
                                result: result,
                                bin: binary
                            });
                        })
                        .catch((e) => {
                            packet.reply({
                                error: e,
                                code: 500
                            });
                        });
                }
                catch(e) {
                    packet.reply({
                        error: e.message,
                        code: 500
                    });
                }
            }
        }
        else if(packet.msg.type == constants.INTERNAL_PACKET_TYPE.RPC_NOTIFY) {
            // RUN RPC, don't reply
            console.log("RPC_NOTIFY", packet.msg);
        }
        else {
            packet.peer.disconnect("Invalid internal message");
        }
    }
    //endregion
}

module.exports = AnySocket;