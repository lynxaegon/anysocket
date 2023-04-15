const AnySocket = require("../src/index");

// SERVER
const server = new AnySocket();

// Important: In order to have a WSS (secure WebSocket) you first need to create a HTTP
// server and after the server is created, you can listen on the WS transport and it will
// automatically use the HTTPS connection
//
// // HTTPS Bootstrap
// server.listen("http", {
//     key: "./key.pem",
//     cert: "./cert.pem",
//     port: 443,
//     host: "0.0.0.0"
// });
// WSS Bootstrap
// server.listen("uws", 8080);
//
// CLIENT
const client = new AnySocket();
client.connect("ws", "127.0.0.1",8080, {
    handshakeTimeout: 100
});
client.on("connected", (peer) => {
    console.log("[CLIENT][" + peer.id + "] Connected");
});
client.on("message", (packet) => {
    console.log("[CLIENT][" + packet.peer.id + "] Sent Reply Message");
    packet.reply({
        world: "hello"
    });
});
client.on("disconnected", (peer, reason) => {
    console.log("[CLIENT][" + peer.id + "] Disconnected. Reason:", reason);
});