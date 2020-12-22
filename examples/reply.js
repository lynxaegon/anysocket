const AnySocket = require("../src/index");

// SERVER
const server = new AnySocket();
server.listen("ws", 3000);
server.on("connected", (peer) => {
    console.log("[SERVER] Connected", peer.id);

    peer.send({hello: "world"}, true)
        .then(packet => {
            console.log("[SERVER] Got Reply:", packet.msg);
            peer.disconnect("Finished Example");
            // exit cleanly
            server.stop();
        }).catch(err => {
            console.error("[SERVER] Reply Failed:", err);
        });

    console.log("[SERVER] Sent Hello Message", peer.id);
});
server.on("disconnected", (peer, reason) => {
    console.log("[SERVER] Disconnected", peer.id, "Reason:", reason);
});


// CLIENT
const client = new AnySocket();
client.connect("ws", "127.0.0.1",3000);
client.on("connected", (peer) => {
    console.log("[CLIENT] Connected", peer.id);
});
client.on("message", (packet) => {
    console.log("[SERVER] Sent Reply Message", packet.peer.id);
    packet.reply({
        world: "hello"
    });
});
client.on("disconnected", (peer, reason) => {
    console.log("[CLIENT] Disconnected", peer.id, "Reason:", reason);
});