# Changelog

## 1.1.0

Drops what 1.0.x carried only to talk to 0.4.x: 1.1 sends and reads binary frames
only. It dials any 1.0.x peer; a 1.0.x peer can dial it only where the listener
turns on `acceptLegacyHandshake`. A 0.4.x peer is refused. Read
[MIGRATING-1.0.md](MIGRATING-1.0.md) before upgrading.

### Removed
- The 0.4.x wire format. 1.1 sends only binary frames, its first AUTH included.
- The 0.4.x e2e exchange and the `allowLegacyE2E` option, which is now ignored, as is
  `allowLegacyProtocol` (1.0.4): a 0.4.x peer is always refused.
- Base64 RPC bytes, 1MB chunking and hex relay addresses for a 0.4.x peer, and
  the standby that let a 0.4.x peer choose between two connections.
- `AnySocket.Packer`. Bytes travel as bytes; there is nothing left to pack them for.

### Changed
- A 1.0.x dialler writes its first AUTH in the old text format, and 1.1 does not
  read it unless the listener sets `acceptLegacyHandshake: true`: off, the text is
  dropped unread, with "Not an anysocket frame: a 1.0.x dialler needs
  acceptLegacyHandshake on the listener, and 0.4.x is not supported". 1.1 dialling a
  1.0.x listener needs nothing.
- `allowInsecureWSFallback` now defaults to `false`: a ws connect whose wss dial fails
  rejects instead of retrying as plain ws. Set it to `true` to keep the 1.0.x behaviour.
- A peer whose AUTH announces no protocol version, or one below 1, is refused
  with "Protocol version 1 required (0.4.x peers are not supported since
  anysocket 1.1)". A dialler's `connect()` rejects with it.
- A 0.4.x dialler is refused either way: unread, or by its missing version where
  `acceptLegacyHandshake` is on.
- ws `maxPayload` defaults to `maxPacketSize` + 1MB, at least 8MB. It was
  twice `maxPacketSize`.
- `protocolVersion()` is always 1 and `supportsRelay()` always true.
- An RPC that lists a binary argument without attaching it fails.

### Fixed
- In the browser, `connect()` with `connectTimeout` or `cookies` passed node
  options to the browser's WebSocket as its subprotocols, which throws. Only the
  URL goes to it now, and `connectTimeout` is enforced with a timer.

### New
- `acceptLegacyHandshake` (default `false`), a listen option: read a 1.0.x
  dialler's first AUTH, for a server whose clients upgrade on their own schedule.
  It goes in a later release.
- `AnyPeer.legacyHandshake()`: true on a connection that came in that way, so a
  server can tell when no client needs the option any more.

### Documented
- A strict configuration, in the README.

Also carries everything in 1.0.3 and 1.0.4.

## 1.0.4

### Security
- An old-format (0.4.x) frame was accepted on a 1.0 connection after the handshake, and
  delivered: messages and RPCs alike, in plaintext, past the e2e session and its
  authentication. Anyone able to inject into the connection could forge them without the key.
  A 1.0 connection now takes only 1.0 frames once it is settled, and drops the connection on
  any other.
- The protocol version could be removed from both handshakes on the way, which put two 1.0
  peers on the old protocol and its unauthenticated e2e exchange; the built-in auth did not
  catch it, since both ends signed the same downgraded outcome. A peer that announces no
  version but sends what only 1.0 sends (its instance id, the built-in auth's challenge) is now
  refused.
- `ws` is now `^7.5.13`, out of the range of two denial-of-service advisories
  (GHSA-3h5v-q93c-6h6q, GHSA-96hv-2xvq-fx4p).

### Added
- `allowLegacyProtocol` (default `true`): `false` refuses a 0.4.x peer outright, for a fleet
  where every peer runs 1.0.
- `allowInsecureWSFallback` (default `true`), on a ws connect: a wss dial that fails is retried
  as plain ws, which anyone on the path can force by making the wss attempt fail. `false` makes
  the wss failure final.

### Documented
- The e2e on a relayed link is not covered by the built-in auth, so a relay could place itself
  in the middle of it; authenticate the far end over `getChannelBinding()` if the relay is not
  trusted.


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
