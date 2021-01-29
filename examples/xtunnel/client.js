const AnySocket = require("../../src/index");

const PASSWORD = "1234";
const SECRET_AUTH = "SECRET_TOKEN_HERE";

const anysocket = new AnySocket();
console.log("AnySocket.ID", anysocket.id);

anysocket.connect("ws", "127.0.0.1",3000);
anysocket.on("connected", (peer) => {
    console.log("[CLIENT][" + peer.id + "] Connected");
    if(!peer.isProxy()) {
        peer.send({
            type: "auth",
            key: PASSWORD
        });
    } else {
        // matched with another client
        peer.e2e();
    }
});
anysocket.on("e2e", (peer) => {
    console.log("Connected peer", peer.id);
    peer.disconnect("Because i said so!");
});
anysocket.on("message", (packet) => {
    if(packet.peer.isProxy()) {
        if(packet.peer.isE2EEnabled()) {
            if (packet.msg.type == "hello") {
                packet.reply({
                    world: "hello"
                });
                packet.peer.disconnect("Because i said so!");
            }
        } else {
            console.log("Requires E2E!");
            anysocket.stop();
        }
    } else {
        if(packet.msg.type == "matched") {
            anysocket.proxy(packet.msg.id, packet.peer.id);
        } else {
            anysocket.stop("Invalid packet received!")
        }
    }

});
anysocket.on("disconnected", (peer, reason) => {
    if(peer.isProxy()) {
        console.log("finished!");
        process.exit(0);
    }
    console.log("[CLIENT][" + peer.id + "] Disconnected. Reason:", reason);
});