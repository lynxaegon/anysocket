# AnySocket
A custom protocol over any transport — client/server agnostic, binary framed, with authenticated end-to-end encryption

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

1.0 is the first stable release. Upgrading from 0.4.x? See
[MIGRATING-1.0.md](MIGRATING-1.0.md) — a few behaviours changed, and one of them
(`onAuth` is now actually awaited) can start refusing peers that used to connect.

A 1.0 peer still talks to a 0.4.x peer on the wire, so a fleet can be upgraded
one process at a time.

<a name="features"></a>
## Features
* Client / Server agnostic — once a link is up, both ends use the same API
* Support for request/reply, with per-call timeouts and cancellation
* **Authenticated E2EE** with forward secrecy — x25519 (p256 where unavailable),
  AES-256-GCM or ChaCha20-Poly1305, and a channel binding to pin your own auth to
* Built-in mutual authentication from a shared secret, which also binds the
  encrypted channel to it — or bring your own; an optional mode for moving a live
  fleet over to it
* `requireE2E`: never be handed a peer you could talk to in clear
* Binary frames: a `Uint8Array`/`Buffer` travels as those bytes, in messages and RPC
* RPC support
* NTP Sync between peers support
* P2P using a proxy server (with support for direct E2EE between peers)
* `maintain()`: keep a peer connected, with backoff
* **Browser support** (_see: ```/dist/anysocket.browser.js```_), tested as the built
  bundle
* Transports: **ws/wss**, **tcp**, **ipc** (unix socket / named pipe), **http/https**
* Talks to 0.4.x peers on the wire, for upgrading a fleet one peer at a time
* All peers have a UUIDv4 associated
* Disconnect detection using a heartbeat
* Tested: `npm test`, split into groups so iterating is quick

** _http_ transport is experimental

_Info: Binary RPC arguments and responses are sent as bytes between 1.0 peers, and auto packed/unpacked (<a href="docs/#AnySocket.Packer.pack"><code><b>AnySocket.Packer</b></code></a>) for a 0.4.x peer._

## Benchmarks

`npm run bench` measures 1.0 against the published 0.4.32, plain and encrypted,
on loopback, interleaving the two and reporting the median of several runs
(`BENCH_RUNS`). Median of 5 (node 24, x64, ws):

| | 0.4.32 | 1.0 | |
|---|---|---|---|
| connect + authenticate | 13.4 ms | 13.5 ms | about the same |
| e2e handshake | 7.7 ms | **1.8 ms** | 4.2x faster |
| 2KB messages, plain | 25.6k msg/s | **35.8k msg/s** | 1.4x faster (noisy) |
| 2KB messages, encrypted | 14.4k msg/s | **29.0k msg/s** | 2.0x faster, 2x fewer bytes |
| 32MB of text, plain | 136 MB/s | **151 MB/s** | 1.1x faster |
| 32MB of text, encrypted | 52.6 MB/s | **123 MB/s** | 2.3x faster, 2x fewer bytes |
| 32MB of bytes, plain | 103 MB/s | **239 MB/s** | 2.3x faster, 1.3x fewer bytes |
| 32MB of bytes, encrypted | 40.2 MB/s | **181 MB/s** | 4.5x faster, 2.7x fewer bytes |

Turning e2e on costs about 26% of throughput (128MB of bytes: 233 MB/s plain,
172 MB/s encrypted). tcp is faster still than ws; these are ws so both versions
run the same transport.

See also [benchmarks](benchmarks) for the http/ws server comparisons.

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
server.on("connected", async (peer) => {
    console.log("Connected", peer.id);
    console.log(await peer.getSyncedTime()) // { time: 1674671482107, rtt: 2, offset: 0 }
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
client.on("connected", async (peer) => {
    console.log("Connected", peer.id);
    console.log(await peer.getSyncedTime()) // { time: 1674671482107, rtt: 2, offset: 0 }
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

See [documentation](docs#api) and the [examples](examples) folder.

Upgrading from 0.4.x? [MIGRATING-1.0.md](MIGRATING-1.0.md).

## Tests

```
npm run test:unit       # no sockets, ~0.3s — the quick loop
npm run test:fast       # everything but the 0.4.32 interop pass
npm run test:browser    # drives the built dist/ bundle
npm test                # all of it
npm run bench           # 1.0 vs 0.4.32, plain and encrypted
```

<a name="future"></a>
## Upcoming Features
* Mesh Network
* **udp*** transport

_* this will require a change in the protocol, as the protocol assumes the packets are sent using a reliable, ordered connection_

_A transport has to deliver whole messages: ws does, and tcp and ipc length-prefix
each one. The frame format itself is byte-oriented and does not depend on a
transport distinguishing text from binary._

<a name="license"></a>
## License

MIT
