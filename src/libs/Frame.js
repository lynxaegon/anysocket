/**
 * The 1.0 frame codec.
 *
 * Legacy frames are JS strings sent as WebSocket text messages, with the header
 * written as characters and every payload forced through JSON — so bytes cost
 * a base64 detour and encrypted payloads, which are hex, cost double. A 1.0
 * frame is a binary message with a fixed 6-byte header:
 *
 *   u8  flags
 *   u8  type
 *   u32 seq (big endian, always the absolute value — REPLY says what it means)
 *   ..  payload
 *
 * Only used once both ends announce protocol version 1 (see AnyProtocol's
 * negotiation), so a 0.4.x peer never receives one.
 *
 * Written against Uint8Array/DataView rather than Buffer, because this runs in
 * the browser build too.
 */

const FLAGS = {
    // Last (or only) chunk of a message; the legacy format spelled this "eol".
    FINAL: 1,
    ENCRYPTED: 2,
    // Payload is raw bytes rather than JSON text.
    BINARY: 4,
    // First chunk of a message. When it is not also FINAL, the payload opens
    // with a 4-byte total length so the receiving side can allocate once
    // instead of collecting every chunk and joining them afterwards.
    FIRST: 16,
    // seq is a reply-to. The legacy format negated the seq to mean this, which
    // cost a bit of the range and could not be told from a decode slip.
    REPLY: 8
};

const HEADER_SIZE = 6;
// Width of the total-length hint carried by a multi-chunk message.
const LENGTH_HINT = 4;
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
 * Is what we received a 1.0 frame rather than a legacy one?
 *
 * Decided from the data, not from the negotiated version, so a frame is always
 * read the way it was written. A legacy frame starts with the ASCII digit "1"
 * or "2" (0x31/0x32); a 1.0 frame starts with a flags byte, which only uses the
 * low bits. That keeps the two apart even when the transport hands us bytes
 * for both — ws 7 gives a string for a text message, ws 8 a Buffer — and it
 * does not rely on the transport distinguishing text from binary at all,
 * which tcp, udp and ipc do not.
 */
const isFrame = (recv) => {
    if (typeof recv == "string") return false;

    const bytes = asBytes(recv);
    return bytes.length > 0 && bytes[0] < 0x30;
};

/** A legacy frame as the string the legacy codec expects. */
const legacyText = (recv) => (typeof recv == "string" ? recv : decoder.decode(asBytes(recv)));

function encode(fields) {
    const payload = asBytes(fields.payload == null ? "" : fields.payload);
    const seq = Math.abs(fields.seq || 0);
    if (seq > MAX_SEQ) throw new Error("seq out of range: " + seq);

    const out = new Uint8Array(HEADER_SIZE + payload.length);
    out[0] = fields.flags & 0xff;
    out[1] = fields.type & 0xff;
    new DataView(out.buffer).setUint32(2, seq, false);
    out.set(payload, HEADER_SIZE);

    return out;
}

function decode(recv) {
    const bytes = asBytes(recv);
    if (bytes.length < HEADER_SIZE) throw new Error("short frame: " + bytes.length + " bytes");

    const flags = bytes[0];
    const seq = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(2, false);

    return {
        flags: flags,
        type: bytes[1],
        // Restores the legacy meaning of a negative seq, so nothing above the
        // codec has to care which format a packet arrived in.
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
    MAX_SEQ,
    isFrame,
    legacyText,
    encode,
    decode,
    getType,
    getSeq,
    asBytes,
    concat,
    toBase64,
    fromBase64,
    text: (bytes) => decoder.decode(asBytes(bytes)),
    bytes: (text) => encoder.encode(text)
};
