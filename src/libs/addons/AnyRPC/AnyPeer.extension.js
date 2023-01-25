const BufferUtils = require("../../utils_buffer");
const AnyPacker = require("../../AnyPacker");
module.exports = (COMMAND) => {
    const NETWORK_COMMAND = COMMAND;
    return {
        init() {
            const handlers = {
                get: (target, name) => {
                    const prop = target[name];
                    if (prop != null) { return prop; }

                    if(!target.path)
                        target.path = [];

                    target.path.push(name);
                    return new Proxy(target, {
                        get: handlers.get,
                        apply: (target, name, args) => {
                            let path = target.path;
                            target.path = [];
                            return new Promise((resolve, reject) => {
                                let binary = [];
                                for(let item in args) {
                                    if(BufferUtils.isBuffer(args[item])) {
                                        args[item] = AnyPacker.packBytes(args[item]);
                                        binary.push(item);
                                    }
                                }

                                this.sendInternal({
                                    type: NETWORK_COMMAND,
                                    method: path,
                                    params: args || null,
                                    bin: binary
                                }, true)
                                    .then((packet) => {
                                        if(packet.msg.error) {
                                            reject(packet.msg);
                                        } else {
                                            let result = packet.msg.result;
                                            if(packet.msg.bin)
                                                result = AnyPacker.unpackBytes(result);
                                            resolve(result);
                                        }
                                    })
                                    .catch((e) => {
                                        reject(e)
                                    });
                            });
                        }
                    });
                }
            };
            this.rpc = new Proxy(() => {}, handlers);
        }
    }
}