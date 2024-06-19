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
    bufferToHex(buf) {
        return buf.reduce((memo, i) => {return memo + this.i2hex(i)}, '');
    },
    i2hex(i) {
        return ('0' + i.toString(16)).slice(-2);
    },
    bufferFromHex(buf) {
        let view = new Uint8Array(buf.length / 2);

        for (let i = 0; i < buf.length; i += 2) {
            view[i / 2] = parseInt(buf.substring(i, i + 2), 16);
        }

        return view;
    },
};