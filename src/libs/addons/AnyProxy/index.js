const AnyAddon = (require("../AnyAddon"))(__dirname);
const AnySocketExtension = require("./AnySocket.extension");
const AnyPeerExtension = require("./AnyPeer.extension");
const AnyProtocol = require("../../AnyProtocol");
const ProxyPeer = require("../../ProxyPeer");

module.exports = class AnyRPC extends AnyAddon {
    onInternalNetwork(packet) {
        switch (packet.msg.action) {
            case "proxy":
                this.proxy(packet);
                break;
            case "unproxy":
                this.unproxy(packet);
                break;
            case "connected":
                if (!this.anysocket.peers[packet.msg.id]) {
                    let protocol = new AnyProtocol(this.anysocket, new ProxyPeer(false, this.anysocket.id, packet.msg.id, this.anysocket.peers[packet.peer.id]));
                    this.anysocket.onProtocolReady(protocol);
                }
                break;
            case "disconnected":
                if (!this.anysocket.peers[packet.msg.id]) {
                    packet.peer.disconnect("Invalid proxy request!");
                    return;
                }

                this.anysocket.onPeerDisconnected(this.anysocket.peers[packet.msg.id], "Proxy Connection Closed");
                break;
        }
    }

    proxy(packet) {
        if (this.anysocket.peers[packet.msg.id].isProxy()) {
            packet.reply({
                ok: false
            });
            // TODO: this requires to implement a full network graph (map)
            // TODO: this will enable to send messages without having multiple forward headers
            return;
        }

        this.anysocket.peers[packet.msg.id].addLink(this.anysocket.peers[packet.peer.id]);
        this.anysocket.peers[packet.peer.id].addLink(this.anysocket.peers[packet.msg.id]);

        this.anysocket.peers[packet.msg.id].sendInternal({
            type: this.NETWORK_COMMAND,
            action: "connected",
            id: packet.peer.id
        });
        packet.reply({
            ok: true
        });
    }

    unproxy(packet) {
        this.anysocket.peers[packet.msg.id].removeLink(this.anysocket.peers[packet.peer.id]);
        this.anysocket.peers[packet.peer.id].removeLink(this.anysocket.peers[packet.msg.id]);

        this.anysocket.peers[packet.msg.id].sendInternal({
            type: this.NETWORK_COMMAND,
            action: "disconnected",
            id: packet.peer.id
        });
    }

    onPeerDisconnected(anypeer) {
        const links = anypeer.getLinks();
        for (let peerID in links) {
            links[peerID].sendInternal({
                type: this.NETWORK_COMMAND,
                action: "disconnected",
                id: anypeer.id
            }).catch(() => {
                // ignore, peer maybe already disconnected
            });
            anypeer.removeLink(links[peerID]);
            if (this.anysocket.peers[peerID]) {
                this.anysocket.peers[peerID].removeLink(anypeer);
            }
        }
    }
}