module.exports = {
    utf8Encode(string) {
        let bytes = [];
        let length = string.length;
        let i = 0;
        while (i < length) {
            let codePoint = string.codePointAt(i);
            let c = 0;
            let bits = 0;
            if (codePoint <= 0x0000007F) {
                c = 0;
                bits = 0x00;
            } else if (codePoint <= 0x000007FF) {
                c = 6;
                bits = 0xC0;
            } else if (codePoint <= 0x0000FFFF) {
                c = 12;
                bits = 0xE0;
            } else if (codePoint <= 0x001FFFFF) {
                c = 18;
                bits = 0xF0;
            }
            bytes.push(bits | (codePoint >> c));
            c -= 6;
            while (c >= 0) {
                bytes.push(0x80 | ((codePoint >> c) & 0x3F));
                c -= 6;
            }
            i += codePoint >= 0x10000 ? 2 : 1;
        }
        return new Uint8Array(bytes);
    },
    bufferFromString(str) {
        let buf = new ArrayBuffer(str.length);
        let bufView = new Uint8Array(buf);
        for (let i = 0, strLen = str.length; i < strLen; i++) {
            bufView[i] = str.charCodeAt(i);
        }
        return buf;
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
    }
};