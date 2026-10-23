const test = require("node:test");
const assert = require("node:assert");
const LegacyAnySocket = require("anysocket-legacy");
const { listen, stop, wait, freePort, AnySocket } = require("../helpers/loopback");

/**
 * The e2e a 0.4.x peer can do is weak: an unauthenticated exchange, then
 * AES-CBC with no integrity, keyed by PBKDF2 at a single iteration. It is
 * allowed by default so a fleet can move a peer at a time, and allowLegacyE2E:
 * false turns it off once it has — in both directions.
 */

async function legacyLink(t, serverOptions) {
    const server = new AnySocket();
    const legacy = new LegacyAnySocket();
    t.after(() => stop(server, legacy));

    let serverPeer = null;
    server.on("connected", (p) => { serverPeer = p; });

    const port = await listen(server, serverOptions);
    const peer = await legacy.connect("ws", "127.0.0.1", port);
    await wait(150);
    return { server, legacy, peer, serverPeer: () => serverPeer };
}

test("by default the old exchange still works, for a rolling upgrade", async (t) => {
    const link = await legacyLink(t);

    const up = new Promise((resolve) => link.peer.on("e2e", resolve));
    link.peer.e2e();
    await up;

    assert.equal(link.serverPeer().e2eInfo().cipher, "aes-256-cbc");
});

test("with allowLegacyE2E off, a 0.4.x peer cannot start the old exchange", async (t) => {
    const link = await legacyLink(t, { allowLegacyE2E: false });

    const gone = new Promise((resolve) => link.server.on("disconnected", (_p, reason) => resolve(reason)));
    link.peer.e2e();

    assert.match(String(await gone), /legacy e2e refused/i);
});

test("with allowLegacyE2E off, we will not start it ourselves", async (t) => {
    const link = await legacyLink(t, { allowLegacyE2E: false });

    await assert.rejects(link.serverPeer().e2e(), (e) => {
        assert.equal(e.code, AnySocket.ERRORS.REFUSED);
        return true;
    });
    assert.equal(link.serverPeer().isE2EEnabled(), false, "and nothing was half-switched");
});

test("the option does not affect two 1.0 peers", async (t) => {
    const server = new AnySocket();
    const client = new AnySocket();
    t.after(() => stop(server, client));

    const port = await listen(server, { allowLegacyE2E: false });
    const peer = await client.connect("ws", "127.0.0.1", port, { allowLegacyE2E: false });
    await peer.e2e();

    assert.equal(peer.e2eInfo().cipher, "aes-256-gcm");
});

test("a 0.4.x listener cannot pull a 1.0 dialler onto the old exchange either", async (t) => {
    const legacy = new LegacyAnySocket();
    const client = new AnySocket();
    t.after(() => stop(legacy, client));

    const port = await freePort();
    await legacy.listen("ws", { port });

    const peer = await client.connect("ws", "127.0.0.1", port, { allowLegacyE2E: false });
    await assert.rejects(peer.e2e(), (e) => e.code === AnySocket.ERRORS.REFUSED);
});
