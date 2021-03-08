const BufferUtils = require("./utils_buffer");

class AnyPacker {
    packInt16(int) {
        const arr = new ArrayBuffer(2);
        const view = new DataView(arr);
        view.setInt16(0, int, false);
        return String.fromCharCode.apply(String, new Uint8Array(arr));
    }

    unpackInt16(bytes) {
        const arr = new ArrayBuffer(2);
        const bufView = new Uint8Array(arr);
        for (let i in bytes) {
            bufView[i] = bytes.charCodeAt(i);
        }
        const view = new DataView(arr);
        return view.getInt16(0);
    }

    packHex(hex) {
        let str = '';
        for (let n = 0; n < hex.length; n += 2) {
            str += String.fromCharCode(parseInt(hex.substr(n, 2), 16));
        }
        return str;
    }

    unpackHex(bytes) {
        let str = '';
        for (let n = 0; n < bytes.length; n++) {
            let hex = Number(bytes.charCodeAt(n)).toString(16);
            str += (hex.length === 1) ? '0' + hex : hex;
        }
        return str;
    }

    packBytes(bytes) {
        if (!(bytes instanceof ArrayBuffer || bytes instanceof Uint8Array))
            throw new Error("packBytes requires ArrayBuffer or UInt8Array");

        return BufferUtils.bufferToString(bytes);
    }

    unpackBytes(bytes) {
        return BufferUtils.bufferFromString(bytes);
    }
}

module.exports = new AnyPacker();