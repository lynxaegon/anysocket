module.exports = {
    bufferFromString(buf) {
        return Buffer.from(buf);
    },
    bufferFromBase64(buf) {
        return Buffer.from(buf, "base64");
    }
};