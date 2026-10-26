const BufferUtils = require("../wrappers/utils_buffer");

/**
 * Bytes as base64 text and back: what AnySocket.Packer exposes. Deprecated, and
 * kept only so code calling it keeps working; bytes travel as bytes without it.
 */
class AnyPacker {
    packBytes(bytes) {
        if(bytes == null) {
            return null;
        }
        if (!(bytes instanceof ArrayBuffer || bytes instanceof Uint8Array))
            throw new Error("packBytes requires ArrayBuffer or UInt8Array");

        return BufferUtils.bufferToBase64(bytes);
    }

    unpackBytes(bytes) {
        if(bytes == null) {
            return null;
        }
        return BufferUtils.bufferFromBase64(bytes);
    }
}

module.exports = new AnyPacker();