# Migrating to anysocket 1.0

0.4.x code keeps working, and a 1.0 peer still talks to a 0.4.x peer on the
wire, so a fleet can be upgraded one process at a time. The list below is
everything that behaves differently, worst first — the first four are the ones
that can change what your application does without you touching a line.

**1.0.x is the only line that talks to 0.4.x.** 1.1 drops the 0.4.x wire format
and the legacy e2e exchange, so move every peer to 1.0 before any of them goes
to 1.1 — a 1.1 peer and a 0.4.x peer cannot connect at all.

## Behaviour that changed

### `onAuth` is awaited, so an async one finally works — and finally refuses

Before, `onAuth` was called without being awaited. An `async onAuth` therefore
returned a Promise, a Promise is truthy, and **every peer passed**. If you wrote
one, authentication has not been running at all:

```js
// 0.4.x: looks right, accepted everyone
anysocket.onAuth = async (packet) => await checkToken(packet.auth);
```

In 1.0 that code does what it says. If your token check was wrong, or was
passing for the wrong reason, peers that used to connect will now be refused.
A throwing or rejecting `onAuth` refuses the peer rather than crashing.

### A listening side's options are no longer ignored

For the `ws` scheme, `listen()` replaced your options with just the internal
server handle, so **everything a listener configured was silently dropped** and
only dialling peers were honoured. Options now apply to both sides. If you
passed options to `listen()` you have been getting defaults; you are about to
start getting what you asked for.

```js
server.listen("ws", { port: 3000, heartbeatEnabled: false });   // now actually off
```

### A reply timeout no longer tears down the connection

An unanswered `send(msg, true)` used to disconnect the peer, failing every other
in-flight call and any healthy traffic with it. Now only that call rejects.

```js
// to get the old behaviour back
client.connect("ws", ip, port, { disconnectOnReplyTimeout: true });
```

### The heartbeat now drops a peer that goes silent

The heartbeat timer only re-armed when a probe was answered, so once one went
unanswered nothing was counted as missed: a peer whose process froze, or a path
that stopped delivering while the connection stayed open, was never timed out.
Now a link with nothing received for `heartbeatInterval × (heartbeatsMaxMissed + 1)`
— 15s by default — is disconnected, as the options always described. Any message
counts as a reply, so a busy link sends no probes. If your peers can go quiet for
longer (a long synchronous job, a suspended mobile app), raise the budget:

```js
client.connect("ws", ip, port, { heartbeatInterval: 10 * 1000, heartbeatsMaxMissed: 5 });   // ~60s
```

A 0.4.x peer answers probes even with its own heartbeat off.

### `send()` without `awaitReply` now resolves

It previously never settled, so `await peer.send(msg)` hung forever. If you
worked around that with a race or a timeout, you can drop it.

### Errors are `AnySocket.Error`, with a `code`

The library's own failures used to be bare strings, so telling them apart
meant matching text. They are now `AnySocket.Error` instances with a stable
`code` — see `AnySocket.ERRORS` — and **the messages are exactly what they
were**, so code matching on them keeps working. Test `code` from now on.

```js
try { await peer.rpc.slow(); }
catch (e) { if (e.code === AnySocket.ERRORS.TIMEOUT) { /* ... */ } }
```

`ENOTCONNECTED`, `ETIMEOUT`, `EDISCONNECTED`, `ESUPERSEDED`, `EABORTED`, `EREFUSED`,
`ECONNFAILED`, `ENOMETHOD`, `EFORBIDDEN`, `ERPC`.

- `connect()` rejects with `ECONNFAILED` when the connection closes before it
  is up, with the disconnect reason as `reason`. A socket error (`ECONNREFUSED`
  and the like) is still node's own error.
- `proxy()` rejects with `EREFUSED`, the reason in the message.
- **A failed RPC rejects with an `AnySocket.Error` too.** It used to reject with
  the reply object itself, `{ error, details, code }` with `code` an HTTP-style
  number. `error` and `details` are still there; the number moved to
  `status`, and `code` is `ENOMETHOD` (404), `EFORBIDDEN` (403) or `ERPC` (500).
  **Code testing `e.code === 404` has to test `e.status === 404`**, or better
  `e.code === AnySocket.ERRORS.RPC_NOT_FOUND`. The wire is unchanged, so this
  holds against a 0.4.x peer as well.
