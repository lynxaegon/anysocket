const Utils = require("../libs/utils");
const BufferUtils = require("./utils_buffer");

Utils.encryptAES = (secret, data) => {
    return new Promise((resolve, reject) => {
        window.crypto.subtle.importKey(
            "raw",
            BufferUtils.bufferFromHex(secret),
            {
                name: "AES-CBC",
                length: 256
            },
            false,
            ["encrypt"]
        ).then(key => {
            let iv = window.crypto.getRandomValues(new Uint8Array(16));
            window.crypto.subtle.encrypt({
                    name: "AES-CBC",
                    iv: iv,
                },
                key,
                BufferUtils.bufferFromString(data)
            )
            .then(function(encrypted) {
                resolve(BufferUtils.bufferToHex(iv) + BufferUtils.bufferToHex(new Uint8Array(encrypted)));
            })
            .catch(function(err) {
                reject(err);
            });
        }).catch(reject);
    });
};

Utils.decryptAES = (secret, data) => {
    return new Promise((resolve, reject) => {
        window.crypto.subtle.importKey(
            "raw",
            BufferUtils.bufferFromHex(secret),
            {
                name: "AES-CBC",
                length: 256
            },
            false,
            ["decrypt"]
        ).then(key => {
            window.crypto.subtle.decrypt({
                    name: "AES-CBC",
                    iv: BufferUtils.bufferFromHex(data.substr(0, 32))
                },
                key,
                BufferUtils.bufferFromHex(data.substr(32))
            )
            .then(function(encrypted) {
                resolve(BufferUtils.bufferToString(new Uint8Array(encrypted)));
            })
            .catch((e) => {
                reject(e);
            });
        }).catch((e) => {
            reject(e);
        });
    });
};

module.exports = Utils;