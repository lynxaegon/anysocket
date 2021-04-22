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
server.http.error((peer, error) => {
    console.log(peer.url, error);
    // uncomment if you want to override the default response / status code
    peer
        .status(200)
        .body("404 Page not found")
        .end();
});
server.listen("http", {
    key: "./key.pem",
    cert: "./cert.pem",
    port: 443,
    host: "0.0.0.0"
});