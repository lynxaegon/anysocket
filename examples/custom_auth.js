const AnySocket = require("../src/index");

// This is just an example, you can implement any kind of auth
// the only limitation is that you have just one packet available for auth
// Both server and client must implement the auth.
// Client sends the first auth packet and if valid, the server send the auth packet back
// If either one of the packets is invalid, the connection will be closed.
const PASSWORD = "12345"

// SERVER
const server = new AnySocket();
// packet to send to when auth is requested
server.authPacket = () => {
    return PASSWORD;
};
// packet received for auth validation
server.onAuth = (packet => {
    return packet.auth == PASSWORD;
});

server.listen("ws", 3000);
server.on("connected", async (peer) => {
    console.log("[SERVER][" + peer.id + "] Connected");
});
server.on("disconnected", (peer, reason) => {
    console.log("[SERVER][" + peer.id + "] Disconnected. Reason:", reason);
});


// CLIENT
const client = new AnySocket();
// packet to send to when auth is requested
client.authPacket = () => {
    return PASSWORD;
};
// packet received for auth validation
client.onAuth = (packet => {
    return packet.auth == PASSWORD;
});

client.connect("ws", "127.0.0.1", 3000);
client.on("connected", async (peer) => {
    console.log("[CLIENT][" + peer.id + "] Connected");
});
client.on("disconnected", (peer, reason) => {
    console.log("[CLIENT][" + peer.id + "] Disconnected. Reason:", reason);
});