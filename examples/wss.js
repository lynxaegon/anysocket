const AnySocket = require("../src/index");

// SERVER
const server = new AnySocket();

// Important: In order to have a WSS (secure WebSocket) you first need to create a HTTP
// server and after the server is created, you can listen on the WS transport and it will
// automatically use the HTTPS connection

// HTTPS Bootstrap
server.listen("http", {
    key: "./key.pem",
    cert: "./cert.pem",
    port: 443,
    host: "0.0.0.0"
});
// WSS Bootstrap
server.listen("ws");

