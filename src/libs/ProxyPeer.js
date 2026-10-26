const AbstractPeer = require("../modules/transports/abstract/AbstractPeer");
const AbstractTransport = require("../modules/transports/abstract/AbstractTransport");

module.exports = class ProxyPeer extends AbstractPeer {
    constructor(isClient, anysocketID, peerID, socket) {
        super(socket);

        this.id = peerID;
        this.anysocketID = anysocketID;
        this.type = isClient ? AbstractTransport.TYPE.CLIENT : AbstractTransport.TYPE.SERVER;
        this.isProxy = true;
        this.init();
    }

    onConnect() {

    }

    /**
     * Settles when the relay connection has the frame, so a relayed send waits on it
     * and fails with it. It used to resolve at once, leaving the relay connection's
     * own promise to reject with no one handling it.
     */
    send(message) {
        try {
            return this.socket.forward({
                to: this.id,
                from: this.anysocketID,
                msg: message
            });
        } catch (e) {
            return Promise.reject(e);
        }
    }

    onDisconnect() {

    }
};