const AnyPacker = require("./AnyPacker");
const constants = require("./_constants");

const getSeq = (buf) => {
    return AnyPacker.unpackInt32(buf.substr(2, 4));
};

const getType = (buf) => {
    return parseInt(buf.substr(1, 1));
};

const regex = {};
class Packet {
    constructor(data) {
        this.seq = 0;
        this.type = 0;
        this.buffer = [];
        this.data = null;

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

    async serialize(max_packet_size, encryptFnc) {
        max_packet_size = max_packet_size || Number.MAX_SAFE_INTEGER;
        let packet = JSON.stringify(this.data);
        const count = Math.ceil(packet.length / max_packet_size);
        const chunks = new Array(count);

        for (let i = 0, o = 0; i < count; ++i, o += max_packet_size) {
            chunks[i] = await this.encode(
                (i == count - 1) ? constants.PACKET_LENGTH.FULL.toString(): constants.PACKET_LENGTH.PARTIAL.toString(),
                packet.substr(o, max_packet_size),
                encryptFnc
            );
        }

        return chunks;
    }

    async encode(eol, packet, encryptFnc) {
        return eol +
            this.type.toString() +
            AnyPacker.packInt32(this.seq) +
            await encryptFnc(packet, Math.abs(this.seq))
    }

    async deserialize(buf, encryptionState, decryptFnc) {
        decryptFnc = decryptFnc || ((packet) => Promise.resolve(packet));
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
                // ignored
                this.data = null;
            }
            return true;
        }

        return false;
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
        return getSeq(buf);
    },
    getType: (buf) => {
        return getType(buf);
    },
    isForwardPacket(buf) {
        return buf.substr(0, 1) == constants.PACKET_TYPE.FORWARD;
    },
    TYPE: constants.PACKET_TYPE
};