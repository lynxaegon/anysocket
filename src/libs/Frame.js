/**
 * The frame codec.
 *
 * A frame is a binary message with a fixed 6-byte header:
 *
 *   u8  flags
 *   u8  type
 *   u32 seq (big endian, always the absolute value — REPLY says what it means)
 *   ..  payload
 *
 * Everything is sent and received as frames; anything else drops the connection.
 *
 * Written against Uint8Array/DataView rather than Buffer, because this runs in
 * the browser build too.
 */

const FLAGS = {
    // Last (or only) chunk of a message.
    FINAL: 1,
    ENCRYPTED: 2,
    // Payload is raw bytes rather than JSON text.
    BINARY: 4,
    // First chunk of a message. When it is not also FINAL, the payload opens
    // with a 4-byte total length so the receiving side can allocate once
    // instead of collecting every chunk and joining them afterwards.
    FIRST: 16,
    // seq is a reply-to. A flag rather than a negative seq, which would cost a
    // bit of the range and could not be told from a decode slip.
    REPLY: 8
};

const HEADER_SIZE = 6;
// Width of the total-length hint carried by a multi-chunk message.
const LENGTH_HINT = 4;
// An anysocket id is a UUIDv4 — 32 hex characters, so 16 bytes on the wire.
const ID_BYTES = 16;
const MAX_SEQ = 0xffffffff;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const asBytes = (value) => {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (value && value.buffer instanceof ArrayBuffer) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    return encoder.encode(String(value));
};

// Base64 for the handshake, which travels as JSON. The shared buffer helpers
// mishandle a Uint8Array on node (toString ignores the encoding argument and
// yields "1,2,3"), and Buffer does not exist in the browser bundle at all.
const toBase64 = (bytes) => {
    const view = asBytes(bytes);
    if (typeof Buffer != "undefined") return Buffer.from(view).toString("base64");

    let binary = "";
    for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
    return btoa(binary);
};

const fromBase64 = (value) => {
    if (typeof Buffer != "undefined") return new Uint8Array(Buffer.from(value, "base64"));

    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
};

const concat = (parts) => {
    let total = 0;
    for (const part of parts) total += part.length;

    const out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }
    return out;
};

/**
 * Is what we received a frame?
 *
 * A frame starts with a flags byte, which only uses the low bits, so anything
 * starting at 0x30 or above is not one, and neither is a string, which is what
 * ws 7 hands over for a text message. Decided from the data, so it does not
 * rely on the transport telling text from binary, which tcp and ipc do not.
 */
const isFrame = (recv) => {
    if (typeof recv == "string") return false;

    const bytes = asBytes(recv);
    return bytes.length > 0 && bytes[0] < 0x30;
};

/**
 * An anysocket id as bytes. Ids are the library's own UUIDv4s, so this is
 * exact rather than a general string encoding; an application that replaces
 * the id with something of its own is outside what relaying addresses.
 */
const idToBytes = (id) => {
    const out = new Uint8Array(ID_BYTES);
    const hex = String(id || "");
    for (let i = 0; i < ID_BYTES; i++) {
        out[i] = parseInt(hex.substr(i * 2, 2), 16) || 0;
    }
    return out;
};

const idFromBytes = (bytes, at) => {
    let hex = "";
    for (let i = at; i < at + ID_BYTES; i++) {
        hex += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    }
    return hex;
};


/**
 * `payload` may be one buffer or a list of them. A list is written straight into
 * the frame one part after another, so a frame that spans a small prefix and a
 * slice of a large body costs one copy rather than a join followed by a copy.
 */
function encode(fields) {
    const parts = Array.isArray(fields.payload)
        ? fields.payload.map(asBytes)
        : [asBytes(fields.payload == null ? "" : fields.payload)];
    const seq = Math.abs(fields.seq || 0);
    if (seq > MAX_SEQ) throw new Error("seq out of range: " + seq);

    let length = 0;
    for (const part of parts) length += part.length;

    const out = new Uint8Array(HEADER_SIZE + length);
    out[0] = fields.flags & 0xff;
    out[1] = fields.type & 0xff;
    new DataView(out.buffer).setUint32(2, seq, false);

    let at = HEADER_SIZE;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }

    return out;
}

/**
 * The parts of `segments` (taken end to end) that fall in [start, end), as
 * views — nothing is copied.
 */
function range(segments, start, end) {
    const out = [];
    let at = 0;
    for (const segment of segments) {
        const from = at;
        const to = at + segment.length;
        at = to;
        if (to <= start) continue;
        if (from >= end) break;
        out.push(segment.subarray(Math.max(0, start - from), Math.min(segment.length, end - from)));
    }
    return out;
}

/**
 * Bytes as the platform's own type: a Buffer on node, so existing callers keep
 * .toString("utf8") and friends, and a plain Uint8Array in the browser. A view —
 * no copy either way.
 */
const native = (bytes) => (typeof Buffer != "undefined"
    ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : bytes);

const u32 = (value) => {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, value, false);
    return out;
};

function decode(recv) {
    const bytes = asBytes(recv);
    if (bytes.length < HEADER_SIZE) throw new Error("short frame: " + bytes.length + " bytes");

    const flags = bytes[0];
    const seq = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(2, false);

    return {
        flags: flags,
        type: bytes[1],
        // A reply is handed upwards as a negative seq, which is what everything
        // above the codec keys replies on.
        seq: (flags & FLAGS.REPLY) ? -seq : seq,
        payload: bytes.subarray(HEADER_SIZE),
        final: !!(flags & FLAGS.FINAL),
        encrypted: !!(flags & FLAGS.ENCRYPTED),
        binary: !!(flags & FLAGS.BINARY)
    };
}

/** The header fields, without copying the payload out. */
const getType = (recv) => asBytes(recv)[1];

const getSeq = (recv) => {
    const bytes = asBytes(recv);
    const seq = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(2, false);
    return (bytes[0] & FLAGS.REPLY) ? -seq : seq;
};

module.exports = {
    FLAGS,
    HEADER_SIZE,
    LENGTH_HINT,
    ID_BYTES,
    idToBytes,
    idFromBytes,
    MAX_SEQ,
    isFrame,
    encode,
    decode,
    range,
    native,
    u32,
    getType,
    getSeq,
    asBytes,
    concat,
    toBase64,
    fromBase64,
    text: (bytes) => decoder.decode(asBytes(bytes)),
    bytes: (text) => encoder.encode(text)
};