- A `disconnected` reason is always text.

### Two peers that dial each other keep one connection

When two peers dial each other at once, both ends get two connections and have
to retire the same one. Each used to drop whichever came up second — a race —
so they routinely dropped *opposite* ones and **both** connections died. The
survivor is now chosen the same way at both ends, from the two ids. A dial
that reaches the peer but loses that choice resolves with the connection that
was kept, and a retired connection rejects whatever was pending on it and is
announced as `disconnected`. If you re-dialled on every drop, you no longer
loop.

A peer that restarts keeping its id is not a duplicate: its new connection
replaces the one its previous instance left, which may not have closed yet.
Each instance sends its own `instanceID` in the handshake (covered by the
built-in auth's proof), so the two cases are told apart. The connection held is
probed first: if it still answers within `duplicateProbeTimeout` (2s), it is
a live process, and the new connection is refused as a duplicate. So two live
instances sharing an id do not evict each other, and nobody can take a live
peer's place by claiming its id.

## Smaller changes

- **A rejected RPC reports a readable message.** A thrown `Error` has no
  enumerable fields, so it used to serialize to `{}`. `error` is now the
  message, with `details` and `status` alongside.
- **`send(message, awaitReply)` takes a boolean.** A number made the message a
  reply to that seq, so `send(msg, 5000)` meant as a timeout went out as a
  reply; it now rejects with a `TypeError`. Answer with `packet.reply()`, which
  now returns a Promise.
- **`send(0)`, `send(false)` and `send("")` arrive as themselves**, not as `{}`.
- **`filter()` is gone.** It did nothing.
- **The frame size is negotiated.** Each end announces the largest frame it takes,
  and a sender cuts its frames to fit, through a relay too. A sender with a larger
  `maxPacketSize` than the receiver's transport allowed used to be disconnected
  with nothing delivered.
- **Before it has answered the AUTH, a listener takes nothing large**: tcp frames
  are held to the handshake ceiling, and data sent ahead of the handshake is
  bounded by it. An unauthenticated client could pin hundreds of MB.
- **`e2e()` while a large message is in flight** holds the rest of the message
  until the keys are ready, and sends it encrypted. Chunks used to go out in
  clear, which the other end refused, dropping the connection.
- **One e2e exchange per connection.** A second offer once encryption is up drops
  the connection: it would have reused the ephemeral key with the counters at 0.
- **An undecodable packet drops the connection** instead of being delivered with
  `data = null`.
- **`AnySocket.mesh()` and `AnyMesh` are gone.** The class was an empty stub. A
  mesh is still on the roadmap.
- **Relaying needs 1.0 on both hops.** A relayed frame is opaque bytes the relay
  re-wraps per hop, so every hop has to be able to carry it. `proxy()` rejects
  with a reason when a hop is 0.4.x. Addresses are anysocket ids (UUIDv4).
- **The far end of a relayed link has to accept it:** set
  `canAcceptProxy(relayID, peerID)`, which defaults to false like `canProxy`.
  Any connected peer could otherwise announce peers that do not exist, and speak
  for them. `proxy()` rejects with "refused by the peer" when it says no, and
  a relayed link over a connection that requires e2e is encrypted before either
  end is handed it.
- **An RPC path no longer reaches inherited methods.** `toString`,
  `constructor`, an exposed array's `push` and the like answer 404; they used
  to run, with our own peer object as an argument. Methods your own classes
  define still work, so `setRPC(new Service())` is fine.
- **A remote method may be named `name`, `length`, `call`, `apply` or `bind`.**
  The caller's proxy used to answer those itself. It no longer forwards `then`,
  `toJSON` or symbols, so awaiting or serializing it makes no call.
- **`stop()` rejects** instead of throwing inside a promise callback.
- **An HTTP request's path is normalized**, as the URL standard has it:
  `/a/../b` routes as `/b`. The query parses as before.
- **A failed `listen()` no longer crashes the process.** A busy port raised a
  second rejection nothing could catch, which killed the process even when the
  caller handled the error. `listen()` resolves with the bound port, and port
  `0` asks the OS for a free one.
- **An un-awaited `send()`, `e2e()` or `broadcast()` that fails no longer
  crashes the process**, now that they can reject; an awaiting caller still
  sees the failure.
- **A failed RPC rejects with the reason**, not with the call it sent — which
  used to put its arguments, secrets included, wherever the error was logged.
- **A connection to ourselves is refused**, rather than reaching the duplicate
  rule with both ends being the same instance.
- **`"connected"` is no longer emitted for a peer that already went away.**
- **`bufferutil` is an optional dependency.** It masks ws frames natively, which
  speeds up large ws transfers. npm skips it where it cannot be installed (no
  prebuilt binary and no compiler, e.g. arm64 Alpine), and ws then masks in JavaScript
  as before.
- **On node, a plain `Uint8Array` is treated as bytes**, as in the browser; it
  used to go through JSON as `{"0":9,...}`. Binary RPC arguments and results
  arrive as `Buffer`s on node.

## What is new

### Bytes are bytes

`send()` accepts a `Uint8Array` or `Buffer` and puts those bytes on the wire
between 1.0 peers — no base64, no JSON. `AnySocket.Packer` still works and is
still what you need for a 0.4.x peer.

```js
peer.send(await fs.promises.readFile("big.bin"));   // arrives as bytes
```

### `e2e()` returns a promise, and either end may call it

The exchange is symmetric, so there is no initiator to elect and both ends may
call it at once. If you wrote that election yourself, delete it.

```js
await peer.e2e();
peer.e2eInfo();          // { protocolVersion: 1, kex: "x25519", cipher: "aes-256-gcm" }
```

### Channel binding

`peer.getChannelBinding()` is 32 bytes unique to the encrypted channel and
identical on both ends. Mix it into your own authentication and a captured
proof is worthless on any other channel — which is what closes an on-path
attacker's room to carry one across. `null` until `e2e()` completes.

### Built-in mutual authentication

Instead of building a challenge on `authPacket`/`onAuth`:

```js
const anysocket = new AnySocket({ auth: { secret: process.env.SHARED_SECRET } });
```

Both ends challenge, both prove, a proof is good only for the exchange it was
made in, and neither side's proof can be reflected back. A peer that declines it
is refused when a secret is set. Your own `onAuth` still runs and can still
refuse a peer that proved the secret.

Moving a running fleet over to it? `auth: { secret, optional: true }` offers it
to every peer and still accepts one that does not offer it back, and
`peer.isAuthenticated()` says which way each connection went — gate on that
until the last peer has moved, then drop `optional`. Optional means a peer may
*decline* the auth, not *fail* it: offering it with the wrong secret is still
refused.

With a secret set, the secret also goes into the e2e keys, so the encrypted
channel is authenticated and not merely private: someone in the path who
relays the auth handshake and substitutes keys of their own cannot derive what
either end does. `e2eInfo().authenticated` says whether a channel is.

### Encrypted from the start: `requireE2E`

```js
server.listen("tcp", { port: 3000, requireE2E: true });
```

A connection is not up — no `"connected"`, and `connect()` does not resolve —
until it is encrypted, so you are never handed a peer you could talk to in
clear. Either end asking for it is enough; it travels in the handshake.

### Ciphers

AES-256-GCM everywhere, and ChaCha20-Poly1305 between node peers — the faster
of the two on a CPU that does not accelerate AES. Each end measures which it
runs faster and the negotiation settles on one both offer, so a browser (AES
only) always lands both on AES. `e2eCiphers` pins a list.

`allowLegacyE2E: false` refuses the old exchange a 0.4.x peer does
(unauthenticated, AES-CBC with no integrity) once you no longer need it for an
upgrade.

### tcp and ipc

```js
server.listen("tcp", { port: 3000 });
client.connect("tcp", "10.0.0.2", 3000);

server.listen("ipc", { path: "/tmp/app.sock" });   // or \\.\pipe\app on Windows
client.connect("ipc", "/tmp/app.sock");
```

Between processes that do not need a browser, tcp is markedly faster than ws:
no frame header, and no masking of every byte a client sends. Neither exists in
the browser build.

tcp can share a port the same instance serves ws on — `listen("ws", 3000)` then
`listen("tcp", { port: 3000 })` — so moving peers from ws to tcp needs no new
port: old ones keep dialling ws, upgraded ones dial tcp, on the same address.

### Keeping a peer connected: `maintain()`

```js
const link = anysocket.maintain("tcp", "10.0.0.2", 3000, {}, { minDelay: 500, maxDelay: 30000 });
link.on("connected", (peer) => { /* ... */ });
link.on("disconnected", (peer, reason) => { /* ... */ });
```

Dials, and dials again with backoff and jitter whenever the link drops. It
remembers which peer the target turned out to be, so a connection to that peer
from either direction satisfies it and is never dialled back; it adopts the
connection the duplicate rule keeps when two peers maintain each other; and it
resets the backoff only once a connection has stayed up. `fail(reason)` for a
rejection of your own, `giveUpAfter`, `stop()`.

### Per-call RPC options

```js
await peer.rpcWith({ timeout: 45000 }).reset("node-3");
await peer.rpcWith({ signal: controller.signal }).slow();
```

A call used to have only the instance-wide `replyTimeout`, so it could not wait
longer than that, and racing your own timer left the call registered until the
default ran out.

### Authorizing every call: `rpcGuard`

```js
new AnySocket({ rpcGuard: (peer, path, args) => peer.isAuthenticated() && path[0] !== "admin" });
```

Asked before every incoming RPC, with the decoded arguments; only `true` lets
it run, anything else rejects the caller with 403. One place for a rule that
applies to every method, instead of a check repeated at the top of each.

### Knowing what a connection is

```js
peer.protocolVersion();   // 1, or 0 against a 0.4.x peer
peer.capabilities();      // what both ends announced
peer.supportsRelay();     // can it carry a relayed link
peer.isOutbound();        // did we dial it — reportable only; nothing in the
                          // protocol depends on it
peer.isAuthenticated();   // did this connection complete the built-in auth
peer.requiresE2E();       // did this connection have to be encrypted
anysocket.getPeer(id);    // the connected peer with this id, or null
```

### Options worth knowing

| option | default | |
|---|---|---|
| `maxPacketSize` | `4MB` | Bytes per 1.0 frame. Bigger is faster on bulk transfers and holds more. |
| `sendWindow` | `8` | Frames in flight while a message is being framed. |
| `sendHighWaterMark` | `16MB` | How much may sit unflushed before a send waits. |
| `maxHandshakeMessageSize` | `64KB` | Ceiling before a peer has authenticated. |
| `maxMessageSize` | `Infinity` | Ceiling after it has. Set it to bound an authenticated peer. |
| `maxPartialPackets` | `64` | Messages that may be mid-reassembly at once. |
| `capabilities` | all | Narrow it to opt out of a feature. |
| `maxPayload` | derived | Transport frame limit, announced in the handshake. ws derives it from `maxPacketSize`; tcp takes 64MB. |
| `duplicateProbeTimeout` | `2s` | How long a held connection has to answer when a new instance of its peer arrives. |
| `requireE2E` | `false` | Not up until encrypted. |
| `e2eCiphers` | measured | Ciphers to offer, most preferred first. |
| `allowLegacyE2E` | `true` | Allow the old exchange with a 0.4.x peer. |
| `connectTimeout` | none | Abandon a dial that never answers (ws and tcp). |

## Running the tests

Split, so iterating is quick:

```
npm run test:unit       # no sockets, ~0.3s
npm run test:fast       # everything but the 0.4.32 interop pass
npm test                # all of it
npm run bench           # 1.0 against 0.4.32, plain and encrypted
```
