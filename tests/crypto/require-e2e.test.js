const test = require("node:test");
const assert = require("node:assert");
const constants = require("../../src/libs/_constants");
const Frame = require("../../src/libs/Frame");
const { listen, stop, wait, rawSocket, AnySocket } = require("../helpers/loopback");

async function link(t, serverOptions, clientOptions, ctor = {}) {
    const server = new AnySocket(ctor.server);
    const client = new AnySocket(ctor.client);
    t.after(() => stop(server, client));

    let serverPeer = null;
    server.on("connected", (p) => { if (p.id === client.id) serverPeer = p; });

    const port = await listen(server, serverOptions);
    const clientPeer = await client.connect("ws", "127.0.0.1", port, Object.assign({ allowInsecureWSFallback: true }, clientOptions));
    await wait(50);
    return { server, client, clientPeer, serverPeer: () => serverPeer };
}

// The point: a peer handed to the application is never one it could talk to
// in clear.
test("with requireE2E, a peer is already encrypted when it is handed over", async (t) => {
    const server = new AnySocket();
    const client = new AnySocket();
    t.after(() => stop(server, client));

    let encryptedOnArrival = null;
    server.on("connected", (p) => { encryptedOnArrival = p.isE2EEnabled(); });

    const port = await listen(server, { requireE2E: true });
    const peer = await client.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true, requireE2E: true });

    assert.equal(peer.isE2EEnabled(), true, "connect() should resolve only once encrypted");
    await wait(30);
    assert.equal(encryptedOnArrival, true, "\"connected\" should only fire once encrypted");
});

// Either end asking is enough: the requirement travels in the handshake, so a
// peer that did not configure it still waits instead of talking in clear.
test("one end requiring it is enough", async (t) => {
    for (const [s, c] of [[{ requireE2E: true }, {}], [{}, { requireE2E: true }]]) {
        const l = await link(t, s, c);
        assert.ok(l.clientPeer.isE2EEnabled(), "dialler not encrypted");
        assert.ok(l.serverPeer() && l.serverPeer().isE2EEnabled(), "listener not encrypted");
    }
});

test("traffic flows normally once up", async (t) => {
    const l = await link(t, { requireE2E: true }, { requireE2E: true });

    const atServer = new Promise((resolve) => l.server.once("message", (p) => resolve(p.msg)));
    await l.clientPeer.send({ hello: "encrypted" });
    assert.deepEqual(await atServer, { hello: "encrypted" });
});

test("it composes with the built-in auth: authenticated and encrypted on arrival", async (t) => {
    const ctor = { server: { auth: { secret: "s" } }, client: { auth: { secret: "s" } } };
    const l = await link(t, { requireE2E: true }, { requireE2E: true }, ctor);

    assert.equal(l.clientPeer.isAuthenticated(), true);
    assert.equal(l.clientPeer.e2eInfo().authenticated, true, "and the channel is bound to the secret");
});

// A frame that arrives in clear on such a connection is a peer breaking the
// rule. It is refused, not delivered once encryption happens to be up.
test("an application message sent in clear is refused", async (t) => {
    const l = await link(t, { requireE2E: true }, { requireE2E: true });
    const gone = new Promise((resolve) => l.server.on("disconnected", (_p, reason) => resolve(reason)));

    rawSocket(l.clientPeer).send(Frame.encode({
        flags: Frame.FLAGS.FINAL | Frame.FLAGS.FIRST,
        type: constants.PACKET_TYPE.LINK,
        seq: 77,
        payload: Frame.bytes(JSON.stringify({ sneaky: true }))
    }));

    assert.match(String(await gone), /(plaintext|invalid encrypted frame)/i);
});

test("e2e that cannot be agreed fails the connection rather than leaving it in clear", async (t) => {
    const server = new AnySocket();
    const client = new AnySocket();
    t.after(() => stop(server, client));

    const port = await listen(server, { requireE2E: true, e2eCiphers: ["aes-256-gcm"] });
    await assert.rejects(
        client.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true, requireE2E: true, e2eCiphers: ["chacha20-poly1305"] }),
        "a connection that required e2e and could not get it must not come up"
    );
});

// Both ends start the exchange on their own, so the peer's offer can arrive while our keys
// are still being generated. That started a second offer of our own; the two ends derived
// keys from different ones and the first encrypted frame failed to open. Under load, with
// key generation slow, this dropped a few handshakes in a hundred.
test("an offer that arrives while ours is still being made does not start a second one", async (t) => {
    const E2E = require("../../src/libs/E2E");
    const createOffer = E2E.createOffer;
    let made = 0;
    // The first end to start is slow, so the other end's offer always lands mid-way.
    E2E.createOffer = async (...args) => { if (made++ === 0) await wait(300); return createOffer(...args); };
    t.after(() => { E2E.createOffer = createOffer; });

    const l = await link(t, { requireE2E: true }, { requireE2E: true });
    assert.equal(made, 2, "one offer per end");
    const atServer = new Promise((resolve) => l.server.once("message", (p) => resolve(p.msg)));
    await l.clientPeer.send({ hello: "encrypted" });
    assert.deepEqual(await atServer, { hello: "encrypted" });
});
