const test = require("node:test");
const assert = require("node:assert");
const { pair, wait } = require("../helpers/loopback");

/**
 * AnySocket is client/server agnostic: once a link is up, everybody
 * communicates the same way. These tests assert that directly — every one of
 * them runs the same exchange from each end and expects the same result — so a
 * change that only works for the side that dialled fails here.
 */

const bothWays = (link) => [
    { name: "client -> server", from: link.clientPeer, at: link.server },
    { name: "server -> client", from: link.serverPeer, at: link.client }
];

test("a message travels the same way in both directions", async (t) => {
    const link = await pair(t);

    for (const dir of bothWays(link)) {
        const received = new Promise((resolve) => dir.at.once("message", (packet) => resolve(packet.msg)));
        await dir.from.send({ hello: dir.name });
        assert.deepEqual(await received, { hello: dir.name }, dir.name);
    }
});

test("request/reply works from either end", async (t) => {
    const link = await pair(t);
    const answer = (instance) => instance.on("message", (packet) => packet.reply({ pong: packet.msg.ping }));
    answer(link.server);
    answer(link.client);

    for (const dir of bothWays(link)) {
        const reply = await dir.from.send({ ping: dir.name }, true);
        assert.deepEqual(reply.msg, { pong: dir.name }, dir.name);
    }
});

test("RPC works from either end", async (t) => {
    const link = await pair(t, {
        configure: (server, client) => {
            server.setRPC({ whoAmI: () => "server" });
            client.setRPC({ whoAmI: () => "client" });
        }
    });

    assert.equal(await link.clientPeer.rpc.whoAmI(), "server");
    assert.equal(await link.serverPeer.rpc.whoAmI(), "client");
});

test("e2e() can be driven from either end", async (t) => {
    for (const side of ["clientPeer", "serverPeer"]) {
        const link = await pair(t);
        // Both ends: the one that started reports e2e as soon as its side is done, and
        // asserting the other end at that moment raced the other end finishing.
        const up = Promise.all(["clientPeer", "serverPeer"].map((end) =>
            new Promise((resolve) => link[end].on("e2e", resolve))));

        link[side].e2e();
        await up;

        assert.ok(link.clientPeer.isE2EEnabled(), side + ": client should be encrypted");
        assert.ok(link.serverPeer.isE2EEnabled(), side + ": server should be encrypted");

        // and traffic still flows both ways afterwards
        for (const dir of bothWays(link)) {
            const received = new Promise((resolve) => dir.at.once("message", (packet) => resolve(packet.msg)));
            await dir.from.send({ via: side });
            assert.deepEqual(await received, { via: side }, side + " / " + dir.name);
        }

        await link.stop();
    }
});

test("getSyncedTime works from either end", async (t) => {
    const link = await pair(t);

    for (const dir of bothWays(link)) {
        const synced = await dir.from.getSyncedTime();
        assert.equal(typeof synced.time, "number", dir.name);
        assert.equal(typeof synced.rtt, "number", dir.name);
    }
});

test("both ends agree on who the other is", async (t) => {
    const link = await pair(t);

    assert.equal(link.clientPeer.id, link.server.id);
    assert.equal(link.serverPeer.id, link.client.id);
    assert.ok(link.server.hasPeer(link.client.id));
    assert.ok(link.client.hasPeer(link.server.id));
});

// Direction is reportable metadata, but nothing in the protocol may depend on
// it — see §0 of the design. Both ends are otherwise indistinguishable.
test("the dial direction is the only asymmetry a peer exposes", async (t) => {
    const link = await pair(t);
    await wait(50);

    for (const dir of bothWays(link)) {
        assert.equal(typeof dir.from.isProxy(), "boolean", dir.name);
        assert.equal(typeof dir.from.isE2EEnabled(), "boolean", dir.name);
        assert.equal(dir.from.relayID, null, dir.name + ": a direct peer has no relay");
    }
});
