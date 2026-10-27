const test = require("node:test");
const assert = require("node:assert");
const { stop, wait, AnySocket } = require("../helpers/loopback");

/**
 * Frames are cut to fit the receiver. Each end announces the largest frame it takes in
 * its AUTH; a sender set larger than that used to be disconnected by the receiver's
 * transport, with nothing delivered.
 */
const cases = [
    { scheme: "tcp", sender: 80 * 1024 * 1024 },   // the tcp listener takes 64MB
    { scheme: "ws", sender: 16 * 1024 * 1024 }     // a ws listener takes about 9MB
];

for (const { scheme, sender } of cases) {
    test(scheme + ": a sender with a larger maxPacketSize than the receiver takes still delivers", async (t) => {
        const server = new AnySocket();
        const client = new AnySocket();
        t.after(() => stop(server, client));
        const port = await server.listen(scheme, { port: 0 });
        const dropped = [];
        client.on("disconnected", (_p, reason) => dropped.push(reason));
        const received = new Promise((resolve) => server.on("message", (packet) => resolve(packet.msg)));

        const peer = await client.connect(scheme, "127.0.0.1", port, { allowInsecureWSFallback: true, maxPacketSize: sender });
        await peer.send(new Uint8Array(sender + 4 * 1024 * 1024));

        assert.equal((await received).length, sender + 4 * 1024 * 1024);
        assert.deepEqual(dropped, []);
    });
}

// A relayed frame crosses two hops, and the sender only sees the first: the relay passes
// on the limit of the hop beyond it.
test("a relayed link fits its frames to the far hop", async (t) => {
    const relay = new AnySocket();
    const a = new AnySocket();
    const b = new AnySocket();
    t.after(() => stop(a, b, relay));
    relay.canProxy = () => true;
    a.canAcceptProxy = b.canAcceptProxy = () => true;
    const port = await relay.listen("ws", { port: 0 });
    await a.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true });
    // b takes frames of 2MB at most; a would cut 4MB ones by default.
    await b.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true, maxPayload: 2 * 1024 * 1024 });
    await wait(150);
    const received = new Promise((resolve) => b.on("message", (packet) => resolve(packet.msg)));

    const toB = await a.proxy(b.id, relay.id);
    await toB.send(new Uint8Array(10 * 1024 * 1024));

    assert.equal((await received).length, 10 * 1024 * 1024);
    assert.equal(b.hasPeer(relay.id), true);
});

// Reassembly allocates part of an announced total up front and grows into the rest.
test("a message larger than what is allocated up front reassembles whole", async (t) => {
    const server = new AnySocket();
    const client = new AnySocket();
    t.after(() => stop(server, client));
    const port = await server.listen("tcp", { port: 0 });
    const received = new Promise((resolve) => server.on("message", (packet) => resolve(packet.msg)));

    const peer = await client.connect("tcp", "127.0.0.1", port, { maxPacketSize: 8 * 1024 * 1024 });
    const big = new Uint8Array(100 * 1024 * 1024);
    for (let i = 0; i < big.length; i += 4096) big[i] = (i / 4096) & 0xff;
    await peer.send(big);

    const got = await received;
    assert.equal(got.length, big.length);
    for (let i = 0; i < big.length; i += 4096) {
        if (got[i] !== big[i]) assert.fail("byte " + i + " differs");
    }
});
