const AnyPacker = require("./AnyPacker");
const _private = {
    buffer: Symbol("buffer")
};
const PACKET_LENGTH = {
    FULL: 1,
    PARTIAL: 2
};
const TYPE = {
    AUTH: 1,
    INTERNAL: 2,
    LINK: 3,
    SWITCH: 4,
    HEARTBEAT: 5,
    FORWARD: 6,
    toString(number) {
        number = parseInt(number);
        for(let key in this) {
            if(typeof this[key] === 'number' && this[key] == number) {
                return key;
            }
        }

        return false;
    }
};

const getSeq = (buf) => {
    return AnyPacker.unpackInt(buf.substr(2, 2));
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
                (i == packet.length - 1 ? PACKET_LENGTH.FULL : PACKET_LENGTH.PARTIAL).toString() +
                this.type.toString() +
                AnyPacker.packInt(this.seq) +
                await encryptFnc(packet[i])
        }

        return packet;
    }

    async deserialize(buf, decryptFnc) {
        decryptFnc = decryptFnc || ((packet) => Promise.resolve(packet));
        const eol = buf.substr(0, 1) == PACKET_LENGTH.FULL;
        this.type = buf.substr(1, 1);
        this.seq = getSeq(buf);

        this.buffer.push(await decryptFnc(buf.substr(4)));

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
        return buf.substr(0, 1) == TYPE.FORWARD;
    },
    TYPE: TYPE
};