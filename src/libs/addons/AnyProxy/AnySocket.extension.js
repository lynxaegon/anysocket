const AnyProtocol = require("../../AnyProtocol");
const ProxyPeer = require("../../ProxyPeer");
module.exports = (COMMAND) => {
    const NETWORK_COMMAND = COMMAND;
    return {
        init() {
        },
        hasDirectPeer(id) {
            return !!(this.peers[id] && !this.peers[id].isProxy());
        },
        proxy(peerID, throughPeerID) {
            return new Promise((resolve, reject) => {
                if (peerID == throughPeerID || peerID == this.id) {
                    reject("Cannot proxy loopback!");
                    return;
                }
                if (this.peers[throughPeerID].isProxy()) {
                    // TODO: this requires to implement a full network graph (map)
                    // TODO: this will enable to send messages without having multiple forward headers
                    reject("Cannot proxy via a proxy! atm... :)");
                    return;
                }
                this.peers[throughPeerID].sendInternal({
                    type: NETWORK_COMMAND,
                    action: "proxy",
                    id: peerID
                }, true).then((packet) => {
                    if (packet.msg.ok && !this.peers[peerID]) {
                        let protocol = new AnyProtocol(this, new ProxyPeer(true, this.id, peerID, this.peers[throughPeerID]), this.peers[throughPeerID].options);
                        this.onProtocolReady(protocol);
                        resolve(this.peers[peerID]);
                    } else {
                        reject("Cannot proxy!");
                    }
                }).catch(reject);
            })
        },
        unproxy(peerID, throughPeerID, reason) {
            reason = reason || "Proxy Connection Closed";
            if (this.peers[peerID] && this.peers[peerID].isProxy()) {
                this.peers[throughPeerID].sendInternal({
                    type: NETWORK_COMMAND,
                    action: "unproxy",
                    id: peerID
                });
                this.onPeerDisconnected(this.peers[peerID], reason);
            }
        }
    }
}