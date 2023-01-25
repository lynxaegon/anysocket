const constants = require("../_constants");
const AnySocket = require("../../index");
const os = require('os');

class AnyMesh {
    constructor(anysocket, internalPeers, internalTransports, options) {
        this.anysocket = anysocket;
        this.internalPeers = internalPeers;
        this.internalTransports = internalTransports;
        this.peers = {};
        this.options = options;
        this.getIpAddresses();
    }

    handleEmit(event, ...args) {
        switch (event) {
            case "connected":
                this.onConnected(...args);
                break;
            case "message":
                this.onPacket(...args);
                break;
            case "disconnected":
                this.onDisconnected(...args);
                break;
            default:
                console.log("Unhandled event '"+event+"'");
        }
    }

    onConnected(peer) {
        let _peer = this.internalPeers[peer.id];
        let peersInfo = {};
        for (let name in this.internalTransports) {
            if(this.internalTransports[name].type == "server" && this.internalTransports[name].constructor.meshSupport()) {
                const scheme = this.internalTransports[name].constructor.scheme();
                const connectionInfo = this.internalTransports[name].connectionInfo();
                if(connectionInfo.host == "0.0.0.0") {
                    connectionInfo.host = this.getIpAddresses();
                }
                peersInfo[this.anysocket.id] = {
                    scheme: scheme,
                    host: connectionInfo.host,
                    port: connectionInfo.port,
                    options: this.options
                }
            }
        }

        for(let id in this.peers) {
            peersInfo[id] = this.peers[id];
        }

        _peer.sendInternal({
            type: constants.INTERNAL_PACKET_TYPE.MESH,
            action: "peers",
            peers: peersInfo
        })
        console.log("broadcast", _peer.id)
    }

    onInternalPacket(packet) {
        switch (packet.msg.action) {
            case "peers":
                for(let id in packet.msg.peers) {
                    const peer = packet.msg.peers[id];
                    if(!this.anysocket.hasPeer(id)) {
                        // console.log("Doesn't have", id, packet.msg.peers[id]);
                        this.anysocket.connect(peer.scheme, peer.host[0], peer.port)
                    } else {
                        this.peers[id] = peer;
                    }
                }

                // broadcast
                for(let id in this.internalPeers) {
                    let peer = this.internalPeers[id];
                    if(peer.id == packet.peer.id) {
                        continue
                    }
                    peer.sendInternal({
                        type: constants.INTERNAL_PACKET_TYPE.MESH,
                        action: "add_peer",
                        peers: packet.msg.peers
                    })
                }
                break;
        }
        console.log("CONNECTIONS:", Object.keys(this.internalPeers).length) //Object.keys(this.internalPeers));
    }

    onPacket(packet) {
        this.anysocket.meshEmit("message", packet);
    }

    onDisconnected(peer, reason) {
        console.log("disconnected", peer.id, reason);
        this.anysocket.meshEmit("disconnected", peer.id, reason);
    }

    getIpAddresses() {
        const nets = os.networkInterfaces();
        let results = [];
        for (const name of Object.keys(nets)) {
            for (const net of nets[name]) {
                // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
                // 'IPv4' is in Node <= 17, from 18 it's a number 4 or 6
                const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4
                if (net.family === familyV4Value && !net.internal) {
                    results.push(net.address);
                }
            }
        }

        // unique
        results = results.filter((value, index, self) => self.indexOf(value) === index)
        return results;
    }
}

module.exports = AnyMesh;