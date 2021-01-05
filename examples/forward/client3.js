const AnySocket = require("../../src/index");

const args = process.argv.splice(2);
const forwardID = args[0];

const client = new AnySocket();
client.connect("ws", "127.0.0.1",3001);
let addedProxy = false;
client.on("connected", (peer) => {
    console.log("[CLIENT][" + peer.id + "] Connected");
    if(!addedProxy) {
        addedProxy = true;
        client.proxy(forwardID, peer.id);
    } else {
        peer.send({
            "hello": "world"
        }, true).then(packet => {
            console.log("Reply",packet.msg)
        });
    }
});

client.on("message", (packet) => {
    console.log("GOT PACKET:", packet.msg);
});
client.on("disconnected", (peer, reason) => {
    console.log("[CLIENT][" + peer.id + "] Disconnected. Reason:", reason);
});