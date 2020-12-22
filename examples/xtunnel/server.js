const AnySocket = require("../../src/index");
const proxy = new AnySocket();
proxy.server("ws", 4000);

const awaitAuth = {};
const peerToAuth = {};
const peers = {};

proxy.on("connected", (peer) => {
    console.log("["+peer.id+"] connected");
});

proxy.on("message", (packet) => {
    if(packet.msg.type == "auth") {
        console.log("recv auth:", packet.msg.data);
        if(awaitAuth[packet.msg.data]) {
            const authPacket = awaitAuth[packet.msg.data];
            const peer1 = authPacket.peer;
            const peer2 = packet.peer;
            peers[peer1.id] = peer2;
            peers[peer2.id] = peer1;
            delete peerToAuth[peer1.id];
            delete awaitAuth[packet.msg.data];
            // send connect info

            console.log("matched", peer1.id, peer2.id);

            console.log("Await Auth", awaitAuth);
            console.log("PeerToAuth", peerToAuth);
            console.log("Peers", peerToAuth);

            authPacket.reply(1);
            packet.reply(0);
        } else {
            awaitAuth[packet.msg.data] = packet;
            peerToAuth[packet.peer.id] = packet.msg.data;
        }
    } else if(packet.msg.type == "auth") {
        console.log("SERVER GOT MSG:", packet.msg);
    } else {
        console.log(packet.msg);
        packet.peer.disconnect("Invalid packet received!");
    }
});

proxy.on("disconnected", (peer, reason) => {
    const code = peerToAuth[peer.id];
    const assignedPeer = peers[peer.id];
    delete peerToAuth[peer.id];
    delete awaitAuth[code];
    delete peers[peer.id];

    console.log("["+peer.id+"] disconnected", reason);

    if(assignedPeer)
        assignedPeer.disconnect("Assigned peer disconnected");
});