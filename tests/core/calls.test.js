const test = require("node:test");
const assert = require("node:assert");
const { pair, listen, stop, wait, AnySocket } = require("../helpers/loopback");

const slow = (ms) => () => new Promise((resolve) => setTimeout(() => resolve("done"), ms));

// ---- per-call options -------------------------------------------------------

// A caller that had to wait longer than replyTimeout could not: the default
// fired first whatever the caller intended.
test("rpcWith({ timeout }) can wait longer than replyTimeout", async (t) => {
    const link = await pair(t, {
        configure: (server) => server.setRPC({ slow: slow(400) }),
        connect: { replyTimeout: 150 }
    });

    await assert.rejects(link.clientPeer.rpc.slow(), (e) => e.code === "ETIMEOUT",
        "the default timeout should still apply to a plain call");

    assert.equal(await link.clientPeer.rpcWith({ timeout: 2000 }).slow(), "done");
});

test("rpcWith({ timeout }) can also give up sooner", async (t) => {
    const link = await pair(t, { configure: (server) => server.setRPC({ slow: slow(2000) }) });

    const started = Date.now();
    await assert.rejects(link.clientPeer.rpcWith({ timeout: 150 }).slow(), (e) => e.code === "ETIMEOUT");
    assert.ok(Date.now() - started < 1500, "it should give up near the short timeout");
});

test("rpcWith works on nested methods", async (t) => {
    const link = await pair(t, { configure: (server) => server.setRPC({ a: { b: { c: (x) => x * 2 } } }) });
    assert.equal(await link.clientPeer.rpcWith({ timeout: 1000 }).a.b.c(21), 42);
});

test("an AbortSignal cancels a call", async (t) => {
    const link = await pair(t, { configure: (server) => server.setRPC({ slow: slow(3000) }) });
    const controller = new AbortController();

    const call = link.clientPeer.rpcWith({ signal: controller.signal }).slow();
    setTimeout(() => controller.abort("changed my mind"), 100);

    await assert.rejects(call, (e) => {
        assert.equal(e.code, "EABORTED");
        assert.equal(e.reason, "changed my mind");
        return true;
    });
});

test("an already-aborted signal fails the call at once", async (t) => {
    const link = await pair(t, { configure: (server) => server.setRPC({ slow: slow(3000) }) });
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(link.clientPeer.rpcWith({ signal: controller.signal }).slow(), (e) => e.code === "EABORTED");
});

test("aborting one call leaves the connection and other calls alone", async (t) => {
    const link = await pair(t, { configure: (server) => server.setRPC({ slow: slow(3000), quick: () => "ok" }) });
    const controller = new AbortController();

    const doomed = link.clientPeer.rpcWith({ signal: controller.signal }).slow();
    controller.abort();
    await assert.rejects(doomed);

    assert.equal(await link.clientPeer.rpc.quick(), "ok");
    assert.ok(link.client.hasPeer(link.server.id));
});

// ---- typed errors -------------------------------------------------------------

test("errors carry a code, and keep the message they always had", async (t) => {
    const link = await pair(t, {
        configure: (server) => server.setRPC({ never: () => new Promise(() => {}) }),
        connect: { replyTimeout: 120 }
    });

    const timedOut = await link.clientPeer.rpc.never().then(() => null, (e) => e);
    assert.ok(timedOut instanceof AnySocket.Error);
    assert.equal(timedOut.code, AnySocket.ERRORS.TIMEOUT);
    assert.equal(timedOut.message, "Timeout!", "the message is unchanged, so text matching keeps working");

    await link.client.stop();
    const gone = await link.clientPeer.send({ x: 1 }).then(() => null, (e) => e);
    assert.equal(gone.code, AnySocket.ERRORS.NOT_CONNECTED);
    assert.match(gone.message, /Cannot send/);
});

test("a call pending when the peer goes away rejects with EDISCONNECTED", async (t) => {
    const link = await pair(t, { configure: (server) => server.setRPC({ never: () => new Promise(() => {}) }) });

    const pending = link.clientPeer.rpc.never().then(() => null, (e) => e);
    await wait(50);
    link.clientPeer.disconnect("going");

    const e = await pending;
    assert.equal(e.code, AnySocket.ERRORS.DISCONNECTED);
});

test("the codes are exported", (t) => {
    assert.deepEqual(Object.keys(AnySocket.ERRORS).sort(),
        ["ABORTED", "CONNECTION_FAILED", "DISCONNECTED", "NOT_CONNECTED", "REFUSED", "RPC_FAILED", "RPC_FORBIDDEN", "RPC_NOT_FOUND", "SUPERSEDED", "TIMEOUT"]);
});

// ---- self-connection ----------------------------------------------------------

// An address list that includes our own address dials ourselves. Nothing useful
// can come of it, and left alone it would reach the duplicate rule with both
// ends being the same instance.
test("a connection to ourselves is refused", async (t) => {
    const node = new AnySocket();
    t.after(() => stop(node));

    const port = await listen(node);
    await assert.rejects(node.connect("ws", "127.0.0.1", port));

    await wait(100);
    assert.equal(node.hasPeer(node.id), false, "we must not end up as our own peer");
});
