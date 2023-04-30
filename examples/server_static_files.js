const AnySocket = require("../src/index");

// SERVER
const server = new AnySocket();

// Static Files automatically set Content-Type based on extension
// see: anysocket/src/libs/_constants.js

// http://localhost/static_files/index.html
server.http.static("/static_files"); // resolves to ./static_files/*

// http://localhost/static_files/index.html
server.http.static("static_files"); // resolves to ./static_files/*

// http://localhost/static/index.html
server.http.static("/static", "./static_files"); // resolves to ./static_files/*

// http://localhost/hello
server.http.get("/hello", (peer) => {
    // serves a single static file
    peer.serveFile("./static_files/index.html");
})

server.listen("http", 80);