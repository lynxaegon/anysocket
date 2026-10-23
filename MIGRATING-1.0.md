# Migrating to anysocket 1.0

0.4.x code keeps working, and a 1.0 peer still talks to a 0.4.x peer on the
wire, so a fleet can be upgraded one process at a time. The list below is
everything that behaves differently, worst first — the first four are the ones
that can change what your application does without you touching a line.

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

### `send()` without `awaitReply` now resolves

It previously never settled, so `await peer.send(msg)` hung forever. If you
worked around that with a race or a timeout, you can drop it.

## Smaller changes

- **A rejected RPC reports a readable message.** A thrown `Error` has no
  enumerable fields, so it used to serialize to `{}`. `error` is now the
  message, with `code` and `details` alongside.
- **An undecodable packet drops the connection** instead of being delivered with
  `data = null`.
- **`AnySocket.mesh()` and `AnyMesh` are gone.** The class was an empty stub. A
  mesh is still on the roadmap.
- **Relaying needs 1.0 on both hops.** A relayed frame is opaque bytes the relay
  re-wraps per hop, so every hop has to be able to carry it. `proxy()` rejects
  with a reason when a hop is 0.4.x. Addresses are anysocket ids (UUIDv4).
- **`stop()` rejects** instead of throwing inside a promise callback.

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

### Knowing what a connection is

```js
peer.protocolVersion();   // 1, or 0 against a 0.4.x peer
peer.capabilities();      // what both ends announced
peer.supportsRelay();     // can it carry a relayed link
peer.isOutbound();        // did we dial it — reportable only; nothing in the
                          // protocol depends on it
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
| `maxPayload` | derived | Transport frame limit; follows `maxPacketSize`. |

## Running the tests

Split, so iterating is quick:

```
npm run test:unit       # no sockets, ~0.3s
npm run test:fast       # everything but the 0.4.32 interop pass
npm test                # all of it
npm run bench           # 1.0 against 0.4.32, plain and encrypted
```
