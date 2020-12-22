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
    findTransport: Symbol("findTransport")
};
const AnyPeer = require("./AnyPeer");
const AnyProtocol = require("./AnyProtocol");

// TODO: implement P2P using a "fake" transport that will use the forward protocol
// TODO: In the future, this transport will keep multiple peers via it can send a message (with retries on arrival fail)
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

    createP2P(peer1, peer2) {

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
        const anyprotocol = new AnyProtocol(this.id, peer, options);
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

        this.emit("connected", anypeer);
    }

    [_private.onPeerDisconnected](peer, reason) {
        debug("Peer disconnected", reason);
        let anypeerID = null;
        if (this[_private.peersConnected][peer.connectionID]) {
            anypeerID = this[_private.peersConnected][peer.connectionID].peerID;
            delete this[_private.peersConnected][peer.connectionID];
        }

        if (anypeerID) {
            const anypeer = this[_private.peers][anypeerID];
            delete this[_private.peers][anypeerID];
            anypeer.disconnect();
            this.emit("disconnected", anypeer, reason);
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