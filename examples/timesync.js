const AnySocket = require("../src/index");
const crypto = require('crypto');

let ORIGINAL_BYTES = crypto.randomBytes(1024 * 1024 * 100);

// SERVER
const server = new AnySocket();
server.listen("ws", 3000);
server.on("connected", (peer) => {
    console.log("[SERVER][" + peer.id + "] Connected");
});
server.on("disconnected", (peer, reason) => {
    console.log("[SERVER][" + peer.id + "] Disconnected. Reason:", reason);
});


// CLIENT
const client = new AnySocket();
client.connect("ws", "127.0.0.1", 3000);
client.on("connected", async (peer) => {
    console.log("[CLIENT][" + peer.id + "] Connected");
    console.log(await peer.getSyncedTime(true));
});
client.on("disconnected", (peer, reason) => {
    console.log("[CLIENT][" + peer.id + "] Disconnected. Reason:", reason);
});