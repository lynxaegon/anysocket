# AnySocket 1.0 — design

Status: **plan (2026-10-23)**, building on branch `dev`, merging to `master` as **1.0.0**. The current
published version is 0.4.32. AnySocket is the base of the nexus network stack and an open-source library
others use (e.g. obsidian-anysocket-sync, which also runs on Obsidian mobile = browser only).

1.0 is the first stable major. We ship everything in one release — no interim patch. APIs may be cleaned
up, but: the browser build must keep working, the common API (`connect`/`listen`, `send`/`reply`, `rpc`,
`e2e()`, proxy) stays source-compatible for existing consumers, and **1.0 peers must still talk to 0.4.x
peers on the wire** (needed for a clean rolling upgrade inside nexus, where nodes upgrade one at a time
and old/new coexist for the duration — a hard partition during the roll could cost raft quorum).

## 1. How 0.4.x works (what 1.0 builds on)

```
AnySocket (instance, id = random UUID)        ← peers by id, RPC table, http router
 ├─ transports: ws (Node `ws` / browser WebSocket), http (Node only)
 │    AbstractTransport → AbstractPeer (one per socket; type client|server; send(string))
 ├─ AnyProtocol (one per connection)          ← state machine + framing + crypto
 │    ESTABLISHED → (client sends AUTH) AUTHING → CONNECTED ⇄ SWITCHING_PROTOCOL (e2e) → DISCONNECTED
 │    queues: send / link-send / recv / link-recv (fastq, concurrency 1)
 │    heartbeat (app-level ping/pong), auth/e2e/reply timeouts
 └─ AnyPeer (one per authenticated peer)      ← send / reply / rpc proxy / e2e() / getSyncedTime / links
```

- **Framing:** every frame is a JS **string**: `eol(1) + type(1) + seq(int32 packed as 4 chars) + payload`,
  sent as a WebSocket **text** frame. Payload = `JSON.stringify(data)`, split into ≤1 MB chunks (`eol`
  marks the last). Replies use the negated seq. Binary values only exist inside RPC args/results, as base64.
- **Auth:** each side sends `{ id, auth: authPacket() }`; the other calls `onAuth(packet)` (sync, truthy =
  ok). After that the peer id is trusted. Duplicate ids are dropped after the handshake.
- **E2E:** either side calls `e2e()`: SWITCH with an ECDH P-521 public key + nonce; both derive a secret,
  then every chunk is AES-256-CBC with a per-seq PBKDF2(1 iteration) key, hex-encoded.
- **Proxy:** A asks relay R to `proxy(B)`; R links A↔B (if `canProxy`), both get a ProxyPeer whose frames
  travel as FORWARD packets `6 + to(16 bytes) + from(16 bytes) + inner frame`; E2E runs end-to-end over it.
- **RPC:** `peer.rpc.a.b(args)` → INTERNAL packet `{type: RPC, method: ["a","b"], params, bin}` → the other
  side walks `setRPC` object, calls with `(…args, peer)`, replies `{result, bin}` or `{error, code}`.
- **Browser:** webpack swaps crypto (WebCrypto, P-521 + AES-CBC), ws, events, buffer utils; http → empty.

## 2. What 1.0 fixes

