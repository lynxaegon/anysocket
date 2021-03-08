const AnySocket = require("../../src");

// SERVER
const server = new AnySocket();
server.listen("ws", 3000);
server.on("connected", (peer) => {
    console.log("[SERVER][" + peer.id + "] Connected");
});
server.on("message", (packet) => {
    console.log("[SERVER][" + packet.peer.id + "] Got Message", packet.msg);
});
server.on("e2e", (peer) => {
    console.log("[SERVER][" + peer.id + "] E2E Enabled");
    peer.send({
        "hello":"world"
    });
});
server.on("disconnected", (peer, reason) => {
    console.log("[SERVER][" + peer.id + "] Disconnected. Reason:", reason);
});