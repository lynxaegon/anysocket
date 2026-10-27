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

1.1 speaks binary frames only. It does not talk to 0.4.x: a 0.4.x peer is
refused, with a reason that says so.

| | talks to 1.0.x | talks to 0.4.x | |
|---|---|---|---|
| **1.0.x** | yes | yes | the bridge: upgrade a running fleet one process at a time |
| **1.1** | dials them; is dialled with `acceptLegacyHandshake` | no | drops the 0.4.x wire format and its legacy e2e exchange |

A 1.0.x dialler's first handshake packet is in the old text format, which a 1.1
listener reads only with `acceptLegacyHandshake: true` — for a server whose
clients upgrade on their own. `peer.legacyHandshake()` shows which connections
still rely on it; a later release removes the option.

Upgrading from 0.4.x? Move every peer to 1.0.x first, then to 1.1 — see
[MIGRATING-1.0.md](MIGRATING-1.0.md). Of the 1.0 changes, one (`onAuth` is now
actually awaited) can start refusing peers that used to connect.

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
* RPC support, with an `rpcGuard` to authorize every call in one place
* NTP Sync between peers support
* P2P using a proxy server (with support for direct E2EE between peers)
* `maintain()`: keep a peer connected, with backoff
* **Browser support** (_see: ```/dist/anysocket.browser.js```_), tested as the built
  bundle
* Transports: **ws/wss**, **tcp**, **ipc** (unix socket / named pipe), **http/https** —
  and tcp can share one port with ws/http
* Dials 1.0.x peers, and can accept their dials, so a fleet moves to 1.1 one peer at a time
* All peers have a UUIDv4 associated
* Disconnect detection using a heartbeat
* Tested: `npm test`, split into groups so iterating is quick

** _http_ transport is experimental

## Benchmarks

`npm run bench` measures 1.1 against the published 1.0.1, both ends of each link
on the same version, plain and encrypted, on loopback, interleaving them and
reporting the median of several runs (`BENCH_RUNS`). The table adds the published
0.4.32, measured the same way alongside them. 0.4.32 has no way to send bytes in
a message, so its byte rows go through base64. Median of 7 (node 24, x64, ws):

| | 0.4.32 | 1.0.1 | 1.1 | 1.1 vs 0.4.32 |
|---|---|---|---|---|
| connect + authenticate | 14.2 ms | 13.9 ms | 14.9 ms | about the same |
| e2e handshake | 7.4 ms | 1.7 ms | **1.6 ms** | 4.6x faster |
| 2KB messages, plain | 42.1k msg/s | 55.1k msg/s | **55.3k msg/s** | 1.3x faster |
| 2KB messages, encrypted | 17.0k msg/s | 31.9k msg/s | **33.0k msg/s** | 1.9x faster |
| 32MB of text, plain | 184 MB/s | 194 MB/s | **197 MB/s** | 1.1x faster |
| 32MB of text, encrypted | 67.0 MB/s | 145 MB/s | **166 MB/s** | 2.5x faster |
| 32MB of bytes, plain | 117 MB/s | 396 MB/s | **354 MB/s** | 3.0x faster |
| 32MB of bytes, encrypted | 52.8 MB/s | 250 MB/s | **258 MB/s** | 4.9x faster |

1.1 puts the same frames on the wire as 1.0.1. Turning e2e on costs about a third
of throughput (128MB of bytes: 376 MB/s plain, 243 MB/s encrypted). tcp is faster
still than ws.

See also [benchmarks](benchmarks) for the http/ws server comparisons.

<a name="installation"></a>
## Installation

```
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
// a ws dial tries wss; this server is plain ws, so allow the fallback
client.connect("ws", "127.0.0.1", PORT, { allowInsecureWSFallback: true })
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
### Authenticated and encrypted

```javascript
// both ends hold the same secret; each proves it to the other, and the
// e2e keys are bound to it, so someone relaying the handshake cannot read on
const server = new AnySocket({ auth: { secret: process.env.SHARED_SECRET } });
await server.listen("tcp", { port: 3000, requireE2E: true });  // no "connected" until encrypted

const client = new AnySocket({ auth: { secret: process.env.SHARED_SECRET } });
const peer = await client.connect("tcp", "10.0.0.2", 3000);
peer.e2eInfo();  // { protocolVersion: 1, kex: "x25519", cipher: "aes-256-gcm", authenticated: true }
```

### A strict configuration

Nothing is required by default: an instance with no secret accepts anyone, and
a connection is encrypted only once `e2e()` is called. For a link that must be
both authenticated and private:

```javascript
const server = new AnySocket({
    // required, not optional; a high-entropy secret (32 random bytes, say),
    // never a password, and the same on every peer
    auth: { secret: process.env.ANYSOCKET_SECRET }
});
server.rpcGuard = (peer, path) => peer.isAuthenticated() && path[0] !== "admin";
await server.listen("tcp", {
    port: 3000,
    requireE2E: true,                    // no peer is handed over in clear
    maxMessageSize: 16 * 1024 * 1024,    // the default is unlimited once authenticated
});

const client = new AnySocket({ auth: { secret: process.env.ANYSOCKET_SECRET } });
const peer = await client.connect("tcp", "10.0.0.2", 3000, { requireE2E: true });
peer.e2eInfo().authenticated;            // true: the keys are bound to the secret
```

- Over ws, use wss and leave `allowInsecureWSFallback` off (the default), so a
  failed wss dial is not retried in clear.
- Leave `acceptLegacyHandshake` off unless 1.0.x clients still dial you.
- A relayed link (`proxy()`) is encrypted end to end, but the built-in auth does
  not run across it, and every peer in the group holds the same secret — the
  relay included. If a relay must not be able to read, authenticate the far end
  yourself over `peer.getChannelBinding()` with something only the two ends hold.

### RPC, with one place to authorize it

```javascript
server.setRPC({
    users: { get: async (id, peer) => db.users.get(id) },
    admin: { wipe: async (peer) => db.wipe() }
});
// asked before every call; only `true` lets it run, anything else is a 403
server.rpcGuard = (peer, path, args) => peer.isAuthenticated() && path[0] !== "admin";

const user = await peer.rpc.users.get(42);
await peer.rpcWith({ timeout: 5000 }).users.get(42);   // per-call timeout (or { signal })
```

### Staying connected

```javascript
const link = client.maintain("tcp", "10.0.0.2", 3000);   // dials, and re-dials with backoff
link.on("connected", (peer) => { /* ... */ });
```

More in the `examples` folder.

## Documentation

See [documentation](docs#api) and the [examples](examples) folder.

Upgrading from 0.4.x? Through 1.0.x: [MIGRATING-1.0.md](MIGRATING-1.0.md).

## Tests

```
npm run test:unit       # no sockets, ~0.3s — the quick loop
npm run test:fast       # unit, core and wire: no crypto, security or interop
npm run test:browser    # drives the built dist/ bundle
npm test                # all of it
npm run bench           # 1.1 vs 1.0.1, plain and encrypted
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
