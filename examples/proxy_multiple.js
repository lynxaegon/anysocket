const AnySocket = require("../src/index");

// SERVER
const server = new AnySocket();
server.listen("ws", 3000);
server.canProxy = () => {
    return true;
};
server.on("message", (packet) => {
    console.log("GOT " + packet.msg);
})


const client1 = new AnySocket();
client1.listen("ws", 3001);
client1.canProxy = () => {
    return true;
};

const client2 = new AnySocket();
client2.listen("ws", 3002);
client2.canProxy = () => {
    return true;
};


const client3 = new AnySocket();
client3.listen("ws", 3003);
client3.canProxy = () => {
    return true;
};

console.log("SERVER:  ", server.id);
console.log("CLIENT1: ", client1.id);
console.log("CLIENT2: ", client2.id);
console.log("CLIENT3: ", client3.id);

client1.connect("ws", "127.0.0.1", 3000).then((peer) => {
    client2.connect("ws", "127.0.0.1", 3001).then((peer) => {
        client2.proxy(server.id, client1.id).then((peer) => {
            peer.send("test client 2");
            client3.connect("ws", "127.0.0.1", 3002).then((peer) => {
                client3.proxy(server.id, client2.id).then((peer) => {
                    peer.send("hello world");
                    console.log("ok");
                });
            });
        });
    });
})