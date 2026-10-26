const test = require("node:test");
const assert = require("node:assert");
const PreviousAnySocket = require("anysocket-1-0");
const { listen, stop, wait, AnySocket } = require("../helpers/loopback");

const SECRET = "shared";
const required = { auth: { secret: SECRET } };
const optional = { auth: { secret: SECRET, optional: true } };

/** Dial `client` into `server`; resolves both peers, or the refusal. */
async function dial(t, serverOptions, clientOptions) {
    const server = new AnySocket(serverOptions);
    const client = new AnySocket(clientOptions);
    t.after(() => stop(server, client));

    let serverPeer = null;
    server.on("connected", (p) => { if (p.id === client.id) serverPeer = p; });

    const port = await listen(server);
    try {
        const clientPeer = await client.connect("ws", "127.0.0.1", port);
        await wait(80);
        return { clientPeer, serverPeer: serverPeer };
    } catch (e) {
        return { refused: e };
    }
}

// --- the outcomes, for every pairing ---------------------------------------

test("optional + optional: the built-in auth runs, and both say so", async (t) => {
    const r = await dial(t, optional, optional);
    assert.ok(!r.refused);
    assert.equal(r.clientPeer.isAuthenticated(), true);
    assert.equal(r.serverPeer.isAuthenticated(), true);
});

test("optional + required: it runs", async (t) => {
    const r = await dial(t, optional, required);
    assert.equal(r.clientPeer.isAuthenticated(), true);
    assert.equal(r.serverPeer.isAuthenticated(), true);
});

test("optional listener + a dialer with no secret: connected, not authenticated", async (t) => {
    const r = await dial(t, optional, {});
    assert.ok(!r.refused, "an optional listener must accept a peer that does not offer it");
    assert.equal(r.clientPeer.isAuthenticated(), false);
    assert.equal(r.serverPeer.isAuthenticated(), false);
});

test("optional dialer + a listener with no secret: connected, not authenticated", async (t) => {
    const r = await dial(t, {}, optional);
    assert.ok(!r.refused);
    assert.equal(r.clientPeer.isAuthenticated(), false);
});

test("required still refuses a peer that does not offer it", async (t) => {
    assert.ok((await dial(t, required, {})).refused, "a required listener must refuse");
    assert.ok((await dial(t, {}, required)).refused, "a required dialer must refuse");
});

test("a wrong secret is refused even in optional mode", async (t) => {
    // Optional means the peer may decline the auth — not that it may fail it.
    const r = await dial(t, optional, { auth: { secret: "wrong", optional: true } });
    assert.ok(r.refused, "offering the auth and failing it must still be refused");
});

test("no secret anywhere: nothing to authenticate", async (t) => {
    const r = await dial(t, {}, {});
    assert.equal(r.clientPeer.isAuthenticated(), false);
});

// --- what being authenticated does for e2e ---------------------------------

// The secret goes into the e2e keys only where the connection proved it. A peer
// that never offered the auth does not mix it in, so mixing it in on our side
// would make the two ends derive different keys.
test("e2e works on an unauthenticated connection under optional auth", async (t) => {
    const r = await dial(t, optional, {});
    await r.clientPeer.e2e();

    assert.equal(r.clientPeer.e2eInfo().authenticated, false);
    assert.ok(r.clientPeer.isE2EEnabled());
});

test("e2e is bound to the secret on an authenticated connection", async (t) => {
    const r = await dial(t, optional, optional);
    await r.clientPeer.e2e();
    assert.equal(r.clientPeer.e2eInfo().authenticated, true);
});

// --- the reason it exists: moving a live fleet ----------------------------

test("an optional peer still talks to a 1.0.1 peer without a secret during a migration", async (t) => {
    const server = new AnySocket(optional);
    const previous = new PreviousAnySocket();
    t.after(() => stop(server, previous));

    let serverPeer = null;
    server.on("connected", (p) => { serverPeer = p; });

    const port = await listen(server);
    const peer = await previous.connect("ws", "127.0.0.1", port);
    await wait(150);

    assert.ok(serverPeer, "the peer that has not moved must still get in");
    assert.equal(serverPeer.isAuthenticated(), false, "and is reported as not authenticated");

    const atServer = new Promise((resolve) => server.once("message", (p) => resolve(p.msg)));
    peer.send({ still: "talking" });
    assert.deepEqual(await atServer, { still: "talking" });
});

test("a custom onAuth can gate on isAuthenticated() through the migration", async (t) => {
    // The pattern: let a peer in if it passed the built-in auth, or the old one.
    const server = new AnySocket(optional);
    const fresh = new AnySocket(optional);
    const old = new AnySocket({});
    t.after(() => stop(server, fresh, old));

    old.authPacket = () => "old-style-token";
    server.onAuth = (packet) => packet.auth === "old-style-token" || packet.ac !== undefined;

    const port = await listen(server);
    const freshPeer = await fresh.connect("ws", "127.0.0.1", port);
    const oldPeer = await old.connect("ws", "127.0.0.1", port);
    await wait(80);

    assert.equal(freshPeer.isAuthenticated(), true, "the moved peer used the built-in auth");
    assert.equal(oldPeer.isAuthenticated(), false, "the old one got in on its own token");
});
