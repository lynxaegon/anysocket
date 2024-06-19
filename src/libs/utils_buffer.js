module.exports = {
    bufferFromBase64: (str) => {
        return Buffer.from(str, 'base64');
    },
    bufferToBase64: (buf) => {
        return buf.toString('base64');
    },
    bufferToHex(buf) {
        return buf.toString('hex');
    },
    bufferFromHex(buf) {
        return Buffer.from(buf, 'hex');
    },
    isBuffer(buf) {
        return Buffer.isBuffer(buf);
    }
};