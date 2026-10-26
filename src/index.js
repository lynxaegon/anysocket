const AnySocket = require("./libs/AnySocket");
const AnyPacker = require("./libs/AnyPacker");

const stream = require("./modules/transports/tcp/transport");

AnySocket.Transport = {
    "WS": require("./modules/transports/ws/transport"),
    "HTTP": require("./modules/transports/http/transport"),
    // Not in the browser build, which has no sockets of its own.
    "TCP": stream.TCP,
    "IPC": stream.IPC
};
// Deprecated. Bytes in a message, an RPC argument or an RPC result travel as
// bytes, so there is nothing left to pack them for.
AnySocket.Packer = {
    pack: AnyPacker.packBytes.bind(AnyPacker),
    unpack: AnyPacker.unpackBytes.bind(AnyPacker)
};
const { AnySocketError, CODES } = require("./libs/errors");
// Errors the library raises carry one of these as `code`.
AnySocket.Error = AnySocketError;
AnySocket.ERRORS = CODES;
module.exports = AnySocket;