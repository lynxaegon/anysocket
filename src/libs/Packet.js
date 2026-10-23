const debug = require('debug')('Packet');
const AnyPacker = require("./AnyPacker");
const Frame = require("./Frame");
const constants = require("./_constants");

const getSeq = (buf) => {
    return AnyPacker.unpackInt32(buf.substr(2, 4));
};

const getType = (buf) => {
    return parseInt(buf.substr(1, 1));
};

const isBinaryPayload = (data) =>
    data instanceof Uint8Array ||
    data instanceof ArrayBuffer ||
    (typeof Buffer != "undefined" && Buffer.isBuffer(data));

const regex = {};
class Packet {
    constructor(data) {
        this.seq = 0;
        this.type = 0;
        this.buffer = [];
        this.data = null;
        this.parseError = false;
        // Set while reassembling a 1.0 message whose payload is raw bytes.
        this.binary = false;
        // Destination for a multi-chunk message that announced its size.
        this.assembled = null;
        this.assembledAt = 0;

        if (data)
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

    /**
     * Split the payload into transport-sized chunks.
     *
     * `protocolVersion` 1 produces binary frames; anything lower keeps the
     * legacy string format byte for byte, so a 0.4.x peer sees exactly what it
     * saw before.
     */
    async serialize(max_packet_size, encryptFnc, protocolVersion) {
        const chunks = [];
        for await (const chunk of this.chunks(max_packet_size, encryptFnc, protocolVersion)) {
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
    async *chunks(max_packet_size, encryptFnc, protocolVersion) {
        max_packet_size = max_packet_size || Number.MAX_SAFE_INTEGER;

        if (protocolVersion >= constants.PROTOCOL_VERSION) {
            yield* this._frameChunks(max_packet_size, encryptFnc);
            return;
        }

        const packet = JSON.stringify(this.data);
        const count = Math.max(1, Math.ceil(packet.length / max_packet_size));

        for (let i = 0, o = 0; i < count; ++i, o += max_packet_size) {
            yield await this.encode(
                (i == count - 1) ? constants.PACKET_LENGTH.FULL.toString() : constants.PACKET_LENGTH.PARTIAL.toString(),
                packet.substr(o, max_packet_size),
                encryptFnc
            );
        }
    }

    async *_frameChunks(max_packet_size, encryptFnc) {
        // Raw bytes travel as themselves. Everything else is JSON, as before —
        // but it is chunked by byte rather than by character, so a multi-byte
        // character can no longer be split across two chunks.
        const binary = isBinaryPayload(this.data);
        const payload = binary ? Frame.asBytes(this.data) : Frame.bytes(JSON.stringify(this.data));

        const count = Math.max(1, Math.ceil(payload.length / max_packet_size));

        for (let i = 0, o = 0; i < count; ++i, o += max_packet_size) {
            let slice = payload.subarray(o, o + max_packet_size);

            let flags = 0;
            if (i == count - 1) flags |= Frame.FLAGS.FINAL;
            if (binary) flags |= Frame.FLAGS.BINARY;
            if (this.seq < 0) flags |= Frame.FLAGS.REPLY;

            if (i == 0) {
                flags |= Frame.FLAGS.FIRST;
                // Tell the far side how much is coming, so it can allocate once
                // rather than hoarding chunks and joining them at the end.
                if (count > 1) {
                    const hint = new Uint8Array(Frame.LENGTH_HINT);
                    new DataView(hint.buffer).setUint32(0, payload.length, false);
                    slice = Frame.concat([hint, slice]);
                }
            }

            const body = await encryptFnc(slice, Math.abs(this.seq));
            if (body !== slice) flags |= Frame.FLAGS.ENCRYPTED;

            yield Frame.encode({
                flags: flags,
                type: this.type,
                seq: this.seq,
                payload: body
            });
        }
    }

    async encode(eol, packet, encryptFnc) {
        return eol +
            this.type.toString() +
            AnyPacker.packInt32(this.seq) +
            await encryptFnc(packet, Math.abs(this.seq))
    }

    /**
     * Feed one received chunk in. Resolves true once the message is whole.
     * Dispatches on what actually arrived rather than on the negotiated
     * version, so a frame is always read the way it was written.
     */
    async deserialize(buf, encryptionState, decryptFnc) {
        // Signature is (encryptionState, payload, seq) — the old default took
        // the payload first and so resolved to the state number, dropping the
        // payload entirely. Harmless in practice (callers always pass one in),
        // wrong for anyone decoding a frame on its own.
        decryptFnc = decryptFnc || ((state, packet) => Promise.resolve(packet));

        if (Frame.isFrame(buf)) {
            return this._deserializeFrame(buf, encryptionState, decryptFnc);
        }

        buf = Frame.legacyText(buf);
        const eol = buf.substr(0, 1) == constants.PACKET_LENGTH.FULL;
        this.type = getType(buf);
        this.seq = getSeq(buf);

        this.buffer.push(await decryptFnc(encryptionState, buf.substr(6), Math.abs(this.seq)));

        if (eol) {
            try {
                this.buffer = this.buffer.join("");
                let packet = JSON.parse(this.buffer);
                this.buffer = [];
                this.data = packet;
            }
            catch(e) {
                debug("packet parse error", e);
                // Flagged, not swallowed. The caller drops the connection
                // rather than dispatching a packet with data = null.
                this.buffer = [];
                this.data = null;
                this.parseError = true;
            }
            return true;
        }

        return false;
    }

    async _deserializeFrame(buf, encryptionState, decryptFnc) {
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

        let body = Frame.asBytes(
            await decryptFnc(encryptionState, frame.payload, Math.abs(this.seq))
        );

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

            this.assembled = new Uint8Array(total);
            this.assembledAt = 0;
        }

        let payload;
        if (this.assembled) {
            if (this.assembledAt + body.length > this.assembled.length) {
                // More arrived than the sender promised.
                this.parseError = true;
                this.assembled = null;
                return true;
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

        if (frame.binary) {
            this.data = payload;
            return true;
        }

        try {
            this.data = JSON.parse(Frame.text(payload));
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
        data = data || {};
        return new Packet(data);
    },
    buffer: () => {
        return new Packet();
    },
    getSeq: (buf) => {
        return Frame.isFrame(buf) ? Frame.getSeq(buf) : getSeq(Frame.legacyText(buf));
    },
    getType: (buf) => {
        return Frame.isFrame(buf) ? Frame.getType(buf) : getType(Frame.legacyText(buf));
    },
    isForwardPacket(buf) {
        return Frame.isFrame(buf)
            ? Frame.getType(buf) == constants.PACKET_TYPE.FORWARD
            : Frame.legacyText(buf).substr(0, 1) == constants.PACKET_TYPE.FORWARD;
    },
    isBinaryPayload,
    TYPE: constants.PACKET_TYPE
};
