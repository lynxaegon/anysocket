const AnySocket = require("../src/index");
const crypto = require('crypto');

let ORIGINAL_BYTES = crypto.randomBytes(1024 * 1024 * 100);

// SERVER
const server = new AnySocket();
server.listen("ws", 3000);
server.on("connected", (peer) => {
    console.log("[SERVER][" + peer.id + "] Connected");

    console.time("e2e enabling");
    peer.e2e();
    // testSendBytes(peer, ORIGINAL_BYTES)
});
server.on("e2e", (peer) => {
    console.timeEnd("e2e enabling");
    console.log("E2E enabled!");

    testSendBytes(peer, ORIGINAL_BYTES);
});
server.on("disconnected", (peer, reason) => {
    console.log("[SERVER][" + peer.id + "] Disconnected. Reason:", reason);
});


// CLIENT
const client = new AnySocket();
client.connect("ws", "127.0.0.1", 3000);
client.on("connected", (peer) => {
    console.log("[CLIENT][" + peer.id + "] Connected");
});
client.on("message", (packet) => {
    let recvBytes = AnySocket.Packer.unpack(packet.msg.bin);
    console.timeEnd("send binary");
    console.log(
        "Received", recvBytes.length,
        Buffer.compare(recvBytes, ORIGINAL_BYTES) === 0 ? "buffers are identical" : "buffers are different"
    );
    server.stop();
    client.stop();
});
client.on("disconnected", (peer, reason) => {
    console.log("[CLIENT][" + peer.id + "] Disconnected. Reason:", reason);
});


function testSendBytes(peer, bytes) {
    console.time("send binary");
    console.log("sending...", ORIGINAL_BYTES.length)
    peer.send({
        hello: "world",
        bin: AnySocket.Packer.pack(ORIGINAL_BYTES)
    });
}