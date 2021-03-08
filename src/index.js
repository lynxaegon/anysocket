const AnySocket = require("./libs/AnySocket");
const AnyPacker = require("./libs/AnyPacker");

AnySocket.Transport = {
    "LOCAL": require("./modules/transports/local/transport"),
    "WS": require("./modules/transports/ws/transport")
};
AnySocket.Utils = require("./libs/utils");
AnySocket.Packer = {
    pack: AnyPacker.packBytes.bind(AnyPacker),
    unpack: AnyPacker.unpackBytes.bind(AnyPacker)

};
AnySocket.tmp = require("./libs/utils_buffer");

module.exports = AnySocket;