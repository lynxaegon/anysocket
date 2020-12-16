const WebSocket = require("ws");
const crypto = require("./crypto");
const nanoid = require("nanoid");
const EventEmitter = require("events");

class XTunnel extends EventEmitter {
    constructor(options) {
        super();

        this.STATE = XTunnel.STATE.CONNECTING;
        this.ws = new WebSocket('ws://'+ options.connectionString +'/');

        this.password = options.password || nanoid.customAlphabet("01234567890", 6)();
        if(!options.password) {
            console.log("Password:", this.password);
        }
        this.password += "";
        this.ws.on('open', () => {
            this.STATE = XTunnel.STATE.INITIATING;
            this._sendElo();
        });

        this.ws.on('close', () => {
            if(this.STATE == XTunnel.STATE.INITED) {
                this.STATE = XTunnel.STATE.DISCONNECTED;
                this.emit("disconnected");
            }
        });

        this.ws.on('message', (data) => {
            this._recvMsg(data);
        });
    }

    send(data) {
        let type;
        switch (this.STATE) {
            case XTunnel.STATE.CONNECTING:
            case XTunnel.STATE.DISCONNECTED:
                return false;

            case XTunnel.STATE.INITIATING:
                type = "0";
                break;

            case XTunnel.STATE.EXCHANGE_CERTIFICATE:
            case XTunnel.STATE.INITED:
                type = "1";
                break;
            default:
                return false;
        }

        data = this._encrypt(data);
        this.ws.send(type + data);

        return true;
    }

    _sendElo() {
        this.send("elo");
    }

    _recvMsg(data) {
        if(this.STATE == XTunnel.STATE.INITIATING && data == "ok") {
            // start exchanging certificates
            this._exchangeCertificates();
            return;
        }

        data = this._decrypt(data);
        if(!data)
            return;

        if(this.STATE == XTunnel.STATE.INITED) {
            if(data == "ok") {
                this.emit("connected");
                return;
            }

            this.emit("message", data);
        } else {
            this.encryptionKey = data;
            this.STATE = XTunnel.STATE.INITED;
            this.send("ok");
        }
    }

    _exchangeCertificates() {
        this.STATE = XTunnel.STATE.EXCHANGE_CERTIFICATE;
        if(!this.certificates) {
            this.certificates = crypto.certificates();
        }
        this.decriptionKey = this.certificates.private;
        this.send(this.certificates.public);
    }

    _decrypt(data) {
        if([XTunnel.STATE.INITIATING, XTunnel.STATE.EXCHANGE_CERTIFICATE].indexOf(this.STATE) != -1) {
            // encrypt using password
            data = JSON.parse(crypto.decrypt(data, this.password));
        } else if(this.STATE == XTunnel.STATE.INITED) {
            // we have certificate
            data = JSON.parse(crypto.decryptRSA(this.decriptionKey, data));
        }
        return data;
    }

    _encrypt(data) {
        if([XTunnel.STATE.INITIATING, XTunnel.STATE.EXCHANGE_CERTIFICATE].indexOf(this.STATE) != -1) {
            // encrypt using password
            data = crypto.encrypt(JSON.stringify(data), this.password);
        } else if(this.STATE == XTunnel.STATE.INITED) {
            // we have certificate
            data = crypto.encryptRSA(this.encryptionKey, JSON.stringify(data));
        }
        return data;
    }
}

XTunnel.STATE = {
    CONNECTING: 1,
    INITIATING: 2,
    EXCHANGE_CERTIFICATE: 3,
    INITED: 4,
    DISCONNECTED: 5
};
module.exports = XTunnel;