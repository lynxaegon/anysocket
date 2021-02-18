const AnySocket = require("../src/index");

// SERVER
const server = new AnySocket();
server.listen("ws", 3000);
server.canProxy = () => {
    return true;
};

server.on("connected", (peer) => {
    console.log("[SERVER][" + peer.id + "] Connected");
});
server.on("disconnected", (peer, reason) => {
    console.log("[SERVER][" + peer.id + "] Disconnected. Reason:", reason);
});


// CLIENT 1
const client1 = new AnySocket();
client1.on("connected", (peer) => {
    console.log("[CLIENT1][" + peer.id + "] Connected");
});
client1.on("message", (packet) => {
    console.log("[CLIENT1][" + packet.peer.id + "] Got Message", packet.msg);
    packet.reply({
        world: "hello"
    });
});
client1.on("disconnected", (peer, reason) => {
    console.log("[CLIENT1][" + peer.id + "] Disconnected. Reason:", reason);
});


// CLIENT 2
const client2 = new AnySocket();
client2.on("connected", (peer) => {
    console.log("[CLIENT2][" + peer.id + "] Connected");
    if(peer.isProxy()) {
        peer.send({
            "hello": "world"
        }, true).then((packet) => {
            console.log("got reply", packet.msg);
            client2.stop();
            client1.stop();
            server.stop();
        });
    } else {
        client2.proxy(client1.id, peer.id);
    }
});
client2.on("message", (packet) => {
    console.log("[CLIENT2][" + packet.peer.id + "] Got Message", packet.msg);
});
client2.on("disconnected", (peer, reason) => {
    console.log("[CLIENT2][" + peer.id + "] Disconnected. Reason:", reason);
});

client1.connect("ws", "127.0.0.1",3000);
setTimeout(() => {
    client2.connect("ws", "127.0.0.1",3000);
}, 100);
