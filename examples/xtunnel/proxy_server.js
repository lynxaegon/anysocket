const AnySocket = require("../../src/index");
const server = new AnySocket();
console.log("AnySocket.ID", server.id);

const clients = {};
const authPackets = {};
const authQueue = {};


server.listen("ws", 3000);
server.on("connected", (peer) => {
    console.log("[SERVER][" + peer.id + "] Connected");
});
// allow proxying
server.canProxy = (peerID, otherPeerID) => {
    return clients[peerID] && clients[peerID] == otherPeerID;
};
server.on("message", (packet) => {
    console.log(packet.msg);
    if(packet.msg.type == "auth") {
        if(authPackets[packet.msg.key]) {
            // matched
            clients[packet.peer.id] = authPackets[packet.msg.key].id;
            clients[authPackets[packet.msg.key].id] = packet.peer.id;

            packet.peer.send({
                type: "matched",
                id: authPackets[packet.msg.key].id
            });
            clearAuth(authPackets[packet.msg.key].id);
            console.log("matched!");
        } else {
            // not matched
            authQueue[packet.peer.id] = packet.msg.key;
            authPackets[packet.msg.key] = packet.peer;
        }
    }
});

server.on("disconnected", (peer, reason) => {
    delete clients[peer.id];
    clearAuth(peer.id);

    console.log("[SERVER][" + peer.id + "] Disconnected. Reason:", reason);
});

function clearAuth(peerID) {
    delete authPackets[authQueue[peerID]];
    delete authQueue[peerID];
}