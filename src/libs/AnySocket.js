const debug = require('debug')('AnySocket');
const EventEmitter = require("events");
const path = require("path");
const fs = require("fs");
const Utils = require("./utils");
const _private = {
    peersConnected: Symbol("unready peers"),
    peers: Symbol("ready peers"),
    transports: Symbol("transports"),
    onPeerConnected: Symbol("onPeerConnected"),
    onProtocolReady: Symbol("onPeerReady"),
    onPeerDisconnected: Symbol("onPeerDisconnected"),
    onPeerInternalMessage: Symbol("onPeerInternalMessage"),
    findTransport: Symbol("findTransport")
};
const AnyPeer = require("./AnyPeer");
const AnyProtocol = require("./AnyProtocol");
const ProxyPeer = require("./ProxyPeer");

class AnySocket extends EventEmitter {
    constructor() {
        super();

        this.id = Utils.uuidv4();
        debug("AnySocketID:", this.id);

        this[_private.peersConnected] = {};
        this[_private.peers] = {};
        this[_private.transports] = {};

        return this;
    }

    filter(options) {
        // something smart to filter
    }

    send(message, awaitReply) {
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
        })
    }

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
                type: "network",
                action: "proxy",
                id: peerID
            }, true).then((packet) => {
                if(packet.msg.ok && !this[_private.peers][peerID]) {
                    let protocol = new AnyProtocol(this, new ProxyPeer(true, this.id, peerID, this[_private.peers][throughPeerID]));
                    this[_private.onProtocolReady](protocol);
                    resolve(this[_private.peers][peerID]);
                } else {
                    reject("Cannot proxy!");
                }
            }).catch(reject);
        })
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

    onForwardPacket(peerID, packet) {
        if(this.id == packet.to) {
            if(!this[_private.peers][packet.from]) {
                this[_private.peers][peerID].disconnect("Invalid forward packet! Client doesn't exist!");
                return;
            }

            this[_private.peers][packet.from]._recvForward(packet);
        }
        else if(this.hasPeer(packet.to)) {
            this[_private.peers][packet.to].forward(packet);
        } else {
            console.error("FORWARD ERROR! We do not have the peer", packet.to);
        }
    }

    // has peer and it's not a proxy
    hasPeer(id) {
        return !!(this[_private.peers][id] && !this[_private.peers][id].isProxy());
    }

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
        const anyprotocol = new AnyProtocol(this, peer, options);
        this[_private.peersConnected][peer.connectionID] = anyprotocol;
        // register for readiness
        anyprotocol.once("ready", (protocol) => {
            this[_private.onProtocolReady](protocol);
        });
    }

    [_private.onProtocolReady](protocol) {
        debug("Peer ready");
        const anypeer = new AnyPeer(protocol);
        this[_private.peers][protocol.peerID] = anypeer;

        anypeer.heartbeat();

        anypeer.on("message", (packet) => {
            this.emit("message", packet);
        });
        anypeer.on("e2e", (peer) => {
            this.emit("e2e", peer);
        });
        anypeer.on("heartbeat", (peer) => {
            this.emit("heartbeat", peer);
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
                    type: "network",
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
        // console.log("got internal", packet.msg);
        switch (packet.msg.type) {
            case "network":
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
                        type: "network",
                        action: "connected",
                        id: packet.peer.id
                    });
                    packet.reply({
                        ok: true
                    });
                } else if(packet.msg.action == "unproxy") {
                    // destroy mesh
                    if(!this.canProxy(packet.peer.id, packet.msg.id) || !this[_private.peers][packet.msg.id]) {
                        packet.peer.disconnect("Invalid proxy request!");
                        return;
                    }

                    this[_private.peers][packet.msg.id].removeLink(this[_private.peers][packet.peer.id]);
                    this[_private.peers][packet.peer.id].removeLink(this[_private.peers][packet.msg.id]);
                } else if(packet.msg.action == "connected") {
                    if(!this[_private.peers][packet.msg.id]) {
                        let protocol = new AnyProtocol(this, new ProxyPeer(false, this.id, packet.msg.id, this[_private.peers][packet.peer.id]));
                        this[_private.onProtocolReady](protocol);
                    }
                } else if(packet.msg.action == "disconnected") {
                    if(!this[_private.peers][packet.msg.id]) {
                        packet.peer.disconnect("Invalid proxy request!");
                        return;
                    }

                    this[_private.onPeerDisconnected](this[_private.peers][packet.msg.id], "Proxy Connection Closed");
                }
                break;
            default:
                packet.peer.disconnect("Invalid internal message");
        }
    }
}

// Module Setup
function loadModules(dir) {
    const result = {};
    dir = path.join(__dirname, dir);
    fs.readdirSync(dir).forEach(function (file) {
        let name = file.replace(/\.js$/, "");
        file = path.join(dir, file);
        if (fs.statSync(file).isDirectory()) {
            if (path.basename(file) != "abstract") {
                result[name.toUpperCase()] = require(path.join(file, "transport.js"));
            }
        }
    });
    return result;
}

AnySocket.Transport = loadModules("../modules/transports");
module.exports = AnySocket;