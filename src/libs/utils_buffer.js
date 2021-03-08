module.exports = {
    bufferFromString(buf) {
        return Buffer.from(buf, 'binary');
    },
    bufferToString(buf) {
        return buf.toString('binary');
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