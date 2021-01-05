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

    combine(packet) {
        this.buffer = this.buffer.concat(packet.buffer);
        return this;
    }

    serialize(max_packet_size, encryptFnc) {
        let data = {
            _: this.seq.toString(),
            d: this.data
        };

        max_packet_size = max_packet_size || Number.MAX_SAFE_INTEGER;
        let packet = [JSON.stringify(data)];
        if (packet[0].length > max_packet_size) {
            regex[max_packet_size] = regex[max_packet_size] || new RegExp("(.{1," + max_packet_size + "})","g");
            packet = packet[0].match(regex[max_packet_size]);
        }

        for (let i = 0; i < packet.length; i++) {
            packet[i] =
                (i == packet.length - 1 ? PACKET_LENGTH.FULL : PACKET_LENGTH.PARTIAL).toString() +
                this.type.toString() +
                encryptFnc(packet[i])
        }

        return packet;
    }

    deserialize(buf, decryptFnc) {
        decryptFnc = decryptFnc || ((packet) => packet);

        const eol = buf.substr(0, 1) == PACKET_LENGTH.FULL;
        this.type = buf.substr(1, 1);

        this.buffer.push(decryptFnc(buf.substr(2)));

        if (eol) {
            this.buffer = this.buffer.join("");
            let packet = JSON.parse(this.buffer);
            this.buffer = false;
            this.seq = packet._;
            this.data = packet.d;

            return true;
        }

        return false;
    }

    isForwardPacket(buf) {
        if(buf.substr(0,1) == TYPE.FORWARD) {
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
    TYPE: TYPE
};