const AnySocket = require("../src/index");

// SERVER
const server = new AnySocket();
server.listen("ws", 3000);
server.on("connected", (peer) => {
    console.log("[SERVER][" + peer.id + "] Connected");

    peer.send({hello: "world"}, true)
        .then(packet => {
            console.log("[SERVER][" + peer.id + "] Got Reply:", packet.msg);

            // Enable E2EE - can be enabled anytime
            peer.e2e();
        }).catch(err => {
            console.log("[SERVER][" + peer.id + "] Reply failed.", err);
        });

    console.log("[SERVER][" + peer.id + "] Sent Hello Message");
});
server.on("message", (packet) => {
    console.log("[SERVER][" + packet.peer.id + "] Got Message", packet.msg);
    packet.peer.disconnect("Finished Example");
    // exit cleanly
    server.stop();
});
server.on("e2e", (peer) => {
    console.log("[SERVER][" + peer.id + "] E2E Enabled");
});
server.on("disconnected", (peer, reason) => {
    console.log("[SERVER][" + peer.id + "] Disconnected. Reason:", reason);
});


// CLIENT
const client = new AnySocket();
client.connect("ws", "127.0.0.1",3000);
client.on("connected", (peer) => {
    console.log("[CLIENT][" + peer.id + "] Connected");
});
client.on("message", (packet) => {
    console.log("[CLIENT][" + packet.peer.id + "] Sent Reply Message");
    packet.reply({
        world: "hello"
    });
});
client.on("e2e", (peer) => {
    console.log("[CLIENT][" + peer.id + "] E2E Enabled");
    peer.send({
        ok: "this was easy"
    });
});
client.on("disconnected", (peer, reason) => {
    console.log("[CLIENT][" + peer.id + "] Disconnected. Reason:", reason);
});