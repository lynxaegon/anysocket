const test = require("node:test");
const assert = require("node:assert");
const { pair } = require("../helpers/loopback");

// Regression: one unanswered call used to tear down the whole connection,
// failing every other in-flight call and any healthy traffic with it.
test("an unanswered call rejects but leaves the connection up", async (t) => {
    const link = await pair(t);
    // The server listens but deliberately never replies to the first message.
    let answer = false;
    link.server.on("message", (packet) => {
        if (answer) packet.reply({ ok: true });
    });

    await assert.rejects(link.clientPeer.send({ ping: 1 }, true, 150));

    assert.ok(link.client.hasPeer(link.server.id), "the peer should still be connected");

    answer = true;
    const reply = await link.clientPeer.send({ ping: 2 }, true, 1000);
    assert.deepEqual(reply.msg, { ok: true });

    await link.stop();
});

test("a second in-flight call survives the first one timing out", async (t) => {
    const link = await pair(t);
    link.server.on("message", (packet) => {
        if (packet.msg.slow) return; // never answered
        packet.reply({ echo: packet.msg });
    });

    const timingOut = link.clientPeer.send({ slow: true }, true, 150);
    const healthy = link.clientPeer.send({ fast: true }, true, 1000);

    await assert.rejects(timingOut);
    assert.deepEqual((await healthy).msg, { echo: { fast: true } });

    await link.stop();
});

test("disconnectOnReplyTimeout restores the pre-1.0 behaviour", async (t) => {
    const link = await pair(t, { connect: { disconnectOnReplyTimeout: true } });
    link.server.on("message", () => { /* never replies */ });

    const gone = new Promise((resolve) => link.client.on("disconnected", (_peer, reason) => resolve(reason)));
    await assert.rejects(link.clientPeer.send({ ping: 1 }, true, 150));

    assert.match(String(await gone), /reply timeout/i);
    await link.stop();
});
