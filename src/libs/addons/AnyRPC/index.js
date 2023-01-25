const AnyAddon = (require("../AnyAddon"))(__dirname);
const AnySocket = require("../../../index");
const BufferUtils = require("../../utils_buffer");

module.exports = class AnyRPC extends AnyAddon {
    onInternalNetwork(packet) {
        let parent = false;
        let tmp = this.anysocket.rpc;
        for (let key in packet.msg.method) {
            parent = tmp;
            tmp = tmp[packet.msg.method[key]];
            if (!tmp)
                break;
        }

        // method not found
        if (!parent || !tmp || typeof tmp != "function") {
            packet.reply({
                error: "Method not found",
                code: 404
            });
        } else {
            try {
                for (let item of packet.msg.bin) {
                    packet.msg.params[item] = AnySocket.Packer.unpack(packet.msg.params[item]);
                }

                Promise.resolve(tmp.apply(parent, packet.msg.params))
                    .then((result) => {
                        let binary = false;
                        if (BufferUtils.isBuffer(result)) {
                            result = AnySocket.Packer.pack(result)
                            binary = true;
                        }
                        packet.reply({
                            result: result,
                            bin: binary
                        });
                    })
                    .catch((e) => {
                        packet.reply({
                            error: e,
                            code: 500
                        });
                    });
            } catch (e) {
                packet.reply({
                    error: e.message,
                    code: 500
                });
            }
        }
    }
}