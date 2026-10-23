const test = require("node:test");
const assert = require("node:assert");
const E2E = require("../../src/libs/E2E");
const Frame = require("../../src/libs/Frame");
const { pair, wait } = require("../helpers/loopback");

const both = (ciphers) => ({ connect: { e2eCiphers: ciphers }, listen: { e2eCiphers: ciphers } });

test("ChaCha20-Poly1305 works end to end between two node peers", async (t) => {
    const link = await pair(t, both(["chacha20-poly1305"]));
    await link.clientPeer.e2e();

    assert.equal(link.clientPeer.e2eInfo().cipher, "chacha20-poly1305");
    assert.equal(link.serverPeer.e2eInfo().cipher, "chacha20-poly1305");

    const received = new Promise((resolve) => link.server.once("message", (p) => resolve(p.msg)));
    await link.clientPeer.send({ over: "chacha" });
    assert.deepEqual(await received, { over: "chacha" });
});

test("bytes and chunked payloads survive ChaCha20 too", async (t) => {
    const link = await pair(t, both(["chacha20-poly1305"]));
    await link.clientPeer.e2e();

    const payload = Buffer.alloc(9 * 1024 * 1024);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 253;

    const received = new Promise((resolve) => link.server.once("message", (p) => resolve(p.msg)));
    await link.clientPeer.send(payload);

    const got = await received;
    assert.equal(got.length, payload.length);
    assert.equal(Buffer.compare(Buffer.from(got.subarray(-1024)), payload.subarray(-1024)), 0);
});

// Neither end imposes its preference: the choice is one both offer.
test("ends that prefer different ciphers settle on one both offer", async (t) => {
    const link = await pair(t, {
        connect: { e2eCiphers: ["chacha20-poly1305", "aes-256-gcm"] },
        listen: { e2eCiphers: ["aes-256-gcm"] }
    });
    await link.clientPeer.e2e();

    assert.equal(link.clientPeer.e2eInfo().cipher, "aes-256-gcm");
    assert.equal(link.serverPeer.e2eInfo().cipher, "aes-256-gcm");
});

test("ends with no cipher in common refuse rather than fall back", async (t) => {
    const link = await pair(t, {
        connect: { e2eCiphers: ["chacha20-poly1305"] },
        listen: { e2eCiphers: ["aes-256-gcm"] }
    });

    const gone = new Promise((resolve) => link.server.on("disconnected", (_p, reason) => resolve(reason)));
    await assert.rejects(link.clientPeer.e2e());
    assert.match(String(await gone), /no e2e suite in common/i);
});

test("the cipher a frame was sealed with is the one that opens it", async (t) => {
    for (const cipher of ["aes-256-gcm", "chacha20-poly1305"]) {
        const a = await E2E.createOffer({ kex: ["x25519"], ciphers: [cipher] });
        const b = await E2E.createOffer({ kex: ["x25519"], ciphers: [cipher] });
        const common = { kex: "x25519", cipher: cipher, protocolVersion: 1, capabilities: [] };

        const left = await E2E.derive(Object.assign({}, common, {
            localID: "a", remoteID: "b",
            localPrivateKey: a.privates.x25519, localPublicKey: Frame.fromBase64(a.wire.keys.x25519), localNonce: a.nonce,
            remotePublicKey: Frame.fromBase64(b.wire.keys.x25519), remoteNonce: b.nonce
        }));
        const right = await E2E.derive(Object.assign({}, common, {
            localID: "b", remoteID: "a",
            localPrivateKey: b.privates.x25519, localPublicKey: Frame.fromBase64(b.wire.keys.x25519), localNonce: b.nonce,
            remotePublicKey: Frame.fromBase64(a.wire.keys.x25519), remoteNonce: a.nonce
        }));

        const header = new Uint8Array([1, 3, 0, 0, 0, 9]);
        const sealed = await E2E.seal(left.sendKey, 0, header, Frame.bytes(cipher));
        assert.equal(Frame.text(await E2E.open(right.recvKey, 0, header, sealed)), cipher);
    }
});

test("this machine ranks the ciphers it has", (t) => {
    const ranked = E2E.supportedCiphers();
    assert.ok(ranked.indexOf("aes-256-gcm") != -1, "AES-GCM must always be offered — it is all a browser has");
    assert.deepEqual(ranked.slice().sort(), ranked.filter((c, i, all) => all.indexOf(c) == i).sort(),
        "no cipher should be listed twice");
});

// A browser has only AES-GCM, so a node peer that prefers ChaCha20 must still
// land on AES with one — the browser bundle test pairs exactly these two
// implementations; this pins the negotiation the rule depends on.
test("a ChaCha-preferring node and an AES-only peer agree on AES", (t) => {
    assert.equal(E2E.chooseCipher(["chacha20-poly1305", "aes-256-gcm"], ["aes-256-gcm"]), "aes-256-gcm");
});

test("a tampered ChaCha20 frame is rejected", async (t) => {
    const link = await pair(t, both(["chacha20-poly1305"]));
    await link.clientPeer.e2e();
    await wait(30);

    const { rawSocket } = require("../helpers/loopback");
    const socket = rawSocket(link.clientPeer);
    const original = socket.send.bind(socket);
    let captured = null;
    socket.send = (data, cb) => { captured = data; if (cb) cb(); return Promise.resolve(); };

    await link.clientPeer.send({ tamper: "me" });
    socket.send = original;

    const frame = Frame.asBytes(captured).slice();
    frame[frame.length - 1] ^= 0xff;

    const gone = new Promise((resolve) => link.server.on("disconnected", (_p, reason) => resolve(reason)));
    original(frame);
    assert.match(String(await gone), /invalid encrypted frame/i);
});
