const _send = Symbol("send function");
module.exports = class AnyPacket {
    constructor(peer, message, sendFnc) {
        this.peer = peer;
        this.seq = message.seq;
        this.data = message.data;
        this[_send] = sendFnc;
    }

    reply(data) {
        this[_send](data, this.seq);
    }
};