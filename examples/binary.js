const AnySocket = require("../src/index");
const crypto = require('crypto');

// SERVER
const server = new AnySocket();
server.listen("ws", 3000);
server.on("connected", (peer) => {
    console.log("[SERVER][" + peer.id + "] Connected");

    // peer.send({
    //     hello: "world",
    //     bin: AnySocket.Packer.pack(str2ab("Hello World"))
    // });
    console.time("e2e enabling");

    peer.e2e();

    console.log("[SERVER][" + peer.id + "] Sent Hello Message");
});
server.on("e2e", (peer) => {
    console.timeEnd("e2e enabling");
    console.log("E2E enabled!");
    let bytes = crypto.randomBytes(1024 * 1024 * 100);
    console.time("send binary");
    peer.send({
        hello: "world",
        bin: AnySocket.Packer.pack(bytes)
    });
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
    // console.log("[CLIENT][" + packet.peer.id + "]",
    //     ab2str(AnySocket.Packer.unpack(packet.msg.bin)) == "Hello World" ? "Received Binary" : "Failed Binary"
    // );

    console.timeEnd("send binary");
    console.log("Received", packet.msg.bin.length);
    server.stop();
    client.stop();
});
client.on("disconnected", (peer, reason) => {
    console.log("[CLIENT][" + peer.id + "] Disconnected. Reason:", reason);
});

function ab2str(bytes) {
    return String.fromCharCode.apply(null, new Uint8Array(bytes));
}

function str2ab(str) {
    let buf = new ArrayBuffer(str.length);
    let bufView = new Uint8Array(buf);
    for (let i = 0, strLen = str.length; i < strLen; i++) {
        bufView[i] = str.charCodeAt(i);
    }

    return new Uint8Array(buf);
}