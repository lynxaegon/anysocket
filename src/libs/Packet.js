const AnyPacker = require("./AnyPacker");
const constants = require("./_constants");

const _private = {
    buffer: Symbol("buffer")
};

const getSeq = (buf) => {
    return AnyPacker.unpackInt16(buf.substr(2, 2));
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
        let packet = [JSON.stringify(this.data)];
        if (packet[0].length > max_packet_size) {
            regex[max_packet_size] = regex[max_packet_size] || new RegExp("(.{1," + max_packet_size + "})","g");
            packet = packet[0].match(regex[max_packet_size]);
        }

        for (let i = 0; i < packet.length; i++) {
            packet[i] =
                (i == packet.length - 1 ? constants.PACKET_LENGTH.FULL : constants.PACKET_LENGTH.PARTIAL).toString() +
                this.type.toString() +
                AnyPacker.packInt16(this.seq) +
                await encryptFnc(packet[i], Math.abs(this.seq))
        }

        return packet;
    }

    async deserialize(buf, decryptFnc) {
        decryptFnc = decryptFnc || ((packet) => Promise.resolve(packet));
        const eol = buf.substr(0, 1) == constants.PACKET_LENGTH.FULL;
        this.type = buf.substr(1, 1);
        this.seq = getSeq(buf);

        this.buffer.push(await decryptFnc(buf.substr(4), Math.abs(this.seq)));

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
    isForwardPacket(buf) {
        return buf.substr(0, 1) == constants.PACKET_TYPE.FORWARD;
    },
    TYPE: constants.PACKET_TYPE
};