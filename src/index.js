const AnySocket = require("./libs/AnySocket");

const stream = require("./modules/transports/tcp/transport");

AnySocket.Transport = {
    "WS": require("./modules/transports/ws/transport"),
    "HTTP": require("./modules/transports/http/transport"),
    // Not in the browser build, which has no sockets of its own.
    "TCP": stream.TCP,
    "IPC": stream.IPC
};
const { AnySocketError, CODES } = require("./libs/errors");
// Errors the library raises carry one of these as `code`.
AnySocket.Error = AnySocketError;
AnySocket.ERRORS = CODES;
module.exports = AnySocket;