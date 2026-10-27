const test = require("node:test");
const assert = require("node:assert");
const Frame = require("../../src/libs/Frame");
const Packet = require("../../src/libs/Packet");
const { stop, wait, protocolOf, AnySocket } = require("../helpers/loopback");

/**
 * Switching encryption on while the link is busy. Both ends turn it on as soon as they
 * have each other's offer, so what either sends between its own offer and its keys being
 * ready must wait: sent in clear, the other end refuses it.
 */
for (const scheme of ["tcp", "ws"]) {
    test(scheme + ": e2e() while a large message is in flight delivers it, encrypted", async (t) => {
        const server = new AnySocket();
        const client = new AnySocket();
        t.after(() => stop(server, client));
        const port = await server.listen(scheme, { port: 0 });
        const dropped = [];
        server.on("disconnected", (_p, reason) => dropped.push("server: " + reason));
        client.on("disconnected", (_p, reason) => dropped.push("client: " + reason));
        const received = new Promise((resolve) => server.on("message", (packet) => resolve(packet.msg)));

        const peer = await client.connect(scheme, "127.0.0.1", port, { allowInsecureWSFallback: true });
        const big = new Uint8Array(64 * 1024 * 1024).fill(7);
        const sending = peer.send(big);
        await peer.e2e();
        await sending;

        const got = await received;
        assert.equal(got.length, big.length);
        assert.equal(got[got.length - 1], 7);
        await wait(200);
        assert.deepEqual(dropped, []);
        assert.equal(peer.isE2EEnabled(), true);
    });
}

// A second offer once encryption is up would reuse our ephemeral key with the counters
// back at 0: replaying the peer's first offer derives the same keys, and nonces repeat.
test("an e2e offer after e2e was established drops the connection", async (t) => {
    const server = new AnySocket();
    const client = new AnySocket();
    t.after(() => stop(server, client));
    const port = await server.listen("tcp", { port: 0 });
    const serverSide = new Promise((resolve) => server.once("connected", resolve));
    const peer = await client.connect("tcp", "127.0.0.1", port);
    const serverPeer = await serverSide;
    const serverE2E = new Promise((resolve) => serverPeer.once("e2e", resolve));
    await peer.e2e();
    await serverE2E;

    const gone = new Promise((resolve) => server.once("disconnected", (_p, reason) => resolve(reason)));
    // Sent through the protocol, so it is sealed like any frame and reaches the
    // exchange rather than failing to open.
    const offer = { v: 1, kex: ["x25519"], ciphers: ["aes-256-gcm"], keys: { x25519: Frame.toBase64(new Uint8Array(32)) }, nonce: Frame.toBase64(new Uint8Array(32)) };
    protocolOf(peer).send(Packet.data(offer).setType(Packet.TYPE.SWITCH)).catch(() => {});

    assert.match(String(await gone), /e2e offer after e2e/);
});
