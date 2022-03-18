# AnySocket
An abstract networking layer over multiple transports, client/server agnostic with support for E2EE

[![NPM version](https://badge.fury.io/js/anysocket.svg)](https://www.npmjs.com/package/anysocket)
![Downloads](https://img.shields.io/npm/dm/anysocket.svg?style=flat)

* <a href="#features">Features</a>
* <a href="benchmarks">Benchmarks</a>
* <a href="#installation">Installation</a>
* <a href="#usage">Usage</a>
* <a href="docs">Documentation / API</a>
* <a href="#future">Upcoming Features</a>
* <a href="#license">License</a>

#### Important

This is a work in progress and [API](docs) is subject to change.

<a name="features"></a>
## Features
* Client / Server agnostic
* Support for request/reply
* Custom AUTH method
* E2EE between peers with forward secrecy
* RPC support
* P2P using a proxy server (with support for direct E2EE between peers)
* Binary support (_see: <a href="docs/#AnySocket.Packer.pack"><code><b>AnySocket.Packer</b></code></a>_)
* **Browser support** - 31kb footprint (_see: ```/dist/anysocket.browser.js```_)
* Multiple transports *(implemented atm: **ws/wss**, **http/https**)
* All peers have a UUIDv4 associated
* Disconnect detection using a heartbeat
* **Not Battle Tested** ...yet


** _http_ transport is experimental

_Info: Binary RPC arguments and responses are auto packed/unpacked (<a href="docs/#AnySocket.Packer.pack"><code><b>AnySocket.Packer.pack</b></code></a>/<a href="docs/#AnySocket.Packer.unpack"><code><b>AnySocket.Packer.unpack</b></code></a>)._ 

## Benchmarks

See [benchmarks](benchmarks)

<a name="installation"></a>
## Installation

```javascript
npm install --save anysocket
```
or
```html
<script src="/dist/anysocket.browser.js"></script>
```
or _(if using AnySocketHTTP)_
```html
<script src="@anysocket"></script>
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

## Documentation

See [documentation](docs#api) and [examples](examples) folder

<a name="future"></a>
## Upcoming Features
* Mesh Network
* Multiple transports: **tcp**, **udp***, **ipc**
* Client reconnection

_* this will require a change in the protocol, as the protocol assumes the packets are sent using a reliable, ordered connection_

<a name="license"></a>
## License

MIT
