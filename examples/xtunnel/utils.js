const crypto = require("crypto");
module.exports = class Utils {
    static encrypt(msg, secret) {
        secret = this.deriveFromPassword(secret, 32);
        let iv = this.deriveFromPassword(secret, 16);

        let cipher = crypto.createCipheriv('aes-256-cbc', secret, iv);
        let crypted = cipher.update(msg,'utf8','hex');
        crypted += cipher.final('hex');
        return crypted;
    }


    static decrypt(msg, secret) {
        secret = this.deriveFromPassword(secret, 32);
        let iv = this.deriveFromPassword(secret, 16);

        let decipher = crypto.createDecipheriv('aes-256-cbc', secret, iv);
        let dec = decipher.update(msg,'hex','utf8');
        dec += decipher.final('utf8');
        return dec;
    }

    static deriveFromPassword(password, length) {
        const salt = (Math.floor((new Date()).getTime() / (1000 * 60))).toString();
        return crypto.pbkdf2Sync(password, salt, 500, length, "md5");
    }
};