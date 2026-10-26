const debug = require('debug')('Packet');
const Frame = require("./Frame");
const constants = require("./_constants");

const isBinaryPayload = (data) =>
    data instanceof Uint8Array ||
    data instanceof ArrayBuffer ||
    (typeof Buffer != "undefined" && Buffer.isBuffer(data));

/**
 * Binary attachments carried beside a message's JSON body, keyed by a Symbol so
 * JSON.stringify never sees them. Set on an outgoing message to send bytes
 * without base64; present on a received message that carried any.
 */
const ATTACHMENTS = Symbol.for("anysocket.attachments");
// Segments singleFrame() built for a message too big for one frame, handed on to chunks().
const SEGMENTS = Symbol("segments");
// How much of an announced total is allocated before any of it has arrived.
const PREALLOCATE = 64 * 1024 * 1024;

const BODY_KIND = {
    RAW: 0,
    STRUCTURED: 1
};

/** The other end of Packet._segments(). */
function decodeBinaryBody(payload) {
    if (!payload.length) throw new Error("empty binary body");

    const kind = payload[0];
    if (kind === BODY_KIND.RAW) {
        return Frame.native(payload.subarray(1));
    }

    if (kind !== BODY_KIND.STRUCTURED) {
        throw new Error("unknown binary body kind " + kind);
    }

    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    let at = 1;
    const read32 = () => {
        if (at + 4 > payload.length) throw new Error("truncated binary body");
        const value = view.getUint32(at, false);
        at += 4;
        return value;
    };
    const take = (length) => {
        if (at + length > payload.length) throw new Error("truncated binary body");
        const out = payload.subarray(at, at + length);
        at += length;
        return out;
    };

    const data = JSON.parse(Frame.text(take(read32())));
    const count = read32();
    const attached = new Array(count);
    for (let i = 0; i < count; i++) {
        attached[i] = Frame.native(take(read32()));
    }

    if (data && typeof data == "object") {
        data[ATTACHMENTS] = attached;
    }
    return data;
}

class Packet {
    constructor(data) {
        this.seq = 0;
        this.type = 0;
        this.buffer = [];
        this.data = null;
        this.parseError = false;
        // Set while reassembling a message whose payload is raw bytes.
        this.binary = false;
        // Destination for a multi-chunk message that announced its size.
        this.assembled = null;
        this.assembledAt = 0;

        if (data !== undefined)
            this.data = data;
    }

    setType(type) {
        this.type = type;
        return this;
    }

    setSeq(seq) {
        this.seq = seq;
        return this;
    }

    setReplyTo(replyTo) {
        if(replyTo)
            this.seq = -replyTo;

        return this;
    }

    /** Split the payload into transport-sized frames. */
    async serialize(max_packet_size) {
        const chunks = [];
        for await (const chunk of this.chunks(max_packet_size)) {
            chunks.push(chunk);
        }
        return chunks;
    }

    /**
     * The chunks, produced one at a time.
     *
     * Materialising every chunk before sending any of them meant a copy of the
     * whole payload on top of the payload itself, which for a large transfer is
     * the difference between fitting in memory and not. The caller pulls these
     * as the wire drains.
     */
    async *chunks(max_packet_size) {
        yield* this._frameChunks(max_packet_size || Number.MAX_SAFE_INTEGER);
    }

    /**
     * The message as a list of byte segments, taken end to end. Nothing large is
     * joined — a raw payload stays the caller's own buffer.
     *
     *   raw bytes     BINARY, [KIND_RAW][bytes]
     *   attachments   BINARY, [KIND_STRUCTURED][u32 json][json][u32 n]([u32 len][bytes])*
     *   anything else plain JSON
     *
     * The kind lives in the payload rather than in another flag because every
     * flag bit left would let a header byte reach 0x30, where isFrame() stops
     * taking it for a frame.
     */
    _segments() {
        if (isBinaryPayload(this.data)) {
            return { binary: true, segments: [new Uint8Array([BODY_KIND.RAW]), Frame.asBytes(this.data)] };
        }

        const attached = this.data && this.data[ATTACHMENTS];
        if (attached && attached.length) {
            const json = Frame.bytes(JSON.stringify(this.data));
            const segments = [new Uint8Array([BODY_KIND.STRUCTURED]), Frame.u32(json.length), json, Frame.u32(attached.length)];
            for (const item of attached) {
                const bytes = Frame.asBytes(item);
                segments.push(Frame.u32(bytes.length), bytes);
            }
            return { binary: true, segments: segments };
        }

        return { binary: false, segments: [Frame.bytes(JSON.stringify(this.data))] };
    }

    /**
     * A message that fits in one frame, encoded at once; null when it needs
     * more than one. Most messages are this small, and producing them through
     * the async chunk generator cost more than encoding them. The bytes are what
     * chunks() would yield: a single frame carries no length hint.
     */
    singleFrame(max_packet_size) {
        const parts = this._segments();
        let total = 0;
        for (const segment of parts.segments) total += segment.length;
        if (total > max_packet_size) {
            this[SEGMENTS] = parts;   // spared from being built twice by chunks()
            return null;
        }

        let flags = Frame.FLAGS.FIRST | Frame.FLAGS.FINAL;
        if (parts.binary) flags |= Frame.FLAGS.BINARY;
        if (this.seq < 0) flags |= Frame.FLAGS.REPLY;
        return Frame.encode({ flags: flags, type: this.type, seq: this.seq, payload: parts.segments });
    }

