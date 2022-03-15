const AnySocket = require("anysocket");
const server = new AnySocket();
server.http.any("/", (peer) => {
    peer
        .status(200)
        .body("hello world")
        .end();
});
server.listen("http", 8080);