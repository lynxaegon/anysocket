const AnySocket = require("../src/index");

// SERVER
const server = new AnySocket();
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
    packet.reply("test reply");
});
server.on("e2e", (peer) => {
    console.log("[SERVER][" + peer.id + "] E2E Enabled");
});
server.on("disconnected", (peer, reason) => {
    console.log("[SERVER][" + peer.id + "] Disconnected. Reason:", reason);
});
