const debug = require('debug')('AnySocket');
const fs = require("fs");
const EventEmitter = require("events");
const Utils = require("./libs/utils");
const AnyHTTPPeer = require("./libs/AnyHTTPPeer");
const AnyRouter = require("./libs/AnyHTTPRouter");

const AnyPeer = require("./libs/AnyPeer");
const AnyMesh = require("./libs/addons/AnyMesh");
const AnyProtocol = require("./libs/AnyProtocol");

class AnySocket extends EventEmitter {
    constructor() {
        super();

        this._started = false;
        this.id = Utils.uuidv4();
        this.http = new AnyRouter();
        debug("AnySocketID:", this.id);

        this.peersConnected = {};
        this.peers = {};
        this.transports = {};
        this.httpServer = null;
        this.anymesh = null;
        if (typeof window === 'undefined') {
            // nodejs
            this.httpBundle = fs.readFileSync(__dirname + "/../dist/anysocket.browser.js");
        }

        this.addons = [
            require("./libs/addons/AnyRPC/index"),
            require("./libs/addons/AnyProxy/index")
        ];

        for(let index in this.addons) {
            this.addons[index] = new this.addons[index](this, index);
        }
    }

    broadcast(message, awaitReply) {
        awaitReply = awaitReply || false;

        return new Promise((resolve, reject) => {
            const promises = [];
            for (let p in this.peers) {
                p = this.peers[p];
                promises.push(
                    p.send(message, awaitReply)
                );
                Promise.all(promises).then(resolve).catch(reject);
            }
        });
    }

    mesh() {
        if (this._started)
            throw new Error("Cannot enable Mesh while AnySocket is running. You must first stop AnySocket!");

        this.anymesh = new AnyMesh(this, this.peers, this.transports);
    }

    emit(event, ...args) {
        if (this.anymesh) {
            return this.anymesh.handleEmit(event, ...args);
        }
        super.emit(event, ...args);
    }

    meshEmit(...args) {
        super.emit(...args);
    }

    hasPeer(id) {
        return !!this.peers[id];
    }

    //region Networking Connect/Listen/Stop
    server(scheme, options) {
        return this.listen(scheme, options);
    }

    listen(scheme, options) {
        // server
        this._started = true;
        options = options || {};
        if (typeof options == 'number') {
            options = {port: options};
        }

        options.host = options.host || "0.0.0.0";
        if (["http", "ws"].indexOf(scheme.toLowerCase()) == -1 && !options.port)
            throw new Error("Invalid port!");

        if (["ws"].indexOf(scheme.toLowerCase()) != -1) {
            if (!this.httpServer) {
                this.listen("http", options);
            }

            options = {
                transport: this.httpServer
            };
        }

        let transport = this.findTransport(scheme);
        transport = new transport("server", options);
        this.transports[transport.id] = transport;

        // start transport
        transport.on("connected", (peer) => {
            this.onPeerConnected(peer, transport.options);
        });
        transport.on("disconnected", (peer, reason) => {
            this.onPeerDisconnected(peer, reason);
        });

        let result = transport.listen();
        if (scheme == "http") {
            this.httpServer = transport;
        }
        return result;
    }

    connect(scheme, host, port, options) {
        return new Promise((resolve, reject) => {
            this._started = true;
            options = Object.assign(options || {}, {
                host: host,
                port: port
            });

            // client
            let transport = this.findTransport(scheme);
            transport = new transport("client", options);

            // start transport
            transport.on("connected", (peer) => {
                this.transports[transport.id] = transport;
                this.onPeerConnected(peer, transport.options, resolve);
                debug("Transports Added", transport.id, Object.keys(this.transports).length);
            });
            transport.on("disconnected", (peer, reason) => {
                this.transports[transport.id].stop();
                delete this.transports[transport.id];
                this.onPeerDisconnected(peer, reason);
                debug("Transports left", transport.id, Object.keys(this.transports).length);

                // protocol was never ready
                if (!this.peers[peer.id]) {
                    reject(reason);
                }
            });
            transport.connect().catch(reject);
        });
    }

    stop() {
        this._started = false;
        return new Promise((resolve, reject) => {
            const promises = [];
            for (let id in this.transports) {
                promises.push(
                    this.transports[id].stop()
                );
            }

            Promise.all(promises).then(() => {
                this.peersConnected = {};
                this.peers = {};
                this.transports = {};

                resolve();
            }).catch(err => {
                throw err;
            });
        });
    }

