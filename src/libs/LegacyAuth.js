/**
 * The old text format, as far as 1.1 still reads it: the first AUTH of a 1.0.x
 * dialler, which writes it as text because it does not yet know what the other
 * end speaks. Nothing else in the library knows this format, and 1.1 never
 * writes it. This module goes once no 1.0.x dialler is left;
 * AnyPeer.legacyHandshake() shows which connections still came in through it.
 *
 * The format: a 1-char end-of-message flag ("1" whole, "2" partial), a 1-char
 * type, a 4-char big-endian seq written one character per byte, then JSON.
 */

const Packet = require("./Packet");

const WHOLE = "1";
const AUTH = String(Packet.TYPE.AUTH);
const HEADER = 6;
const decoder = new TextDecoder();

const asText = (recv) => {
    if (typeof recv == "string") return recv;
    const bytes = recv instanceof Uint8Array ? recv : new Uint8Array(recv.buffer || recv, recv.byteOffset || 0, recv.byteLength);
    return decoder.decode(bytes);
};

const sizeOf = (recv) => (typeof recv == "string" ? recv.length : recv.byteLength);

/**
 * The AUTH packet in `recv`, or null. Only a whole AUTH within `cap` bytes is
 * read. Anything else — a partial packet, another type, a body that is not a
 * JSON object — is null, and the caller drops the connection, so nothing in this
 * format is ever reassembled.
 */
function read(recv, cap) {
    if (sizeOf(recv) > cap) return null;

    const text = asText(recv);
    if (text.length < HEADER || text[0] !== WHOLE || text[1] !== AUTH) return null;

    let data;
    try {
        data = JSON.parse(text.substr(HEADER));
    } catch (e) {
        return null;
    }
    if (!data || typeof data != "object" || Array.isArray(data)) return null;

    let seq = 0;
    for (let i = 2; i < HEADER; i++) seq = (seq << 8) | (text.charCodeAt(i) & 0xff);

    return Packet.data(data).setType(Packet.TYPE.AUTH).setSeq(seq);
}

module.exports = { read };
