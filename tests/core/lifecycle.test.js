const test = require("node:test");
const assert = require("node:assert");
const net = require("net");
const { pair, listen, stop, wait, AnySocket } = require("../helpers/loopback");

/**
 * Connections end cleanly: nothing waits forever on one that has gone, and nothing
 * outlives what it depended on.
 */
const settled = (p, ms = 2000) => Promise.race([
    p.then(() => "resolved", (e) => "rejected: " + (e && e.message || e)),
    wait(ms).then(() => "pending")
]);

test("a send() in flight when the link drops settles", async (t) => {
    const link = await pair(t);
    const sent = link.clientPeer.send({ hello: 1 });
    link.clientPeer.disconnect("local drop");
    assert.notEqual(await settled(sent), "pending");
});

test("a large send() settles when the other end drops mid-transfer", async (t) => {
    const link = await pair(t, { connect: { maxPacketSize: 64 * 1024 } });
    const sent = link.clientPeer.send(new Uint8Array(64 * 1024 * 1024));
    await wait(20);
    link.serverPeer.disconnect("remote drop");
    assert.notEqual(await settled(sent), "pending");
});

test("a send() on a peer that has gone rejects", async (t) => {
    const link = await pair(t);
    link.clientPeer.disconnect("gone");
    await wait(50);
    assert.match(await settled(link.clientPeer.send({ late: 1 })), /^rejected/);
});

test("AnyPeer emits disconnected", async (t) => {
    const link = await pair(t);
    const reasons = [];
    link.clientPeer.on("disconnected", (peer, reason) => reasons.push(reason));
    link.serverPeer.disconnect("bye");
    await wait(300);
    assert.equal(reasons.length, 1);
});

for (const scheme of ["ws", "tcp"]) {
    test(scheme + ": stop() during a connect() leaves nothing connected", async (t) => {
        const server = new AnySocket();
        const client = new AnySocket();
        t.after(() => stop(server, client));
        const port = scheme == "ws" ? await listen(server) : await server.listen("tcp", { port: 0 });
        const dial = client.connect(scheme, "127.0.0.1", port);
        dial.catch(() => {});
        await client.stop();
        assert.match(await settled(dial, 1000), /^rejected/);
        await wait(300);
        assert.equal(client.hasPeer(server.id), false);
        assert.equal(server.hasPeer(client.id), false);
    });
}

test("stop() during a maintain() dial leaves nothing connected", async (t) => {
    const server = new AnySocket();
    const client = new AnySocket();
    t.after(() => stop(server, client));
    const port = await listen(server);
    client.maintain("ws", "127.0.0.1", port);
    await client.stop();
    await wait(500);
    assert.equal(client.hasPeer(server.id), false);
});

// The dialler cleared its auth timeout on sending its AUTH, so a dial to an endpoint that
// accepts but never answers hung, and so did a maintain() on it.
test("a dial to an endpoint that never answers its AUTH times out, and maintain() retries", async (t) => {
    const sockets = [];
    const mute = net.createServer((s) => sockets.push(s));
    await new Promise((r) => mute.listen(0, "127.0.0.1", r));
    const client = new AnySocket();
    t.after(async () => { await stop(client); sockets.forEach((s) => s.destroy()); mute.close(); });

    assert.match(await settled(client.connect("tcp", "127.0.0.1", mute.address().port, { authTimeout: 300 })), /auth timed out/);

    const link = client.maintain("tcp", "127.0.0.1", mute.address().port, { authTimeout: 300 }, { minDelay: 50 });
    const retries = [];
    link.on("retry", (e) => retries.push(String(e.error)));
    await wait(1500);
    assert.ok(retries.length >= 2, "maintain() never retried: " + JSON.stringify(retries));
});

test("maintain() gives each dial a connect timeout unless one is set", async (t) => {
    const client = new AnySocket();
    t.after(() => stop(client));
    const seen = [];
    client.connect = (scheme, ip, port, options) => { seen.push(options.connectTimeout); return new Promise(() => {}); };
    client.maintain("ws", "127.0.0.1", 1).stop();
    client.maintain("ws", "127.0.0.1", 1, { connectTimeout: 1234 }).stop();
    assert.equal(seen.length, 2);
    assert.ok(seen[0] > 0, "no default connect timeout");
    assert.equal(seen[1], 1234);
});

test("a relayed peer goes down with its relay", async (t) => {
    const relay = new AnySocket();
    const a = new AnySocket();
    const b = new AnySocket();
    t.after(() => stop(a, b, relay));
    relay.canProxy = () => true;
    b.canAcceptProxy = () => true;
    const port = await listen(relay);
    await a.connect("ws", "127.0.0.1", port);
    await b.connect("ws", "127.0.0.1", port);
    await wait(150);
    const proxied = await a.proxy(b.id, relay.id);
    const gone = [];
    a.on("disconnected", (peer) => gone.push(peer.id));
    await relay.stop();
    await wait(500);
    assert.ok(gone.includes(b.id), "no disconnected event for the relayed peer");
    assert.equal(a.hasPeer(b.id), false);
    assert.match(await settled(proxied.send({ x: 1 })), /^rejected/);
    assert.doesNotThrow(() => proxied.disconnect("bye"));
});
