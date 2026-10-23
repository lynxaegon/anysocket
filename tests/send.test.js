const test = require("node:test");
const assert = require("node:assert");
const { pair, AnySocket, wait } = require("./helpers/loopback");

test("a message arrives at the other side", async (t) => {
    const link = await pair(t);
    const received = new Promise((resolve) => link.server.on("message", (packet) => resolve(packet.msg)));

    await link.clientPeer.send({ hello: "world" });
    assert.deepEqual(await received, { hello: "world" });

    await link.stop();
});

// Regression: a send() without awaitReply never settled, so awaiting one hung.
test("send() resolves once the packet is on the wire", async (t) => {
    const link = await pair(t);

    await assert.doesNotReject(
        Promise.race([
            link.clientPeer.send({ fire: "and-forget" }),
            wait(1000).then(() => Promise.reject(new Error("send() never settled")))
        ])
    );

    await link.stop();
});

test("send() rejects on a disconnected peer", async (t) => {
    const link = await pair(t);
    link.clientPeer.disconnect("test");

    await assert.rejects(link.clientPeer.send({ nope: true }));
    await link.stop();
});

test("request/reply round-trips", async (t) => {
    const link = await pair(t);
    link.server.on("message", (packet) => packet.reply({ pong: packet.msg.ping }));

    const reply = await link.clientPeer.send({ ping: 42 }, true);
    assert.deepEqual(reply.msg, { pong: 42 });

    await link.stop();
});

// Regression: broadcast() awaited inside its own loop and never settled when
// the instance had no peers at all.
test("broadcast() resolves with no peers", async (t) => {
    const lonely = new AnySocket();

    const result = await Promise.race([
        lonely.broadcast({ anyone: "there?" }),
        wait(1000).then(() => Promise.reject(new Error("broadcast() never settled")))
    ]);

    assert.deepEqual(result, []);
    await lonely.stop();
});

test("broadcast() reaches every peer and resolves", async (t) => {
    const link = await pair(t);
    const seen = [];
    link.server.on("message", (packet) => seen.push(packet.msg));
    link.client.on("message", (packet) => seen.push(packet.msg));

    await link.server.broadcast({ to: "all" });
    await wait(100);

    assert.deepEqual(seen, [{ to: "all" }]);
    await link.stop();
});
