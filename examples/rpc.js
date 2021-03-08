const AnySocket = require("../src/index");

// SERVER
const server = new AnySocket();
server.listen("ws", 3000);
server.on("connected", async (peer) => {
    console.log("[SERVER][" + peer.id + "] Connected");

    setTimeout(() => {
        server.stop();
    }, 1000);
    console.log("[SERVER][" + peer.id + "] Sent Hello Message");
    console.log("result", await peer.rpc.hello.user("LynxAegon"));
    console.log("result", await peer.rpc.hello.world());
    console.log("result", await peer.rpc.hello.binary(Buffer.from(new Uint8Array([1,2,3,4,5,6,7,8,9,10]))));
});
server.on("disconnected", (peer, reason) => {
    console.log("[SERVER][" + peer.id + "] Disconnected. Reason:", reason);
});


// CLIENT
const client = new AnySocket();
// RPC can also be a plain class which preserves this
/*
class Test {
    constructor() {
        this.is_test = true;
    }

    hello() {
        return this.is_test;
    }
}
*/
// world & user methods have "this" set as "hello" object (method parent is always "this")
client.setRPC({
    hello: {
        world: () => {
            if(!this._user) {
                return "Hello World";
            }

            return "Hello World and Hello " + this._user;
        },
        user: (user) => {
            this._user = user;
            return "Hello " + user;
        },
        binary(bytes) {
            console.log(bytes);
            return bytes;
        }
    }
});

client.connect("ws", "127.0.0.1",3000);
client.on("connected", (peer) => {
    console.log("[CLIENT][" + peer.id + "] Connected");
});
client.on("message", (packet) => {
    console.log("[CLIENT][" + packet.peer.id + "] Sent Reply Message");
});
client.on("disconnected", (peer, reason) => {
    console.log("[CLIENT][" + peer.id + "] Disconnected. Reason:", reason);
});