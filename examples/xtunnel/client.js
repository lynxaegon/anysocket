const Utils = require("./utils");
const AnySocket = require("../../src/index");
const client = new AnySocket();
client.connect("ws", "127.0.0.1", 4000).catch((err) => {
    console.log(err);
});

client.on("connected", (peer) => {
    console.log("connected");
    // generated password
    const password = "1234";

    peer.send({
        type: "auth",
        data: Utils.encrypt("elo", password)
    }, true, 1 * 1000).then((packet) => {
        console.log("matched", packet);
        if(packet.msg == "1") {
            packet.peer.e2e();
        }
    }).catch(e => {
        console.log("failed reply!", e)
        peer.disconnect("No match found.. Timeout reached")
    });
});
client.on("e2e", (peer) => {
    console.log("e2e");
    peer.send({
        type: "msg",
        hello: "world"
    });
});

client.on("disconnected", (peer, reason) => {
    console.log("disconnected", reason);
});