const AnySocket = require("../src/index");

const client = new AnySocket(AnySocket.Type.CLIENT);
client.transport(AnySocket.Transport.WS, {
    host: "127.0.0.1:1234"
});

client.on("connected", (peer) => {
    console.log("connected", peer.id);
});

client.on("disconnected", (peer, reason) => {
    console.log(reason);
});

client.on("message", (packet) => {
    console.log("message", packet.data);
    if(packet.data.type == "test") {
        packet.reply({
            type: "test",
            result: "ok"
        });
    }
});


client.start().then(() => {
    console.log("started client");
}).catch(console.error);


// setInterval(() => {
//     client.send("test " + client.id).then((packet) => {
//
//     });
// }, 1000);
