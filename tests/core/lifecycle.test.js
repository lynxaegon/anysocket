const test = require("node:test");
const assert = require("node:assert");
const net = require("net");
const { pair, listen, stop, wait, rawSocket, AnySocket } = require("../helpers/loopback");

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
        const dial = client.connect(scheme, "127.0.0.1", port, { allowInsecureWSFallback: true });
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
    await a.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true });
    await b.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true });
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

// An application that keeps its id across restarts (a node name, say) comes back while the
// other end may still hold the dead process's connection. Both dial the same way, which the
// duplicate rule read as one instance dialling twice: it kept the stale connection, refused
// the new one, and once the stale one closed neither end was connected.
test("a restarted peer replaces the connection its previous instance left behind", async (t) => {
    const listener = new AnySocket();
    const before = new AnySocket();
    const after = new AnySocket();
    before.id = after.id = "same-id-across-restarts";
    t.after(() => stop(listener, before, after));
    const port = await listener.listen("tcp", { port: 0, duplicateProbeTimeout: 300 });

    const old = await before.connect("tcp", "127.0.0.1", port);
    await wait(100);
    rawSocket(old).pause();   // the old process is gone; its socket has not closed yet
    const peer = await after.connect("tcp", "127.0.0.1", port);
    await wait(600);
    assert.equal(listener.getPeer(after.id).remoteInstanceID(), after.instanceID, "the listener kept the old instance");

    await before.stop();   // the old socket finally goes
    await wait(300);
    assert.equal(listener.hasPeer(after.id), true);
    assert.equal(after.hasPeer(listener.id), true);
    listener.setRPC({ ping: () => "pong" });
    assert.equal(await peer.rpc.ping(), "pong");
});

// Taking the restart rule alone, a new instance always won: any client that claimed a
// connected peer's id took its place, and two processes sharing an id evicted each other
// for ever. The connection held is asked first, and kept while it answers.
test("a live peer is not evicted by another instance claiming its id", async (t) => {
    const listener = new AnySocket();
    const first = new AnySocket();
    const second = new AnySocket();
    first.id = second.id = "shared-id";
    t.after(() => stop(listener, first, second));
    const port = await listener.listen("tcp", { port: 0, duplicateProbeTimeout: 300 });

    await first.connect("tcp", "127.0.0.1", port);
    await wait(100);
    await second.connect("tcp", "127.0.0.1", port).catch(() => {});
    await wait(800);

    assert.equal(listener.getPeer(first.id).remoteInstanceID(), first.instanceID);
    assert.equal(first.hasPeer(listener.id), true);
    assert.equal(second.hasPeer(listener.id), false);
});

// Relaying to a peer that has just gone: the frames in flight to it were taken for an
// attack, the sender was dropped, and its queued relayed sends rejected with nothing
// handling them, which ends the process under node's default.
test("a relay whose far end goes mid-transfer drops the frames, not the sender", async (t) => {
    const relay = new AnySocket();
    const a = new AnySocket();
    const b = new AnySocket();
    t.after(() => stop(a, b, relay));
    relay.canProxy = () => true;
    a.canAcceptProxy = b.canAcceptProxy = () => true;
    const unhandled = [];
    const onUnhandled = (e) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    t.after(() => process.off("unhandledRejection", onUnhandled));

    const port = await relay.listen("tcp", { port: 0 });
    await a.connect("tcp", "127.0.0.1", port);
    const bToRelay = await b.connect("tcp", "127.0.0.1", port);
    await wait(150);
    const toB = await a.proxy(b.id, relay.id);

    const chunk = new Uint8Array(1024 * 1024);
    for (let i = 0; i < 40; i++) toB.send(chunk).catch(() => {});
    setTimeout(() => bToRelay.disconnect("b goes away"), 5);
    await wait(1500);

    assert.deepEqual(unhandled, []);
    assert.equal(a.hasPeer(relay.id), true, "the sender was dropped");
    assert.equal(a.hasPeer(b.id), false);
});

// The link closing while an async onAuth ran: the handshake went on to "connected" on a
// connection that was gone, and the peer stayed connected for good.
test("a link that closes during an async onAuth never becomes a peer", async (t) => {
    const server = new AnySocket();
    const client = new AnySocket();
    t.after(() => stop(server, client));
    const port = await server.listen("tcp", { port: 0 });
    server.on("connected", (peer) => peer.disconnect("dropped at once"));
    client.onAuth = async () => { await wait(300); return true; };
    let connected = 0;
    client.on("connected", () => connected++);

    assert.match(await settled(client.connect("tcp", "127.0.0.1", port)), /^rejected/);
    await wait(300);
    assert.equal(connected, 0);
    assert.equal(client.hasPeer(server.id), false);
});

// A send waiting for the tcp socket to drain never settled if the socket closed first.
test("a tcp send waiting on a full socket settles when the link drops", async (t) => {
    const server = new AnySocket();
    const client = new AnySocket();
    t.after(() => stop(server, client));
    const port = await server.listen("tcp", { port: 0 });
    const serverSide = new Promise((resolve) => server.once("connected", resolve));
    const peer = await client.connect("tcp", "127.0.0.1", port, { sendHighWaterMark: 1 });
    rawSocket(await serverSide).pause();

    const sent = peer.send(new Uint8Array(20 * 1024 * 1024));
    await wait(300);
    peer.disconnect("bye");
    assert.match(await settled(sent), /^rejected/);
});

test("the same instance dialling twice still keeps its first connection", async (t) => {
    const listener = new AnySocket();
    const client = new AnySocket();
    t.after(() => stop(listener, client));
    const port = await listener.listen("tcp", { port: 0 });
    const first = await client.connect("tcp", "127.0.0.1", port);
    const second = await client.connect("tcp", "127.0.0.1", port);
    await wait(200);
    assert.equal(second, first, "the second dial resolves with the kept connection");
    assert.equal(client.hasPeer(listener.id), true);
    assert.equal(listener.hasPeer(client.id), true);
});
