// A Buffer is a Uint8Array, but a plain Uint8Array is not a Buffer: calling
// toString("base64") on one ignores the encoding and returns "1,2,3". So turn
// anything byte-shaped into a Buffer view first. No copy for a view.
const asBuffer = (buf) => {
    if (Buffer.isBuffer(buf)) return buf;
    if (buf instanceof ArrayBuffer) return Buffer.from(buf);
    if (ArrayBuffer.isView(buf)) return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    return Buffer.from(buf);
};

module.exports = {
    bufferFromBase64: (str) => {
        return Buffer.from(str, 'base64');
    },
    bufferToBase64: (buf) => {
        return asBuffer(buf).toString('base64');
    },
    // Any bytes, not only a Buffer — matching what the browser build accepts.
    // A plain Uint8Array RPC argument used to slip past this on node and go
    // through JSON as {"0":9,"1":8}.
    isBuffer(buf) {
        return Buffer.isBuffer(buf) || buf instanceof ArrayBuffer || (ArrayBuffer.isView(buf) && !(buf instanceof DataView));
    }
};
