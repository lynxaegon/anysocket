const AnySocket = require("../src/index");

const server = new AnySocket(AnySocket.Type.SERVER);
server.transport(AnySocket.Transport.WS, {
    port: 1234
});

server.on("connected", (peer) => {
   console.log("connected", peer.id);
});

server.on("disconnected", (peer, reason) => {
    console.log("disconnected", peer.id);
});

let isFirstMessage = true;
server.on("message", (message) => {
    console.log("message", message.packet);
    if(isFirstMessage) {
        isFirstMessage = false;
        console.log("sending e2e");
        message.peer.e2e();
    }
});

server.start().then(() => {
    console.log("started server");
}).catch(console.error);
