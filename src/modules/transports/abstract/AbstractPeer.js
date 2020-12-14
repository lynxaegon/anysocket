const EventEmitter = require('events');
const Utils = require("../../utils");
const _private = {
    inited: Symbol("inited"),
    keys: Symbol("keys"),
    events: Symbol("events"),
    authPacket: Symbol("authPacket")
};

const generateKeys = () => {
    return Utils.certificates(4096);
};

class AbstractPeer {
    constructor(socket) {
        this.id = "unknown";
        this.connectionID = Utils.uuidv4();
        this.connected = true;
        this.socket = socket;

        this[_private.keys] = {public: null, private: null};
        this[_private.events] = new EventEmitter();
        this[_private.inited] = false;
        this[_private.authPacket] = null;
    }

    init() {
        if(this[_private.inited])
            return;

        this[_private.inited] =  true;

        this.onConnect();
    }

    auth(message) {
        // disable function
        this.auth = null;

        if(!message.id) {
            this.disconnect("Invalid ID sent in auth process!");
            return;
        }

        this.id = message.id;
        this[_private.authPacket] = message;
        this[_private.events].emit("authed", this);
    }

    getAuthPacket() {
        return this[_private.authPacket];
    }

    hasE2EEnabled() {
        return this[_private.keys].public != null && this[_private.keys].private != null
    }

    setPublicKey(key) {
        // disable function
        this.setPublicKey = null;

        this[_private.keys].public = key;
    }

    getPublicKey() {
        if(!this.hasE2EEnabled()) {
            this[_private.keys] = generateKeys();
        }

        return this[_private.keys].public;
    }

    getPrivateKey() {
        if(!this.hasE2EEnabled()) {
            this[_private.keys] = generateKeys();
        }

        return this[_private.keys].private;
    }

    on(event, handler) {
        this[_private.events].on(event, handler);
    }

    off(event, handler) {
        this[_private.events].off(event, handler);
    }

    disconnect(reason) {
        if(this.connected) {
            this.onDisconnect();
            this[_private.events].emit("disconnected", this, reason);
            this.connected = false;
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
AbstractPeer._private = _private;
module.exports = AbstractPeer;