    onAuth(packet) {
        return true;
    }

    authPacket() {
        return undefined;
    }

    //endregion

    //region Private Functions
    findTransport(scheme) {
        for (let name in AnySocket.Transport) {
            if (!AnySocket.Transport.hasOwnProperty(name))
                continue;

            if (AnySocket.Transport[name].scheme() == scheme) {
                return AnySocket.Transport[name];
            }
        }

        throw new Error("Invalid scheme '" + scheme + "'");
    }

    onPeerConnected(peer, options, resolve) {
        debug("Peer connected");
        if (peer.type == "http") {
            peer.on("upgrade", (req, socket) => {
                let httpPeer = new AnyHTTPPeer(req, socket);
                httpPeer.header("ANYSOCKET-ID", this.id);
                this.http._processUpgrade(httpPeer);
                this.emit("http_upgrade", httpPeer, req, socket);
            });

            peer.on("message", (req, res) => {
                let httpPeer = new AnyHTTPPeer(req, res);
                if (httpPeer.url == "/@anysocket") {
                    httpPeer.body(this.httpBundle);
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
                    httpPeer.header("ANYSOCKET-ID", this.id);
                    this.http._process(httpPeer);
                    this.emit("http", httpPeer, req, res);
                });
            });
            return;
        }
        const anyprotocol = new AnyProtocol(this, peer, options);
        this.peersConnected[peer.connectionID] = anyprotocol;
        // register protocol messages
        anyprotocol.on("forward", this.onForward.bind(this));
        anyprotocol.once("ready", (protocol) => {
            this.onProtocolReady(protocol, resolve)
        });
    }

    onForward(peerID, packet) {
        if (this.id == packet.to) {
            if (!this.peers[packet.from]) {
                this.peers[peerID].disconnect("Invalid forward packet! Client doesn't exist!");
                return;
            }

            this.peers[packet.from]._recvForward(packet);
        } else if (this.hasDirectPeer(packet.to)) {
            this.peers[packet.to].forward(packet);
        } else {
            console.error("FORWARD ERROR! We do not have the peer", packet.to);
        }
    }

    onProtocolReady(protocol, resolve) {
        if (this.peers[protocol.peerID]) {
            protocol.peerID = null;
            protocol.disconnect("Duplicated AnySocket ID found!");
            return;
        }

        debug("Peer ready");
        const anypeer = new AnyPeer(protocol);
        for(let addon of this.addons) {
            addon.applyAnyPeerExtension(anypeer);
            addon.onPeerConnected(anypeer);
        }
        this.peers[protocol.peerID] = anypeer;

        anypeer.on("message", (packet) => {
            this.emit("message", packet);
        });
        anypeer.on("e2e", (peer) => {
            this.emit("e2e", peer);
        });
        anypeer.on("internal", this.onPeerInternalMessage.bind(this));

        if (resolve) {
            resolve(anypeer);
        }

        // allow resolve to run before emitting event
        setTimeout(() => {
            this.emit("connected", anypeer);
        }, 0);

        return anypeer;
    }

    onPeerDisconnected(peer, reason) {
        debug("Peer disconnected", reason, peer.id);
        let anypeerID = null;
        if (this.peersConnected[peer.connectionID]) {
            anypeerID = this.peersConnected[peer.connectionID].peerID;
            delete this.peersConnected[peer.connectionID];
        }

        if (this.peers[peer.id]) {
            anypeerID = peer.id;
        }

        if (anypeerID) {
            const anypeer = this.peers[anypeerID];
            delete this.peers[anypeerID];

            for(let addon of this.addons) {
                addon.onPeerDisconnected(anypeer);
            }

            anypeer.disconnect();
            this.emit("disconnected", anypeer, reason);
        } else {
            peer.disconnect();
        }
    }

    onPeerInternalMessage(packet) {
        let addon = this.addons[packet.msg.type];
        if(!addon) {
            return packet.peer.disconnect("Invalid internal command, type: '"+ packet.msg.type +"'");
        }

        addon.onInternalNetwork.bind(addon)(packet);
    }

    //endregion
}
const AnyPacker = require("./libs/AnyPacker");

AnySocket.Transport = {
    "WS": require("./modules/transports/ws/transport"),
    "HTTP": require("./modules/transports/http/transport")
};
AnySocket.Packer = {
    pack: AnyPacker.packBytes.bind(AnyPacker),
    unpack: AnyPacker.unpackBytes.bind(AnyPacker)
};
module.exports = AnySocket;