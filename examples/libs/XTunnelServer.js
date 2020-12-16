const WebSocket = require("ws");
const EventEmitter = require("events");
const nanoid = require("nanoid");

class XTunnelServer extends EventEmitter {
    constructor(port) {
        super();
        this.clients = {};
        this.eloClients = {};
        this.ws = new WebSocket.Server({port: port});

        this.ws.on('connection', (client) => {
            client.id = nanoid.customAlphabet("abcdefghijklmnopqrstuvwxyz", 6)();
            console.log("Connected", client.id);

            client.on('message', (data) => {
                if(data.length < 2) {
                    console.error("invalid data packet!");
                    return;
                }
                this._recvMsg(client, data.substr(0,1), data.substr(1));
            });

            client.on("close", () => {
                console.log("Disconnected", client.id);
                let other = this.clients[client.id];
                delete this.clients[client.id];
                delete this.eloClients[client.id];

                if(other) {
                    delete this.clients[other.id];
                    other.close();
                }
            });
        });
    }

    _recvMsg(client, type, data) {
        switch (type) {
            case "0":
                this._handleElo(client, data);
                break;
            case "1":
                this._handleMsg(client, data);
                break;
            default:
                console.log("UNKNOWN", data);
        }
    }

    _handleElo(client, data) {
        console.log("ELO:", data);
        let found = false;
        for(let c in this.eloClients) {
            if(this.eloClients[c].data == data) {
                found = this.eloClients[c].client;
                delete this.eloClients[c];
                break;
            }
        }
        if(found) {
            this.clients[found.id] = client;
            this.clients[client.id] = found;

            this._notify(found, client);
        } else {
            this.eloClients[client.id] = {
                client: client,
                data: data
            }
        }
    }

    _handleMsg(client, data) {
        this.clients[client.id].send(data);
    }

    _notify(client1, client2) {
        console.log("Matched", client1.id, client2.id);
        // tell them to exchange certificates safely
        client1.send("ok");
        client2.send("ok");
    }
}

module.exports = XTunnelServer;