    async *_frameChunks(max_packet_size) {
        // Chunked by byte rather than by character, so a multi-byte character
        // can no longer be split across two chunks. Encryption does not happen
        // here: whole frames are sealed in wire order on the way out (see
        // AnyProtocol._sealFrame).
        const { binary, segments } = this[SEGMENTS] || this._segments();
        this[SEGMENTS] = null;

        let total = 0;
        for (const segment of segments) total += segment.length;
        const count = Math.max(1, Math.ceil(total / max_packet_size));

        for (let i = 0, o = 0; i < count; ++i, o += max_packet_size) {
            const parts = Frame.range(segments, o, Math.min(total, o + max_packet_size));

            let flags = 0;
            if (i == count - 1) flags |= Frame.FLAGS.FINAL;
            if (binary) flags |= Frame.FLAGS.BINARY;
            if (this.seq < 0) flags |= Frame.FLAGS.REPLY;

            if (i == 0) {
                flags |= Frame.FLAGS.FIRST;
                // Tell the far side how much is coming, so it can allocate once
                // rather than hoarding chunks and joining them at the end.
                if (count > 1) parts.unshift(Frame.u32(total));
            }

            yield Frame.encode({
                flags: flags,
                type: this.type,
                seq: this.seq,
                payload: parts
            });
        }
    }

    /**
     * Feed one received frame in. Resolves true once the message is whole.
     * Anything that is not a frame is flagged, never read.
     */
    async deserialize(buf) {
        if (!Frame.isFrame(buf)) {
            this.parseError = true;
            return true;
        }

        let frame;
        try {
            frame = Frame.decode(buf);
        } catch (e) {
            debug("frame decode error", e);
            this.parseError = true;
            return true;
        }

        this.type = frame.type;
        this.seq = frame.seq;
        this.binary = frame.binary;

        // Already opened, when it was sealed: see AnyProtocol._openFrame.
        let body = frame.payload;

        // A multi-chunk message says up front how big it is, so the whole thing
        // is allocated once and each chunk copied straight into place. Before,
        // every chunk was kept and then joined, which meant holding the payload
        // twice at the moment it completed.
        if ((frame.flags & Frame.FLAGS.FIRST) && !frame.final) {
            if (body.length < Frame.LENGTH_HINT) {
                this.parseError = true;
                return true;
            }

            const total = new DataView(body.buffer, body.byteOffset, body.byteLength)
                .getUint32(0, false);
            body = body.subarray(Frame.LENGTH_HINT);

            // The total is the sender's word, so it is held to the same cap as
            // the bytes themselves before anything is allocated for it — or an
            // 11-byte frame could have us reserve 4GB.
            const cap = this.maxTotal == null ? Infinity : this.maxTotal;
            if (total > cap) {
                this.parseError = true;
                return true;
            }

            // Allocated up to a point, then grown as the bytes actually arrive: with no
            // cap, a total alone would otherwise reserve up to 4GB.
            try {
                this.assembled = new Uint8Array(Math.min(total, PREALLOCATE));
            } catch (e) {
                this.parseError = true;
                return true;
            }
            this.assembledTotal = total;
            this.assembledAt = 0;
        }

        let payload;
        if (this.assembled) {
            const needed = this.assembledAt + body.length;
            if (needed > this.assembledTotal) {
                // More arrived than the sender promised.
                this.parseError = true;
                this.assembled = null;
                return true;
            }
            if (needed > this.assembled.length) {
                let grown;
                try {
                    grown = new Uint8Array(Math.min(this.assembledTotal, Math.max(needed, this.assembled.length * 2)));
                } catch (e) {
                    this.parseError = true;
                    this.assembled = null;
                    return true;
                }
                grown.set(this.assembled.subarray(0, this.assembledAt));
                this.assembled = grown;
            }

            this.assembled.set(body, this.assembledAt);
            this.assembledAt += body.length;

            if (!frame.final) return false;

            payload = this.assembledAt == this.assembled.length
                ? this.assembled
                : this.assembled.subarray(0, this.assembledAt);
            this.assembled = null;
        } else {
            if (!frame.final) {
                // No hint: a sender that chunked without announcing a total.
                this.buffer.push(body);
                return false;
            }
            payload = this.buffer.length ? Frame.concat(this.buffer.concat([body])) : body;
            this.buffer = [];
        }

        try {
            this.data = frame.binary ? decodeBinaryBody(payload) : JSON.parse(Frame.text(payload));
        } catch (e) {
            debug("packet parse error", e);
            this.data = null;
            this.parseError = true;
        }

        return true;
    }
}

module.exports = {
    data: (data) => {
        // Only a missing message becomes {}: send(0), send(false) and send("") used
        // to arrive as {} too.
        return new Packet(data === undefined ? {} : data);
    },
    buffer: () => {
        return new Packet();
    },
    // The header fields of a frame; null for anything that is not one.
    getSeq: (buf) => {
        return Frame.isFrame(buf) ? Frame.getSeq(buf) : null;
    },
    getType: (buf) => {
        return Frame.isFrame(buf) ? Frame.getType(buf) : null;
    },
    isForwardPacket(buf) {
        return Frame.isFrame(buf) && Frame.getType(buf) == constants.PACKET_TYPE.FORWARD;
    },
    isBinaryPayload,
    ATTACHMENTS,
    TYPE: constants.PACKET_TYPE
};
