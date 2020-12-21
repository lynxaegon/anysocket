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

client.on("message", (message) => {
    console.log("message", message.packet);
});


client.start().then(() => {
    console.log("started client");
}).catch(console.error);


setInterval(() => {
    client.send("test " + client.id);
}, 1000);
