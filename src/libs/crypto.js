const crypto = require('crypto');

function encrypt(msg, secret) {
    secret = deriveFromPassword(secret, 32);
    let iv = deriveFromPassword(secret, 16);

    let cipher = crypto.createCipheriv('aes-256-cbc', secret, iv);
    let crypted = cipher.update(msg,'utf8','hex');
    crypted += cipher.final('hex');
    return crypted;
}


function decrypt(msg, secret) {
    secret = deriveFromPassword(secret, 32);
    let iv = deriveFromPassword(secret, 16);

    let decipher = crypto.createDecipheriv('aes-256-cbc', secret, iv);
    let dec = decipher.update(msg,'hex','utf8');
    dec += decipher.final('utf8');
    return dec;
}

function deriveFromPassword(password, length) {
    const salt = (Math.floor((new Date()).getTime() / (1000 * 60))).toString();
    return crypto.pbkdf2Sync(password, salt, 500, length, "md5");
}

function certificates() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 4096,  // the length of your key in bits
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

function encryptRSA(key, data) {
    const encryptedData = crypto.publicEncrypt({
            key: key,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: "sha256",
        },
        Buffer.from(data)
    );

    return encryptedData.toString("base64");
}

function decryptRSA(key, data) {
    const decryptedData = crypto.privateDecrypt({
            key: key,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: "sha256",
        },
        Buffer.from(data, "base64")
    );

    return decryptedData.toString();
}

module.exports = { decrypt, encrypt, certificates, decryptRSA, encryptRSA };