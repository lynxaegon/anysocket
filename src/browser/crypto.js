const crypto = (window.crypto || window.msCrypto);
let QUOTA = 65536;
if (!crypto)
    throw new Error("Crypto is not supported in this browser!");
const BufferUtils = require("./utils_buffer");

const ECDH_ALGORITHM = "P-521";

class Crypto {
    randomBytes(size) {
        let a = new Uint8Array(size);
        for (let i = 0; i < size; i += QUOTA) {
            crypto.getRandomValues(a.subarray(i, i + Math.min(size - i, QUOTA)));
        }
        return a;
    }

    createECDH() {
        return new Promise(async (resolve, reject) => {
            window.crypto.subtle.generateKey(
                {
                    name: "ECDH",
                    namedCurve: ECDH_ALGORITHM
                },
                false,
                ["deriveKey", "deriveBits"]
            )
                .then(function (key) {
                    resolve({
                        generateKeys: () => {
                            return new Promise((resolve, reject) => {
                                window.crypto.subtle.exportKey(
                                    "raw",
                                    key.publicKey
                                )
                                    .then(function (keydata) {
                                        keydata = new Uint8Array(keydata);
                                        resolve(keydata)
                                    })
                                    .catch(function (err) {
                                        reject(err)
                                    });
                            });
                        },
                        computeSecret(buf) {
                            return new Promise((resolve, reject) => {
                                window.crypto.subtle.importKey(
                                    "raw",
                                    buf,
                                    {
                                        name: "ECDH",
                                        namedCurve: ECDH_ALGORITHM
                                    },
                                    false,
                                    []
                                )
                                    .then(function (keydata) {
                                        window.crypto.subtle.deriveBits(
                                            {
                                                name: 'ECDH',
                                                namedCurve: ECDH_ALGORITHM,
                                                public: keydata
                                            },
                                            key.privateKey,
                                            512
                                        ).then(keydata => {
                                            keydata = new Uint8Array(keydata);
                                            resolve(BufferUtils.bufferToHex(keydata));
                                        });
                                    })
                                    .catch(function (err) {
                                        reject(err)
                                    });
                            })
                        }
                    });
                })
                .catch(function (err) {
                    reject(err);
                });
        });
    }

    pbkdf2Sync(secret, salt, iterations, length, algorithm) {
        let algo = {
            "sha256": "SHA-256"
        };
        if (!algo[algorithm])
            throw new Error("Invalid algorithm " + algorithm);
        algorithm = algo[algorithm];

        return new Promise(async (resolve, reject) => {
            if (!(secret instanceof CryptoKey)) {
                secret = await window.crypto.subtle.importKey(
                    "raw",
                    BufferUtils.utf8Encode(secret),
                    {
                        name: "PBKDF2",
                    },
                    false,
                    ["deriveKey", "deriveBits"]
                );
            }
            window.crypto.subtle.deriveBits(
                {
                    name: "PBKDF2",
                    salt: BufferUtils.utf8Encode(salt),
                    iterations: iterations,
                    hash: {
                        name: algorithm
                    }
                },
                secret,
                length * 8
            )
            .then(function (bits) {
                resolve(new Uint8Array(bits));
            })
            .catch(function (err) {
                reject(err);
            });
        });
    }
}

module.exports = new Crypto();