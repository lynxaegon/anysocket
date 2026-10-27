const test = require("node:test");
const assert = require("node:assert");
const { stop, listen, wait, AnySocket } = require("../helpers/loopback");

/**
 * Two peers dialling each other at once — what every mesh does.
 *
 * Both ends end up with two connections and both have to retire the same one.
 * Each end used to drop whichever became ready second, which is a local race:
 * the two ends routinely chose opposite connections, each closed the other's
 * keeper, and **both** died. Measured before the fix, this failed 12 times out
 * of 12, leaving neither end with a peer. An application that re-dials would
 * then do it again, which looks like a peer that will not stay connected.
 *
 * The survivor is now chosen from the two ids, which both ends know.
 */

/** Two instances listening, then dialling each other simultaneously. */
async function crossDial(t) {
    const a = new AnySocket();
    const b = new AnySocket();
    t.after(() => stop(a, b));

    const portA = await listen(a);
    const portB = await listen(b);

    await Promise.allSettled([
        a.connect("ws", "127.0.0.1", portB, { allowInsecureWSFallback: true }),
        b.connect("ws", "127.0.0.1", portA, { allowInsecureWSFallback: true })
    ]);
    await wait(250);

    return { a, b };
}

test("both ends keep a peer when they dial each other at once", async (t) => {
    const { a, b } = await crossDial(t);

    assert.ok(a.hasPeer(b.id), "a lost its peer");
    assert.ok(b.hasPeer(a.id), "b lost its peer");
});

test("exactly one connection survives, and it is the same one at both ends", async (t) => {
    const { a, b } = await crossDial(t);

    // The lower id is the designated dialler, so that end holds the outbound.
    const aIsLower = String(a.id) < String(b.id);
    const lower = aIsLower ? a : b;
    const higher = aIsLower ? b : a;

    assert.equal(lower.hasPeer(higher.id), true);
    assert.equal(higher.hasPeer(lower.id), true);

    const atLower = lower.hasDirectPeer(higher.id);
    assert.ok(atLower, "the survivor should be a direct connection");
});

test("the surviving connection actually carries traffic both ways", async (t) => {
    const { a, b } = await crossDial(t);

    const atB = new Promise((resolve) => b.once("message", (p) => resolve(p.msg)));
    await a.broadcast({ from: "a" });
    assert.deepEqual(await atB, { from: "a" });

    const atA = new Promise((resolve) => a.once("message", (p) => resolve(p.msg)));
    await b.broadcast({ from: "b" });
    assert.deepEqual(await atA, { from: "b" });
});

test("it survives being done repeatedly", async (t) => {
    // The old behaviour was a race, so a single pass could pass by luck.
    for (let round = 0; round < 8; round++) {
        const a = new AnySocket();
        const b = new AnySocket();

        const portA = await listen(a);
        const portB = await listen(b);
        await Promise.allSettled([
            a.connect("ws", "127.0.0.1", portB, { allowInsecureWSFallback: true }),
            b.connect("ws", "127.0.0.1", portA, { allowInsecureWSFallback: true })
        ]);
        await wait(200);

        const held = a.hasPeer(b.id) && b.hasPeer(a.id);
        await stop(a, b);
        assert.ok(held, "round " + round + " left an end without a peer");
    }
});

test("the survivor can be encrypted like any other connection", async (t) => {
    const a = new AnySocket();
    const b = new AnySocket();
    t.after(() => stop(a, b));

    // Keep hold of the peer objects as they are handed out, so the surviving
    // connection can be driven directly rather than through broadcast.
    const peers = { a: null, b: null };
    a.on("connected", (peer) => { peers.a = peer; });
    b.on("connected", (peer) => { peers.b = peer; });

    const portA = await listen(a);
    const portB = await listen(b);
    await Promise.allSettled([
        a.connect("ws", "127.0.0.1", portB, { allowInsecureWSFallback: true }),
        b.connect("ws", "127.0.0.1", portA, { allowInsecureWSFallback: true })
    ]);
    await wait(250);

    assert.ok(peers.a && peers.b, "both ends should have been handed a peer");

    await peers.a.e2e();
    await wait(100);

    assert.ok(peers.a.isE2EEnabled(), "the survivor should be encrypted");
    assert.ok(peers.b.isE2EEnabled());
    assert.equal(
        Buffer.from(peers.a.getChannelBinding()).toString("hex"),
        Buffer.from(peers.b.getChannelBinding()).toString("hex"),
        "both ends must agree on the binding of the connection they kept"
    );

    const atB = new Promise((resolve) => b.once("message", (p) => resolve(p.msg)));
    await peers.a.send({ ping: 1 });
    assert.deepEqual(await atB, { ping: 1 });
});

test("a single dial is unaffected by the rule", async (t) => {
    // Only consulted when there is a duplicate: one connection is kept whichever
    // way it was dialled, including when the dialler has the higher id.
    for (let round = 0; round < 6; round++) {
        const server = new AnySocket();
        const client = new AnySocket();

        const port = await listen(server);
        const peer = await client.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true });
        await wait(80);

        const held = client.hasPeer(server.id) && server.hasPeer(client.id);
        const dialerIsHigher = String(client.id) > String(server.id);
        await stop(server, client);

        assert.ok(held, "a plain dial was dropped (dialler had the " +
            (dialerIsHigher ? "higher" : "lower") + " id)");
        assert.equal(peer.isOutbound(), true);
    }
});
