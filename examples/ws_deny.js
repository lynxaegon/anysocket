const AnySocket = require("../src/index");
const server = new AnySocket();
server.listen("ws", 3000);

server.http.upgrade((peer) => {
    if(peer.cookies.hello == "world")
        return;

    peer.end();
});


const client = new AnySocket();
client.connect("ws", "127.0.0.1", 3000).then((peer) => {
    console.log("Connected peer:", peer.id);
}).catch(e => {
    console.log(e);

    client.connect("ws", "127.0.0.1", 3000, {
        cookies: {
            "hello": "world"
        }
    }).then((peer) => {
        console.log("Connected peer:", peer.id);
    }).catch(e => {
        console.log(e);
    });
});