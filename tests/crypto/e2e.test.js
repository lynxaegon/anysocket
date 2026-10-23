const test = require("node:test");
const assert = require("node:assert");
const { pair, wait } = require("../helpers/loopback");

const encrypted = (peer) => new Promise((resolve) => peer.on("e2e", resolve));

test("e2e() encrypts the link and messages still flow", async (t) => {
    const link = await pair(t);
    const up = encrypted(link.clientPeer);

    link.clientPeer.e2e();
    await up;

    assert.ok(link.clientPeer.isE2EEnabled());

    const received = new Promise((resolve) => link.server.on("message", (packet) => resolve(packet.msg)));
    await link.clientPeer.send({ secret: "shh" });
    assert.deepEqual(await received, { secret: "shh" });

    await link.stop();
});

test("request/reply works over an encrypted link", async (t) => {
    const link = await pair(t);
    link.server.on("message", (packet) => packet.reply({ pong: packet.msg.ping }));

    const up = encrypted(link.clientPeer);
    link.clientPeer.e2e();
    await up;

    const reply = await link.clientPeer.send({ ping: "x" }, true);
    assert.deepEqual(reply.msg, { pong: "x" });

    await link.stop();
});

// Regression: a second e2e() started another key exchange and desynced the ends.
test("calling e2e() twice from one side is a no-op", async (t) => {
    const link = await pair(t);
    const up = encrypted(link.clientPeer);

    link.clientPeer.e2e();
    link.clientPeer.e2e();
    await up;

    await wait(150);
    assert.ok(link.clientPeer.isE2EEnabled());
    assert.ok(link.client.hasPeer(link.server.id), "the connection should have survived");

    const received = new Promise((resolve) => link.server.on("message", (packet) => resolve(packet.msg)));
    await link.clientPeer.send({ still: "working" });
    assert.deepEqual(await received, { still: "working" });

    await link.stop();
});

test("e2e() after the link is already encrypted is a no-op", async (t) => {
    const link = await pair(t);
    const up = encrypted(link.clientPeer);
    link.clientPeer.e2e();
    await up;

    link.clientPeer.e2e();
    await wait(150);

    assert.ok(link.clientPeer.isE2EEnabled());
    const received = new Promise((resolve) => link.server.on("message", (packet) => resolve(packet.msg)));
    await link.clientPeer.send({ ok: true });
    assert.deepEqual(await received, { ok: true });

    await link.stop();
});

test("a large message survives chunking over an encrypted link", async (t) => {
    const link = await pair(t);
    const up = encrypted(link.clientPeer);
    link.clientPeer.e2e();
    await up;

    const big = "x".repeat(1024 * 1024 + 512);
    const received = new Promise((resolve) => link.server.on("message", (packet) => resolve(packet.msg)));
    await link.clientPeer.send({ big });

    assert.equal((await received).big.length, big.length);
    await link.stop();
});
