const crypto = require("crypto");
const BufferUtils = require("../wrappers/utils_buffer");

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
                public: BufferUtils.bufferToBase64(publicKey),
                nonce: BufferUtils.bufferToHex(crypto.randomBytes(32))
            });
        });
    }

    computeAESsecret(privateECDHKey, publicECDHKey) {
        return new Promise(async (resolve, reject) => {
            let result = await privateECDHKey.computeSecret(BufferUtils.bufferFromBase64(publicECDHKey), null, 'hex');
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
            try {
                let iv = crypto.randomBytes(16);
                let cipher = crypto.createCipheriv('aes-256-cbc', BufferUtils.bufferFromHex(secret), iv);
                let encrypted = cipher.update(data);
                encrypted = Buffer.concat([encrypted, cipher.final()]);
                let msg = iv.toString('hex') + encrypted.toString('hex');
                resolve(msg);
            }
            catch(e) {
                reject(e);
            }
        });
    }

    /**
     * Same cipher as encryptAES, over bytes and returning bytes (iv then
     * ciphertext) instead of a hex string. A 1.0 frame carries a byte payload,
     * so hex-encoding it would double every encrypted message for nothing.
     */
    encryptAESBytes(secret, bytes) {
        return new Promise((resolve, reject) => {
            try {
                const iv = crypto.randomBytes(16);
                const cipher = crypto.createCipheriv('aes-256-cbc', BufferUtils.bufferFromHex(secret), iv);
                resolve(new Uint8Array(Buffer.concat([iv, cipher.update(Buffer.from(bytes)), cipher.final()])));
            }
            catch(e) {
                reject(e);
            }
        });
    }

    decryptAESBytes(secret, bytes) {
        return new Promise((resolve, reject) => {
            try {
                const buf = Buffer.from(bytes);
                const decipher = crypto.createDecipheriv('aes-256-cbc', BufferUtils.bufferFromHex(secret), buf.subarray(0, 16));
                resolve(new Uint8Array(Buffer.concat([decipher.update(buf.subarray(16)), decipher.final()])));
            }
            catch(e) {
                reject(e);
            }
        });
    }

    decryptAES(secret, data) {
        return new Promise((resolve, reject) => {
            try {
                let iv = Buffer.from(data.substr(0, 32), 'hex');
                let encryptedText = Buffer.from(data.substr(32), 'hex');
                let decipher = crypto.createDecipheriv('aes-256-cbc', BufferUtils.bufferFromHex(secret), iv);
                let decrypted = decipher.update(encryptedText);
                decrypted = Buffer.concat([decrypted, decipher.final()]);
                resolve(decrypted.toString());
            }
            catch(e) {
                reject(e);
            }
        });
    }
})();