const AnySocket = require("../../src/index");

const client = new AnySocket();
client.id = "c442d833-04ef-4b06-a1ff-fb90e04ed5bd";
client.connect("ws", "127.0.0.1",3000);
client.on("connected", (peer) => {
    console.log("[CLIENT][" + peer.id + "] Connected");
});
client.on("message", (packet) => {
    console.log("GOT PACKET:", packet.msg);
    packet.reply({
        "hello": "john"
    });
});
client.on("disconnected", (peer, reason) => {
    console.log("[CLIENT][" + peer.id + "] Disconnected. Reason:", reason);
});