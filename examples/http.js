const AnySocket = require("../src/index");

// SERVER
const server = new AnySocket();
server.http.any(new RegExp("\/hello.*"), (peer) => {
    peer
        .status(200)
        .body("hello world from regex")
        .end();
});
server.http.get("/", (peer) => {
    peer
        .status(200)
        .body("hello world")
        .end();
});

server.http.post("/post", (peer) => {
    console.log("Post Data:", peer.query.body);
    peer
        .status(200)
        .header('Content-Type', 'text/javascript')
        .body(JSON.stringify({}))
        .end();
});

server.http.error((peer, error) => {
    console.log(peer.url, error);
    // uncomment if you want to override the default response / status code
    peer
        .status(200)
        .body("404 Page not found")
        .end();
});
server.listen("http", 80);