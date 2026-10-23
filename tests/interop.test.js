const test = require("node:test");
const assert = require("node:assert");
const AnySocket = require("../src/index.js");
const LegacyAnySocket = require("anysocket-legacy");
const constants = require("../src/libs/_constants");
const { listen, stop, wait } = require("./helpers/loopback");

/**
 * Interop with the published 0.4.32, tested against the real package rather
 * than a mock of it.
 *
 * This is not politeness to outside users: `nexus upgrade` rolls one node at a
 * time, so upgraded and not-yet-upgraded nodes share the raft mesh for the
 * length of a roll. If a 1.0 node could not talk to a 0.4.x node the roll would
 * split the mesh and could cost quorum.
 */

const legacyIsUsable = (() => {
    try {
        new LegacyAnySocket();
        return true;
    } catch (e) {
        return false;
    }
})();

test("the legacy package loads", (t) => {
    assert.ok(legacyIsUsable, "0.4.32 should construct");
    assert.equal(require("anysocket-legacy/package.json").version, "0.4.32");
});

test("a 0.4.x client can talk to a 1.0 server", async (t) => {
    const server = new AnySocket();
    const legacy = new LegacyAnySocket();
    t.after(() => stop(server, legacy));

    let serverPeer = null;
    server.on("connected", (peer) => { serverPeer = peer; });
    server.setRPC({ greet: (name) => "hello " + name });

    const port = await listen(server);
    const peer = await legacy.connect("ws", "127.0.0.1", port);
    await wait(150);

    assert.ok(serverPeer, "the 1.0 server should have a peer");
    assert.equal(serverPeer.id, legacy.id);

    // The old peer announces no version, so the link stays on legacy framing.
    assert.equal(serverPeer.protocolVersion(), constants.PROTOCOL_VERSION_LEGACY);

    // messages, both directions
    const atServer = new Promise((resolve) => server.once("message", (packet) => resolve(packet.msg)));
    peer.send({ from: "legacy" });
    assert.deepEqual(await atServer, { from: "legacy" });

    const atLegacy = new Promise((resolve) => legacy.once("message", (packet) => resolve(packet.msg)));
    await serverPeer.send({ from: "1.0" });
    assert.deepEqual(await atLegacy, { from: "1.0" });

    // and RPC from the old peer into the new server
    assert.equal(await peer.rpc.greet("world"), "hello world");
});

test("a 1.0 client can talk to a 0.4.x server", async (t) => {
    const legacy = new LegacyAnySocket();
    const client = new AnySocket();
    t.after(() => stop(legacy, client));

    legacy.setRPC({ greet: (name) => "hello " + name });

    let port = 0;
    for (let attempt = 0; attempt < 25 && !port; attempt++) {
        const candidate = 21000 + Math.floor(Math.random() * 9000);
        try {
            await legacy.listen("ws", { port: candidate });
            port = candidate;
        } catch (e) { /* taken, try another */ }
    }
    assert.ok(port, "the legacy server should have come up");

    const peer = await client.connect("ws", "127.0.0.1", port);
    await wait(150);

    assert.equal(peer.id, legacy.id);
    assert.equal(peer.protocolVersion(), constants.PROTOCOL_VERSION_LEGACY);

    const atLegacy = new Promise((resolve) => legacy.once("message", (packet) => resolve(packet.msg)));
    await peer.send({ from: "1.0" });
    assert.deepEqual(await atLegacy, { from: "1.0" });

    assert.equal(await peer.rpc.greet("world"), "hello world");
});

test("e2e still works across the version boundary", async (t) => {
    const server = new AnySocket();
    const legacy = new LegacyAnySocket();
    t.after(() => stop(server, legacy));

    const port = await listen(server);
    const peer = await legacy.connect("ws", "127.0.0.1", port);
    await wait(150);

    const up = new Promise((resolve) => peer.on("e2e", resolve));
    peer.e2e();
    await up;

    assert.ok(peer.isE2EEnabled());

    const atServer = new Promise((resolve) => server.once("message", (packet) => resolve(packet.msg)));
    peer.send({ secret: "over legacy e2e" });
    assert.deepEqual(await atServer, { secret: "over legacy e2e" });
});

test("a 1.0 peer still enforces auth against a 0.4.x peer", async (t) => {
    const server = new AnySocket();
    const legacy = new LegacyAnySocket();
    t.after(() => stop(server, legacy));

    server.onAuth = (packet) => packet.auth === "expected";
    legacy.authPacket = () => "wrong";

    const port = await listen(server);

    let refused = null;
    try {
        await legacy.connect("ws", "127.0.0.1", port);
    } catch (e) {
        refused = e;
    }

    assert.ok(refused, "a bad token must be refused regardless of the peer's version");
});

test("two 1.0 peers negotiate the current version", async (t) => {
    const server = new AnySocket();
    const client = new AnySocket();
    t.after(() => stop(server, client));

    let serverPeer = null;
    server.on("connected", (peer) => { serverPeer = peer; });

    const port = await listen(server);
    const clientPeer = await client.connect("ws", "127.0.0.1", port);
    await wait(100);

    // Both ends settle on the same answer, neither one deciding for the other.
    assert.equal(clientPeer.protocolVersion(), constants.PROTOCOL_VERSION);
    assert.equal(serverPeer.protocolVersion(), constants.PROTOCOL_VERSION);
});
