const AnySocket = require("../../src/index");

const server = new AnySocket();
const log = (...args) => {
    console.log("SERVER:",...args);
};

server.on("connected", (peer) => {
    log("connected", peer.id);
    peer.e2e();

    peer.send({
        type: "test"
    }, true).then((packet) => {
        console.log("Replied:", packet.msg);
    }).catch((err) => {
        console.log("Reply failed:", err);
    });
});

server.on("disconnected", (peer, reason) => {
    log("disconnected", reason);
});

server.on("e2e", (peer) => {
    console.log("E2E enabled for: " + peer.id)
});

server.on("message", (packet) => {
    log("message", packet.msg);
});

server.server("ws", {
    port: 1234
}).then(() => {
    console.log("started server");
}).catch(console.error);
