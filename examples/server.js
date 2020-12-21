const AnySocket = require("../src/index");

const server = new AnySocket(AnySocket.Type.SERVER);
server.transport(AnySocket.Transport.WS, {
    port: 1234
});

const log = (...args) => {
    console.log("SERVER:",...args);
};

server.on("connected", (peer) => {
    log("connected", peer.id);
});

server.on("disconnected", (peer, reason) => {
    log("disconnected", reason);
});

server.on("e2e", (peer) => {
    console.log("E2E enabled for: " + peer.id)
});

let isFirstMessage = true;
server.on("message", (packet) => {
    log("message", packet.data);
    if(isFirstMessage) {
        isFirstMessage = false;
        log("sending e2e");
        packet.peer.e2e();
    }
});

server.start().then(() => {
    console.log("started server");
}).catch(console.error);
