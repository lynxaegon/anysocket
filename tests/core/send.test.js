const test = require("node:test");
const assert = require("node:assert");
const { pair, listen, stop, AnySocket, wait } = require("../helpers/loopback");

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

// A falsy message became {} on the way out.
test("falsy messages arrive as themselves", async (t) => {
    const link = await pair(t);
    const got = [];
    link.server.on("message", (packet) => got.push(packet.msg));

    for (const message of [0, false, "", null]) await link.clientPeer.send(message);
    await wait(100);
    assert.deepEqual(got, [0, false, "", null]);
});

// send(msg, n) with a number made the message a reply to seq n, so a timeout passed
// in the wrong place went out as a reply. Replies are packet.reply()'s job alone.
test("send() refuses a number where awaitReply goes", async (t) => {
    const link = await pair(t);
    await assert.rejects(link.clientPeer.send({ x: 1 }, 5000), TypeError);
});

test("reply() resolves once sent, and rejects once the peer is gone", async (t) => {
    const link = await pair(t);
    const asked = new Promise((resolve) => link.server.on("message", resolve));
    const answer = link.clientPeer.send({ q: 1 }, true);
    const packet = await asked;

    await packet.reply({ a: 1 });
    assert.deepEqual((await answer).msg, { a: 1 });

    link.serverPeer.disconnect("bye");
    await wait(50);
    await assert.rejects(packet.reply({ late: true }));
});

test("connect() and proxy() reject with AnySocket.Error", async (t) => {
    const server = new AnySocket();
    const client = new AnySocket();
    t.after(() => stop(server, client));
    server.onAuth = () => false;
    const port = await listen(server);

    await assert.rejects(client.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true }), (e) =>
        e instanceof AnySocket.Error && e.code === AnySocket.ERRORS.CONNECTION_FAILED && typeof e.reason === "string");
    await assert.rejects(client.proxy("x", client.id), (e) => e instanceof AnySocket.Error);
});

test("a disconnected reason is text", async (t) => {
    const link = await pair(t);
    const reason = new Promise((resolve) => link.client.on("disconnected", (_p, r) => resolve(r)));
    // An Error reaching the disconnect, as some internal paths pass one.
    link.clientPeer.disconnect(new Error("went wrong"));
    assert.equal(await reason, "went wrong");
});
