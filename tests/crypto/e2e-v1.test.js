const test = require("node:test");
const assert = require("node:assert");
const E2E = require("../../src/libs/E2E");
const Frame = require("../../src/libs/Frame");
const constants = require("../../src/libs/_constants");
const { pair, rawSocket, wait } = require("../helpers/loopback");

const hex = (bytes) => Buffer.from(bytes).toString("hex");

/** Replace the socket's send with a capture, so frames can be replayed or altered. */
function intercept(peer) {
    const socket = rawSocket(peer);
    const original = socket.send.bind(socket);
    const captured = [];

    socket.send = (data, cb) => {
        captured.push(data);
        // Nothing reaches the wire, but the sender still has to be released.
        if (cb) cb();
        return Promise.resolve();
    };

    return { captured, deliver: original, restore: () => { socket.send = original; } };
}

test("the negotiated suite is the modern one", async (t) => {
    const link = await pair(t);
    await link.clientPeer.e2e();

    assert.deepEqual(link.clientPeer.e2eInfo(), {
        protocolVersion: 1,
        kex: "x25519",
        cipher: "aes-256-gcm"
    });
});

test("e2e() resolves once the channel is live", async (t) => {
    const link = await pair(t);

    const resolved = await link.clientPeer.e2e();
    assert.ok(resolved, "e2e() should resolve with the peer");
    assert.ok(link.clientPeer.isE2EEnabled());
});

test("both ends derive the same channel binding", async (t) => {
    const link = await pair(t);
    await link.clientPeer.e2e();
    await wait(50);

    const a = link.clientPeer.getChannelBinding();
    const b = link.serverPeer.getChannelBinding();

    assert.equal(a.length, 32);
    assert.equal(hex(a), hex(b), "the two ends must agree on the binding");
});

test("the binding is unique per connection", async (t) => {
    const first = await pair(t);
    const second = await pair(t);
    await first.clientPeer.e2e();
    await second.clientPeer.e2e();

    assert.notEqual(
        hex(first.clientPeer.getChannelBinding()),
        hex(second.clientPeer.getChannelBinding())
    );
});

test("there is no binding before e2e", async (t) => {
    const link = await pair(t);
    assert.equal(link.clientPeer.getChannelBinding(), null);
    assert.equal(link.clientPeer.e2eInfo(), null);
});

// Either end may start, and both may start at once: the offers simply cross.
test("both ends calling e2e() at once still converges", async (t) => {
    const link = await pair(t);

    const [a, b] = await Promise.all([link.clientPeer.e2e(), link.serverPeer.e2e()]);
    assert.ok(a && b);

    assert.ok(link.clientPeer.isE2EEnabled());
    assert.ok(link.serverPeer.isE2EEnabled());
    assert.equal(
        hex(link.clientPeer.getChannelBinding()),
        hex(link.serverPeer.getChannelBinding())
    );

    const received = new Promise((resolve) => link.server.once("message", (packet) => resolve(packet.msg)));
    await link.clientPeer.send({ still: "fine" });
    assert.deepEqual(await received, { still: "fine" });
});

test("a repeated e2e() returns the same settled promise", async (t) => {
    const link = await pair(t);

    const first = link.clientPeer.e2e();
    const second = link.clientPeer.e2e();
    assert.equal(first, second, "the same promise should be handed back");

    await first;
    await link.clientPeer.e2e();
    assert.ok(link.clientPeer.isE2EEnabled());
});

test("traffic flows both ways over the encrypted channel", async (t) => {
    const link = await pair(t);
    await link.clientPeer.e2e();

    for (const dir of [
        { from: link.clientPeer, at: link.server, name: "client -> server" },
        { from: link.serverPeer, at: link.client, name: "server -> client" }
    ]) {
        const received = new Promise((resolve) => dir.at.once("message", (packet) => resolve(packet.msg)));
        await dir.from.send({ hello: dir.name });
        assert.deepEqual(await received, { hello: dir.name }, dir.name);
    }
});

test("many messages in a row keep their counters in step", async (t) => {
    const link = await pair(t);
    await link.clientPeer.e2e();

    const seen = [];
    link.server.on("message", (packet) => seen.push(packet.msg.n));
    for (let n = 0; n < 50; n++) await link.clientPeer.send({ n });
    await wait(200);

    assert.deepEqual(seen, Array.from({ length: 50 }, (_, i) => i));
});

// AES-GCM authenticates the frame header alongside the payload, so neither can
// be touched without the frame failing to open.
test("an altered payload is rejected", async (t) => {
    const link = await pair(t);
    await link.clientPeer.e2e();

    const wire = intercept(link.clientPeer);
    await link.clientPeer.send({ tamper: "me" });
    await wait(50);
    assert.equal(wire.captured.length, 1);

    const frame = Frame.asBytes(wire.captured[0]).slice();
    frame[frame.length - 1] ^= 0xff;

    const gone = new Promise((resolve) => link.server.on("disconnected", (_p, reason) => resolve(reason)));
    wire.deliver(frame);
    assert.match(String(await gone), /invalid encrypted frame/i);
});

