const AnySocket = require("./libs/AnySocket");
const AnyPacker = require("./libs/AnyPacker");

AnySocket.Transport = {
    "WS": require("./modules/transports/ws/transport"),
    "HTTP": require("./modules/transports/http/transport")
};
AnySocket.Packer = {
    pack: AnyPacker.packBytes.bind(AnyPacker),
    unpack: AnyPacker.unpackBytes.bind(AnyPacker)
};
const { AnySocketError, CODES } = require("./libs/errors");
// Errors the library raises carry one of these as `code`.
AnySocket.Error = AnySocketError;
AnySocket.ERRORS = CODES;
module.exports = AnySocket;