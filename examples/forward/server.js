const AnySocket = require("../../src/index");

const server = new AnySocket();
server.listen("ws", 3000);
server.on("connected", (peer) => {
    console.log("[SERVER][" + peer.id + "] Connected");
});
server.on("disconnected", (peer, reason) => {
    console.log("[SERVER][" + peer.id + "] Disconnected. Reason:", reason);
});