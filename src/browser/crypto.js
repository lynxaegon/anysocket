const crypto = (window.crypto || window.msCrypto);
let QUOTA = 65536;
if(!crypto)
    throw new Error("Crypto is not supported in this browser!");
const BufferUtils = require("./utils_buffer");

class Crypto {
    constructor() {
        this.constants = {
            RSA_PKCS1_OAEP_PADDING: 1
        };
    }

    randomBytes(size) {
        let a = new Uint8Array(size);
        for (let i = 0; i < size; i += QUOTA) {
            crypto.getRandomValues(a.subarray(i, i + Math.min(size - i, QUOTA)));
        }
        return a;
    }

    generateKeyPairSync(type, options) {
        return crypto.subtle.generateKey({
                name: "RSA-OAEP",
                modulusLength: options.modulusLength || 4096,
                publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
                hash: {
                    name: "SHA-256"
                }
            },
            true,
            ["encrypt", "decrypt"]
        );
    }

    publicEncrypt(alg, data) {
        return new Promise(resolve => {
            crypto.subtle.encrypt("RSA-OAEP", alg.key, data).then(result => {
                resolve(BufferUtils.bufferToBase64(result));
            });
        });
    }

    privateDecrypt(alg, data) {
        return new Promise(resolve => {
            crypto.subtle.decrypt("RSA-OAEP", alg.key, data).then(result => {
                resolve(BufferUtils.bufferToString(result));
            });
        });
    }
}

module.exports = new Crypto();