test("an altered header is rejected", async (t) => {
    const link = await pair(t);
    await link.clientPeer.e2e();

    const wire = intercept(link.clientPeer);
    await link.clientPeer.send({ tamper: "header" });
    await wait(50);

    const frame = Frame.asBytes(wire.captured[0]).slice();
    frame[1] = constants.PACKET_TYPE.INTERNAL; // was LINK

    const gone = new Promise((resolve) => link.server.on("disconnected", (_p, reason) => resolve(reason)));
    wire.deliver(frame);
    assert.match(String(await gone), /invalid encrypted frame/i);
});

test("a replayed frame is rejected", async (t) => {
    const link = await pair(t);
    await link.clientPeer.e2e();

    const wire = intercept(link.clientPeer);
    await link.clientPeer.send({ n: 1 });
    await wait(20);

    const frame = wire.captured[0];
    wire.deliver(frame);
    await wait(50);

    const gone = new Promise((resolve) => link.server.on("disconnected", (_p, reason) => resolve(reason)));
    wire.deliver(frame); // the same frame a second time
    assert.match(String(await gone), /invalid encrypted frame/i);
});

test("frames arriving out of order are rejected", async (t) => {
    const link = await pair(t);
    await link.clientPeer.e2e();

    const wire = intercept(link.clientPeer);
    await link.clientPeer.send({ n: 1 });
    await link.clientPeer.send({ n: 2 });
    await wait(50);
    assert.equal(wire.captured.length, 2);

    const gone = new Promise((resolve) => link.server.on("disconnected", (_p, reason) => resolve(reason)));
    wire.deliver(wire.captured[1]); // the second frame first
    assert.match(String(await gone), /invalid encrypted frame/i);
});

// Once the channel is encrypted, anything in clear is an injection attempt.
test("a plaintext frame after e2e is rejected", async (t) => {
    const link = await pair(t);
    await link.clientPeer.e2e();

    const wire = intercept(link.clientPeer);
    const gone = new Promise((resolve) => link.server.on("disconnected", (_p, reason) => resolve(reason)));

    wire.deliver(Frame.encode({
        flags: Frame.FLAGS.FINAL,
        type: constants.PACKET_TYPE.LINK,
        seq: 500,
        payload: Frame.bytes(JSON.stringify({ injected: true }))
    }));

    assert.match(String(await gone), /invalid encrypted frame/i);
});

test("an encrypted frame before e2e is rejected", async (t) => {
    const link = await pair(t);

    const gone = new Promise((resolve) => link.server.on("disconnected", (_p, reason) => resolve(reason)));
    rawSocket(link.clientPeer).send(Frame.encode({
        flags: Frame.FLAGS.FINAL | Frame.FLAGS.ENCRYPTED,
        type: constants.PACKET_TYPE.LINK,
        seq: 1,
        payload: Frame.bytes("whatever")
    }));

    assert.match(String(await gone), /invalid encrypted frame/i);
});

// ---- the primitives, on their own -----------------------------------------

test("the suite choice is a function of both lists, not of who asked", async (t) => {
    assert.equal(E2E.chooseKex(["x25519", "p256"], ["p256", "x25519"]), "x25519");
    assert.equal(E2E.chooseKex(["p256", "x25519"], ["x25519", "p256"]), "x25519");
    assert.equal(E2E.chooseKex(["x25519"], ["p256"]), null);
    assert.equal(E2E.chooseKex(["p256"], ["p256", "x25519"]), "p256",
        "an end without x25519 must still land on a shared exchange");

    assert.equal(E2E.chooseCipher(["aes-256-gcm"], ["aes-256-gcm"]), "aes-256-gcm");
    assert.equal(E2E.chooseCipher([], ["aes-256-gcm"]), null);
    assert.equal(E2E.chooseCipher(["made-up"], ["made-up"]), null,
        "a cipher we do not implement must never be chosen");
});

test("this runtime offers x25519 with p256 behind it", async (t) => {
    const supported = await E2E.supportedKex();
    assert.ok(supported.indexOf("p256") != -1, "p256 is the fallback and must always be there");
    assert.deepEqual(supported, supported.slice().sort((a, b) => E2E.KEX.indexOf(a) - E2E.KEX.indexOf(b)));
});

/** Both halves of an exchange, derived as the two ends would. */
async function deriveBoth(kex, overrides = {}) {
    const a = await E2E.createOffer({ kex: [kex] });
    const b = await E2E.createOffer({ kex: [kex] });

    const common = Object.assign({
        kex: kex,
        cipher: "aes-256-gcm",
        protocolVersion: 1,
        capabilities: []
    }, overrides);

    const left = await E2E.derive(Object.assign({}, common, {
        localID: "alice", remoteID: "bob",
        localPrivateKey: a.privates[kex],
        localPublicKey: Frame.fromBase64(a.wire.keys[kex]),
        localNonce: a.nonce,
        remotePublicKey: Frame.fromBase64(b.wire.keys[kex]),
        remoteNonce: b.nonce
    }));

    const right = await E2E.derive(Object.assign({}, common, {
        localID: "bob", remoteID: "alice",
        localPrivateKey: b.privates[kex],
        localPublicKey: Frame.fromBase64(b.wire.keys[kex]),
        localNonce: b.nonce,
        remotePublicKey: Frame.fromBase64(a.wire.keys[kex]),
        remoteNonce: a.nonce
    }));

    return { left, right };
}

