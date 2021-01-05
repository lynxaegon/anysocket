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

    send(message) {
        return new Promise((resolve, reject) => {
            try {
               this.socket.forward({
                    to: this.id,
                    from: this.anysocketID,
                    msg: message
                });
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    }

    onDisconnect() {

    }
};