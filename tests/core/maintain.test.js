const test = require("node:test");
const assert = require("node:assert");
const { stop, wait, freePort, AnySocket } = require("../helpers/loopback");

const FAST = { minDelay: 40, maxDelay: 200, factor: 2, jitter: 0, stableAfter: 300 };

const once = (emitter, event) => new Promise((resolve) => emitter.once(event, (...args) => resolve(args)));

test("it connects, and reconnects when the link drops", async (t) => {
    const server = new AnySocket();
    const client = new AnySocket();
    t.after(() => stop(client, server));

    const port = await server.listen("tcp", { port: 0 });
    const link = client.maintain("tcp", "127.0.0.1", port, {}, FAST);

    const [first] = await once(link, "connected");
    assert.equal(first.id, server.id);

    // The whole disconnect path runs synchronously, so listen before triggering it.
    const dropped = once(link, "disconnected");
    first.disconnect("dropped on purpose");
    await dropped;

    const [second] = await once(link, "connected");
    assert.equal(second.id, server.id);
    assert.notEqual(second, first, "a fresh connection, not the dead one");
    assert.equal(link.peer, second);
});

test("it waits for a peer that is not up yet, then connects", async (t) => {
    const port = await freePort();
    const client = new AnySocket();
    const server = new AnySocket();
    t.after(() => stop(client, server));

    const link = client.maintain("tcp", "127.0.0.1", port, {}, FAST);
    const [retry] = await once(link, "retry");
    assert.ok(retry.error, "the first dial should fail — nothing is listening yet");

    await server.listen("tcp", { port });
    const [peer] = await once(link, "connected");
    assert.equal(peer.id, server.id);
});

test("backoff grows between failures and stays under maxDelay", async (t) => {
    const port = await freePort();
    const client = new AnySocket();
    t.after(() => stop(client));

    const link = client.maintain("tcp", "127.0.0.1", port, {},
        { minDelay: 20, maxDelay: 100, factor: 2, jitter: 0 });
    const delays = [];
    link.on("retry", (r) => delays.push(r.delay));
    await wait(700);
    link.stop();

    assert.ok(delays.length >= 4, "expected several retries, got " + delays.length);
    assert.deepEqual(delays.slice(0, 4), [20, 40, 80, 100]);
    assert.ok(delays.every((d) => d <= 100));
});

test("giveUpAfter abandons a peer that never comes back", async (t) => {
    const port = await freePort();
    const client = new AnySocket();
    t.after(() => stop(client));

    const link = client.maintain("tcp", "127.0.0.1", port, {}, Object.assign({}, FAST, { giveUpAfter: 250 }));
    const [error] = await once(link, "abandoned");

    assert.ok(error, "it should say why");
    assert.equal(link.active, false);

    let redialled = false;
    link.on("retry", () => { redialled = true; });
    await wait(300);
    assert.equal(redialled, false, "an abandoned handle must not keep dialling");
});

// A peer that dials us already satisfies the target, so it is not dialled back.
test("an inbound connection from the same peer is adopted, not redialled", async (t) => {
    const a = new AnySocket();
    const b = new AnySocket();
    t.after(() => stop(a, b));

    const portA = await a.listen("tcp", { port: 0 });
    const portB = await b.listen("tcp", { port: 0 });

    // a maintains b and learns b's id from the first connection
    const link = a.maintain("tcp", "127.0.0.1", portB, {}, FAST);
    const [first] = await once(link, "connected");
    assert.equal(first.id, b.id);

    // that connection goes; before a redials, b dials a
    let dialled = 0;
    link.on("retry", () => { dialled++; });
    const reconnected = once(link, "connected");
    first.disconnect("dropped");
    await b.connect("tcp", "127.0.0.1", portA);

    const [peer] = await reconnected;
    assert.equal(peer.id, b.id);
    assert.ok(link.peer, "the handle holds the inbound connection");
});

// When two peers keep each other connected they dial each other, and the
// duplicate rule retires one of the two connections. Reading that as a drop and
// redialling would loop forever.
test("two peers maintaining each other settle on one connection", async (t) => {
    const a = new AnySocket();
    const b = new AnySocket();
    t.after(() => stop(a, b));

    const portA = await a.listen("tcp", { port: 0 });
    const portB = await b.listen("tcp", { port: 0 });

    const ab = a.maintain("tcp", "127.0.0.1", portB, {}, FAST);
    const ba = b.maintain("tcp", "127.0.0.1", portA, {}, FAST);

    await wait(800);

    assert.ok(a.hasPeer(b.id) && b.hasPeer(a.id), "both ends connected");
    assert.ok(ab.peer && ba.peer, "both handles hold a peer");

    // and they stay put: no more churn once settled
    let churn = 0;
    ab.on("retry", () => churn++);
    ba.on("retry", () => churn++);
    ab.on("connected", () => churn++);
    ba.on("connected", () => churn++);
    await wait(600);
    assert.equal(churn, 0, "a settled pair should not keep reconnecting");
});

test("fail() drops the link and backs off", async (t) => {
    const server = new AnySocket();
    const client = new AnySocket();
    t.after(() => stop(client, server));

    const port = await server.listen("tcp", { port: 0 });
    const link = client.maintain("tcp", "127.0.0.1", port, {}, FAST);
    await once(link, "connected");

    const retried = once(link, "retry");
    link.fail("handshake of our own failed");
    const [r] = await retried;
    assert.ok(r.delay >= 0);
    await once(link, "connected");
});

// A link that dies the moment it connects must keep backing off, not be
// redialled at full speed forever because each connect "succeeded".
test("backoff does not reset until a connection has stayed up", async (t) => {
    const server = new AnySocket();
    const client = new AnySocket();
    t.after(() => stop(client, server));

    // The server drops every connection as soon as it is made.
    server.on("connected", (peer) => setTimeout(() => peer.disconnect("go away"), 5));
    const port = await server.listen("tcp", { port: 0 });

    const link = client.maintain("tcp", "127.0.0.1", port, {},
        { minDelay: 20, maxDelay: 400, factor: 2, jitter: 0, stableAfter: 5000 });
    const delays = [];
    link.on("retry", (r) => delays.push(r.delay));
    await wait(1200);
    link.stop();

    assert.ok(delays.length >= 3, "expected repeated retries, got " + delays.length);
    assert.ok(delays[delays.length - 1] > delays[0], "the delay should grow: " + delays.join(","));
});

test("stopping the instance stops what it maintains", async (t) => {
    const port = await freePort();
    const client = new AnySocket();
    const link = client.maintain("tcp", "127.0.0.1", port, {}, FAST);
    await once(link, "retry");

    await client.stop();
    assert.equal(link.active, false);

    let redialled = false;
    link.on("retry", () => { redialled = true; });
    await wait(300);
    assert.equal(redialled, false);
});

test("it works over ws as well", async (t) => {
    const server = new AnySocket();
    const client = new AnySocket();
    t.after(() => stop(client, server));

    const port = await server.listen("ws", { port: 0 });
    const link = client.maintain("ws", "127.0.0.1", port, {}, FAST);
    const [peer] = await once(link, "connected");
    assert.equal(peer.id, server.id);
});
