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
    onPeerDisconnected: Symbol("onPeerDisconnected")
};
const AnyPeer = require("./AnyPeer");
const AnyProtocol = require("./AnyProtocol");

// TODO: - Reimplement XTunnel over AnySocket
class AnySocket extends EventEmitter {
    constructor(type) {
        super();

        this.id = Utils.uuidv4();
        console.log("AnySocketID:", this.id);
        this.type = type;

        this[_private.peersConnected] = {};
        this[_private.peers] = {};
        this[_private.transports] = [];
    }

    filter(options) {
        // something smart to filter
    }

    send(message, awaitReply) {
        awaitReply = awaitReply || false;

        return new Promise((resolve, reject) => {
            for (let p in this[_private.peers]) {
                p = this[_private.peers][p];
                p.send(message, awaitReply).then(resolve).catch(reject);
            }
        })
    }

    transport(transport, options) {
        let opts = {};
        if (this.type == AnySocket.Type.CLIENT) {
            opts = {
                client: options
            };
        } else if (this.type == AnySocket.Type.SERVER) {
            opts = {
                server: options
            };
        } else {
            throw new Error("Invalid AnySocket type '" + this.type + "'");
        }

        this[_private.transports].push(
            new transport(opts)
        );
    }

    start() {
        return new Promise((resolve, reject) => {
            const promises = [];
            for (let transport of this[_private.transports]) {
                transport.on("connected", this[_private.onPeerConnected].bind(this));
                transport.on("disconnected", this[_private.onPeerDisconnected].bind(this));

                promises.push(
                    transport.start()
                );
            }

            Promise.all(promises).then(() => {
                resolve();
            }).catch(err => {
                reject(err);
            });
        });
    }

    stop() {
        return new Promise((resolve, reject) => {
            const promises = [];
            for (let transport of this[_private.transports]) {
                promises.push(
                    transport.stop()
                );
            }

            Promise.all(promises).then(() => {
                resolve();
            }).catch(err => {
                reject(err);
            });
        });
    }

    [_private.onPeerConnected](peer) {
        console.log("Peer connected");
        const anyprotocol = new AnyProtocol(this.id, peer);
        this[_private.peersConnected][peer.connectionID] = anyprotocol;
        // register for readiness
        anyprotocol.once("ready", (protocol) => {
            console.log("READY!");
            this[_private.onProtocolReady](protocol);
        });
    }

    [_private.onProtocolReady](protocol) {
        console.log("Peer ready");
        const anypeer = new AnyPeer(protocol);
        this[_private.peers][protocol.peerID] = anypeer;

        anypeer.on("message", (packet) => {
            this.emit("message", packet);
        });
        anypeer.on("e2e", (peer) => {
            this.emit("e2e", peer);
        });
        anypeer.on("lag", (peer, lag) => {
            this.emit("lag", peer, lag);
        });
        anypeer.heartbeat();

        this.emit("connected", anypeer);
    }

    [_private.onPeerDisconnected](peer, reason) {
        console.log("Peer disconnected", reason);
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

AnySocket.Type = {
    NONE: 0,
    CLIENT: 1,
    SERVER: 2
};
AnySocket.Transport = loadModules("../modules/transports");
module.exports = AnySocket;