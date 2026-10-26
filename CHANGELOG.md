# Changelog

## 1.0.3

### Fixed
- In the browser, an RPC with a `null` or `undefined` argument threw before it was sent, and so
  did a browser answering an RPC with `null`: the browser build's buffer check read `.buffer` of
  whatever it was given.

## 1.0.2

### Fixed
- In the browser, a ws connect with `connectTimeout` (or `cookies`) failed. The options object
  went to `new WebSocket(url, options)`, which a browser reads as the subprotocol list and
  refuses. A browser now gets only the URL, and `connectTimeout` is kept there by a timer.

## 1.0.1

### Fixed
- A binary message too short for a frame header — a single `0x00` from any
  unauthenticated socket — left a rejection unhandled, which ended the process.
  It now drops that connection only.

## 1.0.0

A rewrite of the protocol and its internals. A 1.0 peer still talks to a 0.4.x
peer on the wire, so a fleet can be upgraded one process at a time. **1.0.x is
the only line that does**: 1.1 drops the 0.4.x format. Read
[MIGRATING-1.0.md](MIGRATING-1.0.md) before upgrading; it lists everything that
behaves differently, worst first.

### New
- **Binary frames.** A `Uint8Array`/`Buffer` travels as those bytes, in messages
  and in RPC arguments and results. There is no base64 between 1.0 peers.
- **Authenticated end-to-end encryption** with forward secrecy:
  - x25519 (p256 where unavailable) with AES-256-GCM or ChaCha20-Poly1305;
  - a transcript-bound key schedule, and a channel binding to pin your own auth to;
  - `e2e()` returns a promise, and either end may call it.
- **Built-in mutual authentication** from a shared secret, which also binds the
  encrypted channel. An optional mode lets a live fleet move over to it.
- `requireE2E`: a peer is never handed out before it is encrypted.
- **tcp and ipc transports.** tcp can share one port with ws/http.
- `maintain()` keeps a peer connected, with backoff.
- Per-call RPC options (`rpcWith({ timeout, signal })`), and `rpcGuard` to
  authorize every incoming call in one place.
- Typed errors: `AnySocket.Error` with a stable `code` (`AnySocket.ERRORS`).
- Each end announces the largest frame it takes, and senders fit it, through a relay too.
- A peer that restarts keeping its id replaces the connection its previous
  instance left behind. A live peer is never evicted by another instance claiming its id.
- `listen()` resolves with the bound port, and port `0` asks the OS for one.

### Changed
These can change what your application does; [MIGRATING-1.0.md](MIGRATING-1.0.md) has the detail.
- `onAuth` is awaited, so an async one now works, and refuses when it should.
- A listening side's options are applied.
- A missed reply fails that call only, not the whole connection
  (`disconnectOnReplyTimeout` restores the old behaviour).
- The heartbeat drops a peer that goes silent.
- `send()` without `awaitReply` resolves once written. `awaitReply` takes a
  boolean only. `reply()` returns a promise.
- Errors are `AnySocket.Error`. That includes a failed RPC, whose HTTP-style
  code is now `status`.
- Two peers that dial each other agree on one connection.
- Relaying needs 1.0 on both hops, and the far end must accept the link (`canAcceptProxy`).
- An RPC path no longer reaches inherited methods.
- `AnySocket.mesh()`, `AnyMesh` and `filter()` are removed.
- Requires Node.js 20 or later.

### Performance (against 0.4.32, `npm run bench`)
- e2e handshake: 4.6x faster.
- Encrypted 2KB messages: 1.9x faster.
- Encrypted bulk bytes: 4.8x faster, with 2.7x fewer bytes on the wire.
- Plain bulk bytes: 3.6x faster.
- Plain bulk *text* is about 1.2x slower.
- tcp outpaces ws, by about 1.3x on small messages.
- `bufferutil` is an optional dependency, for native ws masking where it installs.

### Fixed (from 0.4.32)
- An async `onAuth` accepted every peer.
- FORWARD packets were handled before the handshake, and their `from` was
  taken at face value.
- Reassembly was unbounded before authentication.
- Both ends calling `e2e()` desynchronised the exchange.
- `send()` never settled.
- A busy port on `listen()` crashed the process.
- "disconnected" never fired on `AnyPeer`.
- An undecodable packet was delivered with `data = null`.
- A rejected RPC serialised its error as `{}`, or rejected with the call it sent,
  arguments included.
