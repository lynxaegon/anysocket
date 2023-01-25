const AnySocket = require("../../src/index");
let args = process.argv.slice(2);


const client1 = new AnySocket();
client1.mesh();
client1.listen("ws", parseInt(args[0]));
client1.on("connected", (peer) => {
    console.log("Connected peer.id: " + peer.id);
});
client1.on("message", (packet) => {
    console.log("PACKET peer.id: " + packet.peer.id + " - " + packet.msg);
});
client1.on("disconnected", (peer) => {
    process.exit(-1);
})

if(args[1]) {
    client1.connect("ws", args[1], parseInt(args[2]));
}