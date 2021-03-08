# AnySocket
An abstract networking layer over multiple transports, agnostic of client/server with support for E2EE (with forward secrecy)

[![Dependency Status](https://david-dm.org/lynxaegon/anysocket.svg)](https://david-dm.org/lynxaegon/anysocket)
[![devDependency Status](https://david-dm.org/lynxaegon/anysocket/dev-status.svg)](https://david-dm.org/lynxaegon/anysocket/?type=dev)
[![NPM version](https://badge.fury.io/js/anysocket.svg)](https://www.npmjs.com/package/anysocket)
![Downloads](https://img.shields.io/npm/dm/anysocket.svg?style=flat)
[![HitCount](http://hits.dwyl.com/lynxaegon/anysocket.svg)](http://hits.dwyl.com/lynxaegon/anysocket)

* <a href="#features">Features</a>
* <a href="#benchmark">Benchmark</a>
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
* E2EE between peers with forward secrecy
* RPC support
* P2P using a proxy server (with support for direct E2EE between peers)
* Binary support (_see: <a href="#AnySocket.Packer.pack"><code><b>AnySocket.Packer</b></code></a>_)
* **Browser support** - 30kb footprint (_see: ```/dist/anysocket.bundle.js```_)
* Multiple transports *(implemented atm: **ws**)
* All peers have a UUIDv4 associated
* Disconnect detection using a heartbeat
* **Not Battle Tested** ...yet

_Info: Binary RPC arguments and responses are auto packed/unpacked (<a href="#AnySocket.Packer.pack"><code><b>AnySocket.Packer.pack</b></code></a>/<a href="#AnySocket.Packer.unpack"><code><b>AnySocket.Packer.unpack</b></code></a>)._ 


<a name="benchmark"></a>
## Benchmark
#### nodejs - browser
```
Running PLAIN TEXT benchmark: 5518.838ms  (test duration)
Latency: 0.86 ms
Running E2EE benchmark: 5986.633ms        (test duration)
Latency: 1.06 ms
```

#### nodejs - nodejs
```
Running PLAIN TEXT benchmark: 5010.484ms  (test duration)
Latency: 0.67 ms
Running E2EE benchmark: 5003.755ms        (test duration)
Latency: 0.92 ms
```
_You can run the benchmarks from: ```/examples/benchmark```_

<a name="installation"></a>
## Installation

```javascript
npm install --save anysocket
```
or
```html
<script src="/dist/anysocket.bundle.js"></script>
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
    console.log("From:", packet.peer.id, "Message:", packet.msg);
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
    console.log("From:", packet.peer.id, "Message:", packet.msg);
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
    * <a href="#AnySocket.broadcast"><code><b>broadcast()</b></code></a>
    * <a href="#AnySocket.setRPC"><code><b>setRPC()</b></code></a>
    * <a href="#AnySocket.canProxy"><code><b>canProxy()</b></code></a>
    * <a href="#AnySocket.proxy"><code><b>proxy()</b></code></a>
    * <a href="#AnySocket.hasPeer"><code><b>hasPeer()</b></code></a>
    * <a href="#AnySocket.hasDirectPeer"><code><b>hasDirectPeer()</b></code></a>
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
* <a href="#AnySocket.Packer.pack"><code><b>AnySocket.Packer</b></code></a>
    * <a href="#AnySocket.Packer.pack"><code><b>pack()</b></code></a>
    * <a href="#AnySocket.Packer.unpack"><code><b>unpack()</b></code></a>
* <a href="#AnyPeer.constructor"><code><b>AnyPeer()</b></code></a>
    * <a href="#AnyPeer.id"><code><b>id</b></code></a>
    * <a href="#AnyPeer.lag"><code><b>lag</b></code></a>
    * <a href="#AnyPeer.connectionID"><code><b>connectionID</b></code></a>
    * <a href="#AnyPeer.rpc"><code><b>rpc</b></code></a>
    * <a href="#AnyPeer.e2e"><code><b>e2e()</b></code></a>
    * <a href="#AnyPeer.send"><code><b>send()</b></code></a>
    * <a href="#AnyPeer.disconnect"><code><b>disconnect()</b></code></a>
    * <a href="#AnyPeer.heartbeat"><code><b>heartbeat()</b></code></a> - deprecated, will be moved
    * <a href="#AnyPeer.isProxy"><code><b>isProxy()</b></code></a>
    * <a href="#AnyPeer.isE2EEnabled"><code><b>isE2EEnabled()</b></code></a>
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
    * `port` - port number
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
<a name="AnySocket.broadcast"></a>
### AnySocket.broadcast(message, [awaitReply])

Broadcasts a message to all connected peers

**Arguments:**
* `message` - a JSON stringifiable object
* `awaitReply` - set to true if a reply is expected (optional) - default: false

**Returns** a Promise that resolves with a <a href="#AnyPacket">AnyPacket</a> if waiting for a reply or rejects on error

_note: it doesn't resolve if awaitReply is not set_ 

-------------------------------------------------------
<a name="AnySocket.setRPC"></a>
### AnySocket.setRPC(rpc)

This sets the RPC functions on the AnySocket object so they can be called using <a href="#AnyPeer.rpc">AnyPeer.rpc</a>
RPC object can be nested indefinitely, but the "this" object will always be the called method's parent

Each RPC function can return a value, object, Buffer/TypedArray or a Promise (awaits the promise to be resolved)

Binary info:
* If a RPC receives an argument as a Buffer/TypedArray it will be auto unpacked
* If a RPC returns a Buffer/TypedArray it will be auto packed

**Arguments:**
* `rpc` - object or class with RPC functions

Any  throwed error / reject will be sent back to the client in the form: 
```javascript
{
    error: "error message",
    code: 500
}
```

-------------------------------------------------------

<a name="AnySocket.canProxy"></a>
### AnySocket.canProxy(peerID, otherPeerID)

Checks if peerID can be proxied through otherPeerID. Defaults to: false

_note: You need to override this function in order to allow proxying_

**Returns** ```true/false```

-------------------------------------------------------
<a name="AnySocket.hasPeer"></a>
### AnySocket.hasPeer(id)

_note: returns true for proxies_

**Returns** ```true/false``` if <a href="#AnySocket">AnySocket</a> has a peer with the ```id```

-------------------------------------------------------
<a name="AnySocket.hasDirectPeer"></a>
### AnySocket.hasDirectPeer(id)

_note: returns false for proxies_

**Returns** ```true/false``` if <a href="#AnySocket">AnySocket</a> has a direct peer (no proxy) with the ```id```

-------------------------------------------------------
<a name="AnySocket.proxy"></a>
### AnySocket.proxy(peerID, throughPeerID)

Send a proxy request for peerID via throughPeerID as relay

_note: A proxied peer uses the same flow as a new connection_

**Returns** a Promise that resolves with a <a href="#AnyPeer">AnyPeer</a> or rejects if proxy fails


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
<a name="AnySocket.Packer.pack"></a>
### AnySocket.Packer.pack(bytes)

Packs the bytes

**Arguments:**
* `bytes` - Buffer/TypedArray

**Returns** a string representation of the bytes

-------------------------------------------------------
<a name="AnySocket.Packer.unpack"></a>
### AnySocket.Packer.unpack(bytes)

Unpacks the bytes

**Arguments:**
* `bytes` - String representation of a Buffer/TypedArray

**Returns** a Buffer/TypedArray

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
<a name="AnyPeer.rpc"></a>
### AnyPeer.rpc(...args)

This is a special Proxy Object that can indefinitely nested and have any number of arguments

Example: `peer.rpc.hello.world.user("LynxAegon")`
* This will try to run a RPC on the peer and the RPC object should look like this:
```javascript
AnySocket.setRPC({
    hello: {
        world: {
            user: (name) => {
                return new Promise((resolve, reject) => {
                    resolve("Hello World, " + name);
                });
            }
        }
    }
})
```

**Returns** a Promise that will resolve if success or reject in case of error 

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
* `awaitReply` - set to true if a reply is expected (optional) - default: false
* `timeout` - set a custom reply packet timeout in milliseconds (optional)

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
<a name="AnyPeer.isProxy"></a>
### AnyPeer.isProxy()

**Returns** ```true``` if the <a href="#AnyPeer">AnyPeer</a> instance is a proxy (see: <a href="#AnySocket.proxy">AnySocket.proxy</a>)

-------------------------------------------------------
<a name="AnyPeer.isE2EEnabled"></a>
### AnyPeer.isE2EEnabled()

**Returns** ```true``` if the connection has been end-to-end encrypted (see: <a href="#AnyPeer.e2e">AnyPeer.e2e</a>)


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
* Mesh Network
* Multiple transports: **wss**, **tcp**, **http**, **udp***, **ipc**
* Client reconnection
* Custom AUTH method

_* this will require a change in the protocol, as the protocol assumes the packets are sent using a reliable, ordered connection_

<a name="license"></a>
## License

MIT
