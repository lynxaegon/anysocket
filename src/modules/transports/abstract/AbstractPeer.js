const EventEmitter = require('events');
const Utils = require("../../../libs/utils");
const AbstractTransport = require("./AbstractTransport");

class AbstractPeer extends EventEmitter {
    constructor(socket) {
        super();

        this.connectionID = Utils.uuidv4();
        this.connected = true;
        this.socket = socket;
        this.type = AbstractTransport.TYPE.NONE;

        this.inited = false;
    }

    init() {
        if (this.inited)
            return;

        this.inited = true;

        this.onConnect();

        this.emit("connected", this);
    }

    isClient() {
        if(this.type == AbstractTransport.TYPE.NONE)
            throw new Error("Invalid transport type!!!");

        return this.type == AbstractTransport.TYPE.CLIENT;
    }

    disconnect(reason) {
        if (this.connected) {
            this.connected = false;
            this.onDisconnect();
            this.emit("disconnected", this, reason);
        }
    }

    send(message) {
        throw new Error('send() must be implemented');
    }

    onConnect() {
        throw new Error('onConnect() must be implemented');
    }

    onDisconnect() {
        throw new Error('onDisconnect() must be implemented');
    }
}

module.exports = AbstractPeer;