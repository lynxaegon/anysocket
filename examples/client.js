const AnySocket = require("../src/index");

function create() {
    const client = new AnySocket();
    client.on("connected", (peer) => {
        console.log("connected", peer.id);
    });

    client.on("disconnected", (peer, reason) => {
        console.log(reason);
    });

    client.on("message", (packet) => {
        if (packet.data.type == "test") {
            packet.reply({
                type: "test",
                result: "ok"
            });
        }
    });

    client.on("e2e", (peer) => {
        console.log("E2E enabled for: " + peer.id)
    });

    client.connect("ws", "127.0.0.1", 1234);


    setTimeout(() => {
        client.stop();
    }, 5000);
}

create();
// setInterval(() => {
//     client.send("test " + client.id).then((packet) => {
//
//     });
// }, 1000);
