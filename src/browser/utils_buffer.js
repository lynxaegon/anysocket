module.exports = window._x = {
    stringToBuffer: function(str) {
        return btoa(str);
    },
    bufferFromBase64: function(str) {
        const bytes = atob(str);
        const byteLength = bytes.length;
        const buffer = new Uint8Array(byteLength);
        for (let i = 0; i < byteLength; i++) {
            buffer[i] = bytes.charCodeAt(i);
        }
        return buffer;
    },
    bufferToBase64: function(buf) {
        const uintArray = new Uint8Array(buf);
        const array = [];
        for (let i = 0; i < uintArray.length; i++) {
            array.push(String.fromCharCode(uintArray[i]));
        }
        return window.btoa(array.join(''));
    },
    // null and undefined are values like any other (an RPC argument or result), not bytes
    isBuffer(buf) {
        return !!(buf && buf.buffer instanceof ArrayBuffer && buf.BYTES_PER_ELEMENT);
    }
};