module.exports = {
    bufferFromString(str) {
        let buf = new ArrayBuffer(str.length);
        let bufView = new Uint8Array(buf);
        for (let i = 0, strLen = str.length; i < strLen; i++) {
            bufView[i] = str.charCodeAt(i);
        }
        return buf;
    },
    bufferFromBase64(buf) {
        return Uint8Array.from(window.atob(buf), c => c.charCodeAt(0));
    },
    bufferToString(buf) {
        let result = '';
        if (buf) {
            let bytes = new Uint8Array(buf);
            for (let i = 0; i < bytes.byteLength; i++) {
                result = result + String.fromCharCode(bytes[i]);
            }
        }
        return result;
    },
    bufferToBase64(buf) {
        let binary = '';
        let bytes = new Uint8Array(buf);
        let len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }
};