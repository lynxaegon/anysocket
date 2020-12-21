const EventEmitter = require('events');
const Utils = require("../../../libs/utils");
const AbstractTransport = require("./AbstractTransport");

const generateKeys = () => {
    return Utils.certificates(4096);
};

class AbstractPeer extends EventEmitter {
    constructor(socket) {
        super();

        this.connectionID = Utils.uuidv4();
        this.connected = true;
        this.socket = socket;
        this.type = AbstractTransport.TYPE.NONE;

        this.keys = {public: null, private: null};
        this.inited = false;
    }

    init() {
        if (this.inited)
            return;

        this.inited = true;

        this.onConnect();
    }

    isClient() {
        if(this.type == AbstractTransport.TYPE.NONE)
            throw new Error("Invalid transport type!!!");

        return this.type == AbstractTransport.TYPE.CLIENT;
    }

    hasE2EEnabled() {
        return this.keys.public != null && this.keys.private != null
    }

    setPublicKey(key) {
        // disable function
        this.setPublicKey = null;

        this.keys.public = key;
    }

    getPublicKey() {
        if(!this.hasE2EEnabled()) {
            this.keys = generateKeys();
        }

        return this.keys.public;
    }

    getPrivateKey() {
        if(!this.hasE2EEnabled()) {
            this.keys = generateKeys();
        }

        return this.keys.private;
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