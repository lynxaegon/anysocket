# AnySocket
An abstract networking layer over multiple transports, agnostic of client/server with support for E2E

[![Dependency Status](https://david-dm.org/lynxaegon/anysocket.svg)](https://david-dm.org/lynxaegon/anysocket.svg)
[![devDependency Status](https://david-dm.org/lynxaegon/anysocket/dev-status.svg)](https://david-dm.org/lynxaegon/anysocket#info=devDependencies)
[![NPM version](https://badge.fury.io/js/anysocket.svg)](https://www.npmjs.com/package/anysocket)
![Downloads](https://img.shields.io/npm/dm/anysocket.svg?style=flat)


* <a href="#features">Features</a>
* <a href="#installation">Installation</a>
* <a href="#usage">Usage</a>
* <a href="#api">API</a>
* <a href="#future">Upcoming Features</a>
* <a href="#license">License</a>

#### Important

This is a work in progress and API is subject to change.

_WIP Documentation_

<a name="features"></a>
## Features
* Client / Server agnostic
* Support for request/reply
* Multiple transports *(implemented: **ws**)
* All peers have a UUIDv4 associated
* E2E implemented in the protocol
* Disconnect detection using a heartbeat
* Automatic packet splitting, if packet is too large (atm: fixed 4kb packet size)
* **Not Battle Tested** ...yet

_It doesn't support Binary Protocol_ ...yet

<a name="installation"></a>
## Installation

```javascript
npm install --save anysocket
```


<a name="usage"></a>
## How to use
The following example starts a websocket server on port 3000.
```javascript
const AnySocket = require("anysocket");
const server = new AnySocket();
const PORT = 3000;
server.listen("ws", PORT)
    .then(() => {
        console.log("Listening on port:", PORT);
    })
    .catch((err) => {
        console.error("Failed to start server:", err);
    });
server.on("connected", (peer) => {
    console.log("Connected", peer.id);    
    peer.send({
        hello: "world"
    });
});
server.on("message", (packet) => {
    console.log("From:", packet.peer.id, "Message:", packet.data);
});
server.on("disconnected", (peer, reason) => {
    console.log("Disconnected", peer.id, "Reason:", reason);
});
```

The following example connects to a websocket on port 3000
```javascript
const AnySocket = require("anysocket");
const client = new AnySocket();
const PORT = 3000;
client.connect("ws", "127.0.0.1", PORT)
    .then(() => {
        // note: you cannot send messages from here, you need to wait for the "connected" event
        console.log("Connected to server");
    })
    .catch((err) => {
        console.error("Failed to connect to server:", err);
    });

// after negotiating the AUTH packet, it will trigger the connect event
client.on("connected", (peer) => {
    console.log("Connected", peer.id);    
    peer.send({
        hello: "world"
    });
});
client.on("message", (packet) => {
    console.log("From:", packet.peer.id, "Message:", packet.data);
});
client.on("disconnected", (peer, reason) => {
    console.log("Disconnected", peer.id, "Reason:", reason);
});
```
More in the `examples` folder.

<a name="api"></a>
## Api
* <a href="#AnySocket.constructor"><code><b>AnySocket()</b></code></a>
    * <a href="#AnySocket.id"><code><b>id</b></code></a>
    * <a href="#AnySocket.server"><code><b>server()</b></code></a>
    * <a href="#AnySocket.listen"><code><b>listen()</b></code></a>
    * <a href="#AnySocket.connect"><code><b>connect()</b></code></a>
    * <a href="#AnySocket.stop"><code><b>stop()</b></code></a>
    * <a href="#AnySocket.send"><code><b>send()</b></code></a>
    * <a href="#AnySocket.on.connected"><code><b>event: _connected_</b></code></a>
    * <a href="#AnySocket.on.message"><code><b>event: _message_</b></code></a>
    * <a href="#AnySocket.on.e2e"><code><b>event: _e2e_</b></code></a>
    * <a href="#AnySocket.on.heartbeat"><code><b>event: _heartbeat_</b></code></a>
    * <a href="#AnySocket.on.disconnected"><code><b>event: _disconnected_</b></code></a>
* <a href="#AnyPacket.constructor"><code><b>AnyPacket()</b></code></a>
    * <a href="#AnyPacket.seq"><code><b>seq</b></code></a>
    * <a href="#AnyPacket.peer"><code><b>peer</b></code></a>
    * <a href="#AnyPacket.msg"><code><b>msg</b></code></a>
    * <a href="#AnyPacket.reply"><code><b>reply()</b></code></a>
* <a href="#AnyPeer.constructor"><code><b>AnyPeer()</b></code></a>
    * <a href="#AnyPeer.id"><code><b>id</b></code></a>
    * <a href="#AnyPeer.lag"><code><b>lag</b></code></a>
    * <a href="#AnyPeer.connectionID"><code><b>connectionID</b></code></a>
    * <a href="#AnyPeer.e2e"><code><b>e2e()</b></code></a>
    * <a href="#AnyPeer.send"><code><b>send()</b></code></a>
    * <a href="#AnyPeer.disconnect"><code><b>disconnect()</b></code></a>
    * <a href="#AnyPeer.heartbeat"><code><b>heartbeat()</b></code></a> - deprecated, will be moved
    * <a href="#AnyPeer.on.message"><code><b>event: _message_</b></code></a>
    * <a href="#AnyPeer.on.e2e"><code><b>event: _e2e_</b></code></a>
    * <a href="#AnyPeer.on.heartbeat"><code><b>event: _heartbeat_</b></code></a>
    * <a href="#AnyPeer.on.disconnected"><code><b>event: _disconnected_</b></code></a>
## Documentation
<a name="AnySocket.constructor"></a>
### AnySocket()

Creates a new AnySocket instance

-------------------------------------------------------
<a name="anysocket.id"></a>
### AnySocket.id

Unique identifier (UUIDv4) that will be used for all connections originating this instance (client/server)

-------------------------------------------------------
<a name="AnySocket.server"></a>
### AnySocket.server(scheme, options)

Alias for <a href="#AnySocket.listen">AnySocket.listen()</a>

-------------------------------------------------------
<a name="AnySocket.listen"></a>
### AnySocket.listen(scheme, options)

Attaches a new server transport based on the selected **scheme*

**Arguments:**
* `scheme` - one of the implemented transports
* `options` - one of the options below
    * `port` - a number consistingi of the PORT
    * `json` 
```
{
    ip: "0.0.0.0", // listening ip
    port: 3000, // listening port
    replyTimeout: 30 * 1000, // reply timeout
    heartbeatInterval: 5 * 1000, // heartbeat interval
    heartbeatTimeout: 5 * 1000 // heartbeat timeout (disconnect)
}
```

**Returns** a Promise that resolves/rejects when the server has started listening or when it throws an error

-------------------------------------------------------
<a name="AnySocket.connect"></a>
### AnySocket.connect(scheme, ip, port, [options])

Connects to AnySocket Server

**Arguments:**
* `scheme` - one of the implemented transports
* `ip` - server ip
* `port` - server port
* `options` - options json
```
{
    replyTimeout: 30 * 1000, // reply timeout
    heartbeatInterval: 5 * 1000, // heartbeat interval
    heartbeatTimeout: 5 * 1000 // heartbeat timeout (disconnect)
}
```

**Returns** a Promise that resolves/rejects when a connection has been established
_note: you cannot take actions (ex: send) until the `connected` event has been triggered_

-------------------------------------------------------
<a name="AnySocket.stop"></a>
### AnySocket.stop()

Stops all servers and disconnects all peers

**Returns** a Promise that resolves/rejects when finished

-------------------------------------------------------
<a name="AnySocket.send"></a>
### AnySocket.send(message, awaitReply)

Sends a message to all connected peers

**Arguments:**
* `message` - a JSON stringifiable object
* `awaitReply` - set to true if a reply is expected

**Returns** a Promise that resolves with a <a href="#AnyPacket">AnyPacket</a> if waiting for a reply or rejects on error

_note: it doesn't resolve if awaitReply is not set_ 

-------------------------------------------------------
<a name="AnySocket.on.connected"></a>
### AnySocket event `connected`

Emitted when the link has been established and it's ready for sending/receiving messages

**Arguments:**
* `peer` - <a href="#AnyPeer">AnyPeer</a> instance

-------------------------------------------------------
<a name="AnySocket.on.message"></a>
### AnySocket event `message`

Emitted when a message is received

**Arguments:**
* `packet` - <a href="#AnyPacket">AnyPacket</a> instance

-------------------------------------------------------
<a name="AnySocket.on.e2e"></a>
### AnySocket event `e2e`

Emitted when the link has been end-to-end encrypted and it's ready to be used

**Arguments:**
* `peer` - <a href="#AnyPeer">AnyPeer</a> instance

-------------------------------------------------------
<a name="AnySocket.on.heartbeat"></a>
### AnySocket event `heartbeat`

Emitted when a PING/PONG heartbeat has finished

**Arguments:**
* `peer` - <a href="#AnyPeer">AnyPeer</a> instance

-------------------------------------------------------
<a name="AnySocket.on.disconnected"></a>
### AnySocket event `disconnected`

Emitted when a peer has disconnected

**Arguments:**
* `peer` - <a href="#AnyPeer">AnyPeer</a> instance
* `reason` - a string detailing the disconnect reason

-------------------------------------------------------
<a name="AnyPacket.constructor"></a>
### AnyPacket()

Constructor should not be used directly

-------------------------------------------------------
<a name="AnyPacket.seq"></a>
### AnyPacket.seq

An incremental unique identifier per packet per peer (used internally)

-------------------------------------------------------
<a name="AnyPacket.peer"></a>
### AnyPacket.peer

An <a href="#AnyPeer.constructor">AnyPeer</a> instance

-------------------------------------------------------
<a name="AnyPacket.msg"></a>
### AnyPacket.msg

An object that contains data sent/received from a peer

-------------------------------------------------------
<a name="AnyPacket.reply"></a>
### AnyPacket.reply(message)

Sends a reply to the current packet

**Arguments:**
* `message` - a JSON stringifiable object

_note: you can only reply to a normal message, you **cannot** reply to a **reply packet**. It fails silently_ 

-------------------------------------------------------
<a name="AnyPeer"></a>
### AnyPeer()

Constructor should not be used directly

-------------------------------------------------------
<a name="AnyPeer.id"></a>
### AnyPeer.id

Unique peer identifier (UUIDv4) - Peer <a href="#AnySocket.id">AnySocket.id</a>

-------------------------------------------------------
<a name="AnyPeer.lag"></a>
### AnyPeer.lag

Last calculated latency (based on heartbeat) in milliseconds

-------------------------------------------------------
<a name="AnyPeer.connectionID"></a>
### AnyPeer.connectionID

Unique connection identifier (UUIDv4), used internally before getting a <a href="#AnyPeer.id">AnyPeer.id</a>

-------------------------------------------------------
<a name="AnyPeer.e2e"></a>
### AnyPeer.e2e()

Enables E2E encryption. The certificate is generated on the spot with a size of 4096 bytes

-------------------------------------------------------
<a name="AnyPeer.send"></a>
### AnyPeer.send(message, [awaitReply, [timeout]])

Sends a message to the peer

**Arguments:**
* `message` - a JSON stringifiable object
* `awaitReply` - set to true if a reply is expected
* `timeout` - set a custom reply packet timeout (in milliseconds)

**Returns** a Promise that resolves with a <a href="#AnyPacket">AnyPacket</a> if waiting for a reply or rejects on error

_note: it doesn't resolve if awaitReply is not set_ 

_note: you can only reply to a normal message, you **cannot** reply to a **reply packet**. It fails silently_ 

-------------------------------------------------------
<a name="AnyPeer.disconnect"></a>
### AnyPeer.disconnect(reason)

Disconnects the peer

**Arguments:**
* `reason` - a string that explains why the peer was disconnected

-------------------------------------------------------
<a name="AnyPeer.heartbeat"></a>
### ~~AnyPeer.heartbeat()~~

Send a heartbeet to the peer - _used internally_

-------------------------------------------------------
<a name="AnyPeer.on.message"></a>
### AnyPeer event `message`

Emitted when a message is received

**Arguments:**
* `packet` - <a href="#AnyPacket">AnyPacket</a> instance

-------------------------------------------------------
<a name="AnyPeer.on.e2e"></a>
### AnyPeer event `e2e`

Emitted when the link has been end-to-end encrypted and it's ready to be used

**Arguments:**
* `peer` - <a href="#AnyPeer">AnyPeer</a> instance

-------------------------------------------------------
<a name="AnyPeer.on.heartbeat"></a>
### AnyPeer event `heartbeat`

Emitted when a PING/PONG heartbeat has finished

**Arguments:**
* `peer` - <a href="#AnyPeer">AnyPeer</a> instance

-------------------------------------------------------
<a name="AnyPeer.on.disconnected"></a>
### AnyPeer event `disconnected`

Emitted when the peer has disconnected

**Arguments:**
* `peer` - <a href="#AnyPeer">AnyPeer</a> instance
* `reason` - a string detailing the disconnect reason

<a name="future"></a>
## Upcoming Features
* P2P using a proxy server (with support for e2e between clients)
* Mesh Network
* Multiple transports: **wss**, **tcp**, **http**, **udp**, **ipc**

_* this will require a change in the protocol, as the protocol assumes the packets are sent using a reliable, ordered connection_

<a name="license"></a>
## License

MIT