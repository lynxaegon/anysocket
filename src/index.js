const AnySocket = require("./libs/AnySocket");
const AnyPacker = require("./libs/AnyPacker");

AnySocket.Transport = {
    "LOCAL": require("./modules/transports/local/transport"),
    "WS": require("./modules/transports/ws/transport"),
    "WSS": require("./modules/transports/ws/transport"),
    "HTTP": require("./modules/transports/http/transport")
};
AnySocket.Packer = {
    pack: AnyPacker.packBytes.bind(AnyPacker),
    unpack: AnyPacker.unpackBytes.bind(AnyPacker)
};
module.exports = AnySocket;