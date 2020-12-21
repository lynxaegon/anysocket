const crypto = require("crypto");
module.exports = new (class Utils {
    uuidv4() {
        let rnd = crypto.randomBytes(16);
        rnd[6] = (rnd[6] & 0x0f) | 0x40;
        rnd[8] = (rnd[8] & 0x3f) | 0x80;
        rnd = rnd.toString("hex").match(/(.{8})(.{4})(.{4})(.{4})(.{12})/);
        rnd.shift();
        return rnd.join("-");
    }

    encrypt(msg, secret) {
        secret = this.deriveFromPassword(secret, 32);
        let iv = this.deriveFromPassword(secret, 16);

        let cipher = crypto.createCipheriv('aes-256-cbc', secret, iv);
        let crypted = cipher.update(msg,'utf8','hex');
        crypted += cipher.final('hex');
        return crypted;
    }


    decrypt(msg, secret) {
        secret = this.deriveFromPassword(secret, 32);
        let iv = this.deriveFromPassword(secret, 16);

        let decipher = crypto.createDecipheriv('aes-256-cbc', secret, iv);
        let dec = decipher.update(msg,'hex','utf8');
        dec += decipher.final('utf8');
        return dec;
    }

    deriveFromPassword(password, length) {
        const salt = (Math.floor((new Date()).getTime() / (1000 * 60))).toString();
        return crypto.pbkdf2Sync(password, salt, 500, length, "md5");
    }

    certificates(size) {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: size,  // the length of your key in bits
            publicKeyEncoding: {
                type: 'spki',       // recommended to be 'spki' by the Node.js docs
                format: 'pem'
            },
            privateKeyEncoding: {
                type: 'pkcs8',      // recommended to be 'pkcs8' by the Node.js docs
                format: 'pem'
            }
        });

        return {
            public: publicKey,
            private: privateKey
        }
    }

    encryptRSA(key, data) {
        const encryptedData = crypto.publicEncrypt({
                key: key,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: "sha256",
            },
            Buffer.from(data)
        );

        return encryptedData.toString("base64");
    }

    decryptRSA(key, data) {
        const decryptedData = crypto.privateDecrypt({
                key: key,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: "sha256",
            },
            Buffer.from(data, "base64")
        );

        return decryptedData.toString();
    }
})();