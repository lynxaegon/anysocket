const EventEmitter = require("events");
const path = require("path");
const fs = require("fs");
const Utils = require("../modules/utils");
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

// TODO: E2E requires data to be max size of the key. By default, padding adds some extra bytes
// TODO: - Implement a better state machine for the protocol (maybe with protocol message - SWITCH_STATE)
// TODO: - Implement partial messages that wait for completion before triggering (with a timeout so we don't have memory leaks)
// TODO: - Reimplement XTunnel over AnySocket
// TODO: ----- Fix Protocol QUEUEing system!!!!
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

    send(message) {
        for (let p in this[_private.peers]) {
            p = this[_private.peers][p];
            p.send(message);
        }
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
            new transport(this, opts)
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
        const anyprotocol = new AnyProtocol(peer);
        this[_private.peersConnected][peer.connectionID] = anyprotocol;
        // register for readiness
        anyprotocol.once("ready", (protocol) => {
            this[_private.onProtocolReady](protocol);
        });
    }

    [_private.onProtocolReady](protocol) {
        console.log("Peer ready");
        const anypeer = new AnyPeer(protocol);
        this[_private.peers][protocol.peerID] = anypeer;
        anypeer.on("message", (peer, message) => {
            this.emit("message", {
                peer: anypeer,
                data: message
            });
        });
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
            this.emit("disconnected", anypeer, reason);
        }
    }

    // [_private.onPeerMessage](peer, message) {
    // const packet = this.decodeMessage(peer, message);
    // if(!packet) {
    //     console.log("Dropped message from peer " + peer.connectionID);
    //     peer.disconnect();
    //     return;
    // }

    // switch(packet.type) {
    //     case PROTOCOL_STATE.CONNECTED:
    //         if(this[_private.protocolState][peer.connectionID] == PROTOCOL_STATE.CONNECTED) {
    //             peer.auth(packet.data);
    //         }
    //         else {
    //             console.error("Invalid protocol state message! Disconnecting peer!" + peer.id, packet);
    //             peer.disconnect("Invalid protocol state message!");
    //         }
    //         return;
    //     case PROTOCOL_STATE.E2E:
    //     case PROTOCOL_STATE.AUTHED:
    //         if([PROTOCOL_STATE.AUTHED, PROTOCOL_STATE.E2E].indexOf(this[_private.protocolState][peer.connectionID]) != -1) {
    //             this.emit("message",(() => {
    //                 return {
    //                     packet: packet.data,
    //                     peer: {
    //                         id: peer.id,
    //                         e2e: () => {
    //                             if(this[_private.protocolState][peer.connectionID] == PROTOCOL_STATE.E2E)
    //                                 return;
    //
    //                             this[_private.protocolState][peer.connectionID] = PROTOCOL_STATE.E2E_INIT;
    //                             peer.send(peer.getPublicKey());
    //                         },
    //                         send: peer.send,
    //                         disconnect: peer.disconnect
    //                     }
    //                 }
    //             })(peer, packet));
    //         }
    //         else {
    //             console.error("Invalid protocol state message! Disconnecting peer!" + peer.id, packet);
    //             peer.disconnect("Invalid protocol state message!");
    //         }
    //         return;
    //     case PROTOCOL_STATE.E2E_INIT:
    //         const generatedCertificates = peer.hasE2EEnabled();
    //         const publicKey = peer.getPublicKey();
    //         peer.setPublicKey(packet.data);
    //         if(!generatedCertificates) {
    //             this[_private.protocolState][peer.connectionID] = PROTOCOL_STATE.E2E_INIT;
    //             peer.send(publicKey);
    //         }
    //         this[_private.protocolState][peer.connectionID] = PROTOCOL_STATE.E2E;
    //         return;
    //     default:
    //         console.error("Invalid protocol state message! Disconnecting peer!" + peer.id, packet);
    //         peer.disconnect("Invalid protocol state message!");
    // }
    // }
    //
    // encodeMessage(peer, message) {
    //
    //     switch (this[_private.protocolState][peer.connectionID]) {
    //         case PROTOCOL_STATE.CONNECTED:
    //         case PROTOCOL_STATE.AUTHED:
    //         case PROTOCOL_STATE.E2E_INIT:
    //             message = JSON.stringify(message);
    //             break;
    //         case PROTOCOL_STATE.E2E:
    //             message = Utils.encryptRSA(peer.getPublicKey(), message);
    //             break;
    //         default:
    //             throw new Error("Invalid Protocol State! " + this[_private.protocolState][peer.connectionID]);
    //     }
    //
    //     return this[_private.protocolState][peer.connectionID] + message;
    // }
    //
    // decodeMessage(peer, message) {
    //     const type = message.substr(0, 1);
    //     message = message.substr(1);
    //     switch (type) {
    //         case PROTOCOL_STATE.CONNECTED:
    //         case PROTOCOL_STATE.AUTHED:
    //         case PROTOCOL_STATE.E2E_INIT:
    //             message = JSON.parse(message);
    //             break;
    //         case PROTOCOL_STATE.E2E:
    //             message = Utils.decryptRSA(peer.getPrivateKey(), message);
    //             break;
    //         default:
    //             throw new Error("Invalid Protocol State!" + this[_private.protocolState][peer.connectionID]);
    //     }
    //     return {
    //         type: type,
    //         data: message
    //     };
    // }

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
AnySocket.XTunnel = require("../../examples/libs/XTunnel");
AnySocket.XTunnelServer = require("../../examples/libs/XTunnelServer");
module.exports = AnySocket;