test("the p256 fallback derives a working channel", async (t) => {
    const { left, right } = await deriveBoth("p256");

    assert.equal(hex(left.binding), hex(right.binding));
    assert.equal(left.kex, "p256");

    const header = new Uint8Array([1, 3, 0, 0, 0, 1]);
    const sealed = await E2E.seal(left.sendKey, 0, header, Frame.bytes("hello"));
    assert.equal(Frame.text(await E2E.open(right.recvKey, 0, header, sealed)), "hello");
});

test("x25519 derives a working channel in both directions", async (t) => {
    const { left, right } = await deriveBoth("x25519");
    const header = new Uint8Array([1, 3, 0, 0, 0, 7]);

    const there = await E2E.seal(left.sendKey, 0, header, Frame.bytes("ping"));
    assert.equal(Frame.text(await E2E.open(right.recvKey, 0, header, there)), "ping");

    const back = await E2E.seal(right.sendKey, 0, header, Frame.bytes("pong"));
    assert.equal(Frame.text(await E2E.open(left.recvKey, 0, header, back)), "pong");
});

test("each direction has its own key", async (t) => {
    const { left } = await deriveBoth("x25519");
    const header = new Uint8Array([1, 3, 0, 0, 0, 1]);
    const sealed = await E2E.seal(left.sendKey, 0, header, Frame.bytes("secret"));

    // What we send cannot be opened with the key we receive on.
    await assert.rejects(E2E.open(left.recvKey, 0, header, sealed));
});

// Forcing a connection onto a weaker version changes the transcript, so the
// binding changes and an application comparing bindings notices.
test("a downgraded connection derives a different binding", async (t) => {
    const strong = await deriveBoth("x25519", { protocolVersion: 1 });
    const weak = await deriveBoth("x25519", { protocolVersion: 0 });

    assert.notEqual(hex(strong.left.binding), hex(weak.left.binding));
});

test("different capabilities derive a different binding", async (t) => {
    const withCaps = await deriveBoth("x25519", { capabilities: ["something"] });
    const without = await deriveBoth("x25519", { capabilities: [] });

    assert.notEqual(hex(withCaps.left.binding), hex(without.left.binding));
});

test("every counter gives a different nonce", async (t) => {
    const seen = new Set();
    for (const counter of [0, 1, 2, 255, 256, 0xffffffff, 0x100000000]) {
        const nonce = hex(E2E.nonceFor(counter));
        assert.equal(nonce.length / 2, E2E.NONCE_BYTES);
        assert.ok(!seen.has(nonce), "counter " + counter + " reused a nonce");
        seen.add(nonce);
    }
});

test("opening with the wrong counter fails", async (t) => {
    const { left, right } = await deriveBoth("x25519");
    const header = new Uint8Array([1, 3, 0, 0, 0, 1]);
    const sealed = await E2E.seal(left.sendKey, 5, header, Frame.bytes("x"));

    await assert.rejects(E2E.open(right.recvKey, 6, header, sealed));
    assert.equal(Frame.text(await E2E.open(right.recvKey, 5, header, sealed)), "x");
});

test("opening with a different header fails", async (t) => {
    const { left, right } = await deriveBoth("x25519");
    const sealed = await E2E.seal(left.sendKey, 0, new Uint8Array([1, 3, 0, 0, 0, 1]), Frame.bytes("x"));

    await assert.rejects(E2E.open(right.recvKey, 0, new Uint8Array([1, 2, 0, 0, 0, 1]), sealed));
});

// A 0.4.x peer cannot do any of the above, so that link keeps the old
// exchange and cipher — and says so, rather than claiming the new suite.
test("a 0.4.x link reports the old suite and has no binding", async (t) => {
    const LegacyAnySocket = require("anysocket-legacy");
    const { listen, stop, AnySocket } = require("../helpers/loopback");

    const server = new AnySocket();
    const legacy = new LegacyAnySocket();
    t.after(() => stop(server, legacy));

    let serverPeer = null;
    server.on("connected", (peer) => { serverPeer = peer; });

    const port = await listen(server);
    const peer = await legacy.connect("ws", "127.0.0.1", port);
    await wait(150);

    assert.equal(serverPeer.protocolVersion(), constants.PROTOCOL_VERSION_LEGACY);
    assert.equal(serverPeer.e2eInfo(), null, "nothing is encrypted yet");

    const up = new Promise((resolve) => peer.on("e2e", resolve));
    peer.e2e();
    await up;
    await wait(50);

    assert.deepEqual(serverPeer.e2eInfo(), {
        protocolVersion: 0,
        kex: "secp521r1",
        cipher: "aes-256-cbc"
    });
    assert.equal(serverPeer.getChannelBinding(), null,
        "the old exchange has nothing to bind to");
});
