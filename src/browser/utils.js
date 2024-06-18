const crypto = require("./crypto");
const BufferUtils = require("./utils_buffer");

module.exports = new (class Utils {
    uuidv4() {
        return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    generateAESKey() {
        return new Promise(async (resolve, reject) => {
            let ecdh = await crypto.createECDH('secp521r1');
            let publicKey = await ecdh.generateKeys();
            resolve({
                private: ecdh,
                public: BufferUtils.bufferToString(publicKey),
                nonce: BufferUtils.bufferToHex(crypto.randomBytes(32))
            });
        });
    }

    computeAESsecret(privateECDHKey, publicECDHKey) {
        return new Promise(async (resolve, reject) => {
            let result = await privateECDHKey.computeSecret(BufferUtils.bufferFromString(publicECDHKey), null, 'hex');
            result = result.substr(0, 128);
            resolve(result);
        });
    }

    getAESSessionKey(secret, nonce, seq) {
        return new Promise(async (resolve, reject) => {
            nonce = nonce + "_" + seq;
            secret = await crypto.pbkdf2Sync(secret, nonce, 1, 32, 'sha256');
            secret = BufferUtils.bufferToHex(secret);
            resolve(secret);
        });
    }

    encryptAES(secret, data) {
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
    }

    decryptAES(secret, data) {
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
    }
})();