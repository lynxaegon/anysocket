class AnyPacker {
    packInt(int) {
        const arr = new ArrayBuffer(2);
        const view = new DataView(arr);
        view.setInt16(0, int, false);
        return String.fromCharCode.apply(String, new Uint8Array(arr));
    }

    unpackInt(bytes) {
        const arr = new ArrayBuffer(2);
        const bufView = new Uint8Array(arr);
        for (let i in bytes) {
            bufView[i] = bytes.charCodeAt(i);
        }
        const view = new DataView(arr);
        return view.getInt16(0);
    }

    packHex(hex) {
        let a = [];
        for (let i = 0, len = hex.length; i < len; i += 2) {
            a.push(parseInt(hex.substr(i, 2), 16));
        }

        return String.fromCharCode.apply(null, new Uint8Array(a));
    }

    unpackHex(bytes) {
        let hexStr = '';
        for (let i = 0; i < bytes.length; i++) {
            let hex = (bytes[i] & 0xff).toString(16);
            hex = (hex.length === 1) ? '0' + hex : hex;
            hexStr += hex;
        }
        return hexStr;
    }

    packBytes(bytes) {
        if(!(bytes instanceof ArrayBuffer || bytes instanceof Uint8Array))
            throw new Error("packBytes requires ArrayBuffer or UInt8Array");

        return String.fromCharCode.apply(null, new Uint8Array(bytes));
    }

    unpackBytes(bytes) {
        let buf = new ArrayBuffer(bytes.length);
        let bufView = new Uint8Array(buf);
        for (let i = 0, strLen = bytes.length; i < strLen; i++) {
            bufView[i] = bytes.charCodeAt(i);
        }

        return bufView;
    }
}

module.exports = new AnyPacker();