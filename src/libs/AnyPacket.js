const debug = require('debug')('AnyPacket');
const _send = Symbol("send function");
module.exports = class AnyPacket {
    constructor(peer, message, sendFnc) {
        this.peer = peer;
        this.seq = message.seq;
        this.msg = message.data;
        this[_send] = sendFnc;
    }

    reply(data) {
        this[_send](data, this.seq);
    }
};