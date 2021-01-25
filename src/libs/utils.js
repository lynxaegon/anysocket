const crypto = require("crypto");
const BufferUtils = require("./utils_buffer");

module.exports = new (class Utils {
    uuidv4() {
        return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    certificates(size) {
        return new Promise(resolve => {
            Promise.resolve(crypto.generateKeyPairSync('rsa', {
                modulusLength: size,
                publicKeyEncoding: {
                    type: 'spki',
                    format: 'pem'
                },
                privateKeyEncoding: {
                    type: 'pkcs8',
                    format: 'pem'
                }
            })).then(result => {
                // browser
                if (typeof window !== 'undefined') {
                    window.crypto.subtle.exportKey("spki", result.publicKey).then(key => {
                        let publicKey = window.btoa(String.fromCharCode(...new Uint8Array(key)));
                        publicKey = publicKey.match(/.{1,64}/g).join('\n');
                        publicKey = "-----BEGIN PUBLIC KEY-----\n" + publicKey + "\n-----END PUBLIC KEY-----";

                        resolve({
                            public: publicKey,
                            private: result.privateKey
                        });
                    });
                } else {
                    resolve({
                        public: result.publicKey,
                        private: result.privateKey
                    });
                }
            });
        });
    }

    convertPemToBinary(pem) {
        let b64Lines = pem.replace(/\n/g, "");
        let b64Prefix = b64Lines.replace('-----BEGIN PUBLIC KEY-----', '');
        let b64Final = b64Prefix.replace('-----END PUBLIC KEY-----', '');

        return BufferUtils.bufferFromBase64(b64Final);
    }

    importKey(key) {
        return new Promise((resolve) => {
            if (typeof window !== 'undefined') {
                window.crypto.subtle.importKey(
                    "spki",
                    this.convertPemToBinary(key),
                    {
                        name: "RSA-OAEP",
                        hash: {
                            name: "SHA-256"
                        }
                    },
                    false,
                    ["encrypt"]
                ).then(resolve);
            } else {
                resolve(key);
            }
        });
    }

    encryptRSA(key, data) {
        return new Promise((resolve, reject) => {
            Promise.resolve(crypto.publicEncrypt({
                    key: key,
                    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                    oaepHash: "sha256",
                },
                BufferUtils.bufferFromString(data)
            )).then(result => {
                resolve(result.toString("base64"));
            }).catch(reject);
        });
    }

    decryptRSA(key, data) {
        return new Promise((resolve, reject) => {
            Promise.resolve(crypto.privateDecrypt({
                    key: key,
                    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                    oaepHash: "sha256",
                },
                BufferUtils.bufferFromBase64(data)
            )).then(result => {
                resolve(result.toString());
            }).catch(reject);
        });
    }
})();