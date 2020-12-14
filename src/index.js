const EventEmitter = require("events");
const path = require("path");
const fs = require("fs");
const Utils = require("./modules/utils");
const _private = {
    unauthed: Symbol("unauthed"),
    peers: Symbol("peers"),
    protocolState: Symbol("protocolState"),
    transports: Symbol("transports"),
    onPeerAuthed: Symbol("onPeerAuthed"),
    onPeerRequestAuth: Symbol("onPeerRequestAuth"),
    onPeerConnected: Symbol("onPeerConnected"),
    onPeerMessage: Symbol("onPeerMessage"),
    onPeerDisconnected: Symbol("onPeerDisconnected")
};

const PROTOCOL_STATE = {
    CONNECTED: "1",
    AUTHED: "2",
    E2E_INIT: "3",
    E2E: "4"
};

// TODO: E2E requires data to be max size of the key. By default, padding adds some extra bytes
// TODO: - Implement a better state machine for the protocol (maybe with protocol message - SWITCH_STATE)
// TODO: - Implement partial messages that wait for completion before triggering (with a timeout so we don't have memory leaks)
// TODO: - Reimplement XTunnel over AnySocket
class AnySocket extends EventEmitter {
    constructor(type) {
        super();

        this.id = Utils.uuidv4();
        console.log("AnySocketID:", this.id);
        this.type = type;

        this[_private.unauthed] = {};
        this[_private.peers] = {};
        this[_private.protocolState] = {};
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

    protocol() {

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
                transport.on("requestAuth", this[_private.onPeerRequestAuth].bind(this));
                transport.on("authed", this[_private.onPeerAuthed].bind(this));
                transport.on("connected", this[_private.onPeerConnected].bind(this));
                transport.on("disconnected", this[_private.onPeerDisconnected].bind(this));
                transport.on("message", this[_private.onPeerMessage].bind(this));

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

    [_private.onPeerAuthed](peer) {
        const onAuthed = () => {
            delete this[_private.unauthed][peer.connectionID];
            this[_private.peers][peer.connectionID] = peer;
            this[_private.protocolState][peer.connectionID] = PROTOCOL_STATE.AUTHED;

            console.log("Peer authed");
            this.emit("connected", peer);
        };
        if(peer._requestedAuth) {
            delete peer._requestedAuth;
            onAuthed();
            return;
        }

        peer.send({
            id: this.id
        }).then(() => {
            onAuthed();
        }).catch(peer.disconnect);
    }

    [_private.onPeerRequestAuth](peer) {
        // send the auth packet
        console.log("Request auth", peer.connectionID);
        peer._requestedAuth = true;
        peer.send({
            id: this.id
        });
    }

    [_private.onPeerConnected](peer) {
        console.log("Peer connected");
        this[_private.unauthed][peer.connectionID] = peer;
        this[_private.protocolState][peer.connectionID] = PROTOCOL_STATE.CONNECTED;
    }

    [_private.onPeerDisconnected](peer, reason) {
        console.log("Peer disconnected", reason);
        if(this[_private.protocolState][peer.connectionID]) {
            delete this[_private.protocolState][peer.connectionID];
        }

        if (this[_private.unauthed][peer.connectionID]) {
            delete this[_private.unauthed][peer.connectionID];
        }

        if (this[_private.peers][peer.connectionID]) {
            delete this[_private.peers][peer.connectionID];
            this.emit("disconnected", peer, reason);
        }
    }

    [_private.onPeerMessage](peer, message) {
        const packet = this.decodeMessage(peer, message);
        if(!packet) {
            console.log("Dropped message from peer " + peer.connectionID);
            peer.disconnect();
            return;
        }

        switch(packet.type) {
            case PROTOCOL_STATE.CONNECTED:
                if(this[_private.protocolState][peer.connectionID] == PROTOCOL_STATE.CONNECTED) {
                    peer.auth(packet.data);
                }
                else {
                    console.error("Invalid protocol state message! Disconnecting peer!" + peer.id, packet);
                    peer.disconnect("Invalid protocol state message!");
                }
                return;
            case PROTOCOL_STATE.E2E:
            case PROTOCOL_STATE.AUTHED:
                if([PROTOCOL_STATE.AUTHED, PROTOCOL_STATE.E2E].indexOf(this[_private.protocolState][peer.connectionID]) != -1) {
                    this.emit("message",(() => {
                        return {
                            packet: packet.data,
                            peer: {
                                id: peer.id,
                                e2e: () => {
                                    if(this[_private.protocolState][peer.connectionID] == PROTOCOL_STATE.E2E)
                                        return;

                                    this[_private.protocolState][peer.connectionID] = PROTOCOL_STATE.E2E_INIT;
                                    peer.send(peer.getPublicKey());
                                },
                                send: peer.send,
                                disconnect: peer.disconnect
                            }
                        }
                    })(peer, packet));
                }
                else {
                    console.error("Invalid protocol state message! Disconnecting peer!" + peer.id, packet);
                    peer.disconnect("Invalid protocol state message!");
                }
                return;
            case PROTOCOL_STATE.E2E_INIT:
                const generatedCertificates = peer.hasE2EEnabled();
                const publicKey = peer.getPublicKey();
                peer.setPublicKey(packet.data);
                if(!generatedCertificates) {
                    this[_private.protocolState][peer.connectionID] = PROTOCOL_STATE.E2E_INIT;
                    peer.send(publicKey);
                }
                this[_private.protocolState][peer.connectionID] = PROTOCOL_STATE.E2E;
                return;
            default:
                console.error("Invalid protocol state message! Disconnecting peer!" + peer.id, packet);
                peer.disconnect("Invalid protocol state message!");
        }
    }

    encodeMessage(peer, message) {
        switch(this[_private.protocolState][peer.connectionID]) {
            case PROTOCOL_STATE.CONNECTED:
            case PROTOCOL_STATE.AUTHED:
            case PROTOCOL_STATE.E2E_INIT:
                message = JSON.stringify(message);
                break;
            case PROTOCOL_STATE.E2E:
                message = Utils.encryptRSA(peer.getPublicKey(), message);
                break;
            default:
                throw new Error("Invalid Protocol State! " + this[_private.protocolState][peer.connectionID]);
        }

        return this[_private.protocolState][peer.connectionID] + message;
    }

    decodeMessage(peer, message) {
        const type = message.substr(0, 1);
        message = message.substr(1);
        switch(type) {
            case PROTOCOL_STATE.CONNECTED:
            case PROTOCOL_STATE.AUTHED:
            case PROTOCOL_STATE.E2E_INIT:
                message = JSON.parse(message);
                break;
            case PROTOCOL_STATE.E2E:
                message = Utils.decryptRSA(peer.getPrivateKey(), message);
                break;
            default:
                throw new Error("Invalid Protocol State!" + this[_private.protocolState][peer.connectionID]);
        }
        return {
            type: type,
            data: message
        };
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
AnySocket.Transport = loadModules("modules/transports");
AnySocket.XTunnel = require("./libs/XTunnel");
AnySocket.XTunnelServer = require("./libs/XTunnelServer");
AnySocket._private = _private;
module.exports = AnySocket;