### Security (the point of the release — hardening our own stack)
| # | Issue in 0.4.x | What 1.0 does |
|---|---|---|
| S1 | FORWARD/proxy frames are handled **before** the connection is authenticated, and the relay never checks that `from` is really that connection's peer or that `canProxy` allows the route. | Accept FORWARD only on an authenticated (CONNECTED) connection; `from` must equal that connection's peer id (relay hop) or a proxy peer registered through it (last hop); re-check `canProxy` per route. Ids carried as length-prefixed bytes so any id works. Regression test included. |
| S2 | The E2E key exchange is unauthenticated and nothing exposes a channel binding. | Derive a 32-byte channel binding from the handshake transcript; expose `peer.getChannelBinding()` so apps can tie their auth to the exact encrypted channel (closes nexus's stargate on-path-hijack gap). |
| S3 | E2E is AES-CBC with no integrity — altered ciphertext is undetected. | AEAD (AES-256-GCM / ChaCha20-Poly1305): any tamper, replay or reorder fails authentication and drops the connection. |
| S4 | `onAuth` is called synchronously; an `async onAuth` returns a Promise (always truthy = always passes). | `onAuth` is awaited. obsidian-anysocket-sync's client relies on this today without knowing it doesn't work. |
| S5 | Auth is one static packet each way, no challenge → replayable; every app re-rolls nonce handling (nexus hive/stargate do, intricately). | Optional built-in mutual challenge-response from a shared secret, bound to the transcript (and channel binding once e2e is up). Custom `authPacket`/`onAuth` still supported. |
| S6 | No resource limits before auth (unbounded chunk reassembly; `ws` default 100 MB payload). | Enforced receive limits (max frame, max reassembled message, max partial messages in flight), stricter before auth, all configurable. |

### Correctness (fix with tests)
- `broadcast()` resolves correctly, including with zero peers.
- A reply timeout rejects **only that call**, not the whole connection (opt-in to the old behaviour).
- RPC errors carry `message`/`code`/`details` instead of serializing a thrown `Error` to `{}`.
- Both sides calling `e2e()` at once no longer desyncs (built-in initiator election).
- A JSON parse failure rejects the packet instead of delivering `data = null`.
- `stop()` no longer throws inside a promise callback.
- Remove `AnyMesh` (empty stub).

### Performance
- Binary frames instead of text+JSON-only; `peer.send(Uint8Array|Buffer)` sends raw bytes, no base64.
- Modern curve (X25519 ≈ 0.09 ms vs P-521 ≈ 4.5 ms); AEAD instead of AES-CBC + hex (was ~2× bytes on the
  wire and an extra decrypt after every encrypt); no per-packet PBKDF2.

## 3. Wire protocol — negotiation & interop

The AUTH packet gains `pv: 1` (protocol version) + a `caps` list; 0.4.x ignores unknown fields. If both
sides announce `pv ≥ 1`, every later frame uses the 1.0 **binary** format; otherwise the connection stays
on the legacy text format and legacy e2e — a 0.4.x peer never receives a binary frame. The negotiated `pv`
and `caps` are folded into the handshake transcript (§5), so an on-path downgrade changes the channel
binding and is detectable.

**Binary frame** (WebSocket binary message; http transport base64s the same bytes):
```
u8  flags      (bit0 final chunk, bit1 encrypted, bit2 binary payload, bit3 reply)
u8  type       (AUTH, INTERNAL, LINK, SWITCH, HEARTBEAT, FORWARD, …)
u32 seq
... payload    (JSON bytes, or raw bytes when bit2 set; AEAD ciphertext when bit1 set)
```

## 4. E2E 1.0 — still `peer.e2e()`

- **Key exchange:** X25519 (Node + modern browsers); **P-256** fallback when a side's WebCrypto lacks
  X25519 (older Electron/WebView, e.g. some Obsidian mobile). Ephemeral per `e2e()` → forward secrecy.
- **Cipher:** AES-256-GCM everywhere (only AEAD in WebCrypto; fastest with AES hardware). Two Node peers
  may negotiate ChaCha20-Poly1305 when a CPU lacks AES acceleration (each advertises a startup-measured
  preference; browsers advertise AES-GCM only). Default policy to be confirmed with a Pi measurement.
- **Keys:** HKDF-SHA256 over the transcript (`"anysocket/1" | pv+caps | suite | both public keys | both
  nonces`) → two directional keys + the 32-byte channel binding.
- **Per frame:** nonce = 64-bit per-direction counter (no random IV reuse risk); AAD = the frame header.
- **Initiator election:** both sides may call `e2e()`; a deterministic tiebreak (lower `(id, random)`)
  picks one, the other joins the same switch — no app-side "who initiates" logic (nexus does this by hand).
- `e2e()` returns a Promise resolving when the channel is live (the `e2e` event stays).

## 5. Auth 1.0 (built-in, optional)

Keep `authPacket()` / `onAuth()` for custom schemes, but `onAuth` may be **async** (awaited). Add an
opt-in mutual challenge-response: `new AnySocket({ auth: { secret } })` — each side sends a random
challenge, the other answers HMAC(secret, transcript incl. both challenges + both ids + the channel
binding). Mutual, not replayable, no app nonce bookkeeping. This is what nexus hive/stargate implement by
hand today and what we'd migrate them onto.

## 6. API changes

**Added:** `peer.isOutbound()` (nexus reads this through a private Symbol today — see hive
`connectionIsOutbound`), `peer.getChannelBinding()`, `peer.e2eInfo()` → `{pv, kex, cipher}`, `e2e()`
returns a Promise, binary `send()`, async `onAuth`, built-in secret auth, receive-limit options.
**Removed:** `AnySocket.mesh()` / AnyMesh. **Changed (semantics):** reply timeout rejects that call only;
RPC errors carry message/code/details; `broadcast()` resolves correctly. Each gets a line in MIGRATING-1.0.md.

## 7. Build steps (all on `dev`, each step self-contained + tested)

0. **Test harness** — `node --test`; a loopback helper (two instances over ws); run the browser crypto
   module under Node's WebCrypto (`globalThis.crypto`); golden tests pinning current 0.4 behaviour we must
   keep interop with (run against the published 0.4.32 as the "old peer").
1. **Correctness + cleanup** (no wire change): async `onAuth` awaited, `broadcast()`, reply-timeout scope,
   RPC error shape, `e2e()` double-call, JSON-parse reject, `stop()`; delete AnyMesh. Tests each.
2. **Harden proxy/FORWARD** (S1) + pre-auth receive limits (S6). Regression test for the forward-injection.
3. **Protocol negotiation** — `pv`/`caps` in AUTH, frame-format gate, legacy fallback. Interop tests both
   directions vs 0.4.32.
4. **Binary framing** for `pv ≥ 1`; raw-bytes `send()`. Keep text framing for legacy peers.
5. **E2E 1.0** — X25519/P-256 + AES-GCM/ChaCha, HKDF transcript, counter nonce + AAD, channel binding,
   initiator election, Promise `e2e()`. Node + browser-crypto parity. Tamper/replay/reorder + MITM-mismatch
   tests.
6. **Auth 1.0** — built-in shared-secret mutual challenge-response bound to the transcript/binding.
7. **Consumers** — migrate nexus (hive + stargate + CLI: drop the hand-rolled nonce code, use built-in
   auth + `isOutbound` + channel binding), verify in DinD from kbuild; migrate obsidian-anysocket-sync.
   Bump the `anysocket` dep in each.
8. **Release** — README/docs refresh, MIGRATING-1.0.md, benchmarks vs 0.4, bump to **1.0.0**, rebuild the
   browser bundle, merge `dev` → `master`.

## 8. Tests (none exist today)

Node test runner + the browser crypto path under Node WebCrypto: handshake/state machine; framing
(chunking, limits, malformed frames); e2e round-trips per suite; tamper/replay/reorder rejection; channel
binding equal on both ends and different through a simulated MITM; pv1↔pv1 and pv1↔0.4 both directions;
auth (async, secret challenge-response, replay rejected); FORWARD/proxy incl. the S1 regression; RPC incl.
binary + error shape; heartbeats/timeouts; throughput/latency benchmarks vs 0.4.
