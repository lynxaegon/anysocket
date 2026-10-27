const test = require("node:test");
const assert = require("node:assert");
const WebSocket = require("ws");
const Frame = require("../../src/libs/Frame");
const constants = require("../../src/libs/_constants");
const { pair, listen, stop, wait, disconnectReasons, AnySocket } = require("../helpers/loopback");

// FORWARD frame: a frame whose payload is to(16 bytes) + from(16 bytes) + the
// relayed frame. Ids go on the wire as their 16 bytes, so only a 32-hex id
// survives the trip.
const hexId = () => require("crypto").randomBytes(16).toString("hex");
const forwardFrame = (to, from, inner) => Frame.encode({
    flags: Frame.FLAGS.FIRST | Frame.FLAGS.FINAL | Frame.FLAGS.BINARY,
    type: constants.PACKET_TYPE.FORWARD,
    seq: 0,
    payload: [Frame.idToBytes(to), Frame.idToBytes(from), inner]
});
const rpcFrame = (seq, method, params) => Frame.encode({
    flags: Frame.FLAGS.FIRST | Frame.FLAGS.FINAL,
    type: constants.PACKET_TYPE.INTERNAL,
    seq,
    payload: Frame.bytes(JSON.stringify({ type: constants.INTERNAL_PACKET_TYPE.RPC, method, params, bin: [] }))
});

/**
 * Regression for the hole this release exists to close: FORWARD frames were
 * handled whatever state the connection was in, and the `from` they carry is
 * written by the sender. A socket that never authenticated could therefore have
 * an RPC run as though it came from a peer the server already trusted.
 */
test("a socket that never authenticated cannot have a relayed RPC run", async (t) => {
    const reasons = disconnectReasons(t);
    const server = new AnySocket();
    const trusted = new AnySocket();
    server.id = hexId();
    trusted.id = hexId();
    t.after(() => stop(server, trusted));

    const secret = "only-the-trusted-peer-knows-this";
    for (const instance of [server, trusted]) {
        instance.authPacket = () => secret;
        instance.onAuth = (packet) => packet.auth === secret;
    }

    let ranAs = null;
    server.setRPC({ privileged: (arg, peer) => { ranAs = peer.id; return "ok"; } });

    const port = await listen(server);
    await trusted.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true });
    await wait(100);

    // An attacker with no credentials, naming the trusted peer as the origin.
    const attacker = new WebSocket("ws://127.0.0.1:" + port + "/");
    await new Promise((resolve) => attacker.on("open", resolve));
    const closed = new Promise((resolve) => attacker.on("close", resolve));

    attacker.send(forwardFrame(server.id, trusted.id, rpcFrame(4242, ["privileged"], ["pwned"])));
    await wait(300);

    assert.equal(ranAs, null, "an unauthenticated socket must not get an RPC executed");
    await closed; // and it should have been dropped
    assert.ok(reasons.some((r) => /FORWARD before the handshake/.test(r)), "dropped for: " + reasons);
});

test("an authenticated peer cannot relay under another peer's name", async (t) => {
    const link = await pair(t, { configure: (server) => server.canProxy = () => true });
    const other = hexId();

    let ranAs = null;
    link.server.setRPC({ privileged: (arg, peer) => { ranAs = peer.id; return "ok"; } });

    const gone = new Promise((resolve) => link.server.on("disconnected", (_peer, reason) => resolve(reason)));
    link.clientPeer.forward({
        to: link.server.id,
        from: other,
        msg: rpcFrame(99, ["privileged"], ["pwned"])
    });

    assert.match(String(await gone), /Invalid forward packet/i);
    assert.equal(ranAs, null, "a forged `from` must not be accepted");
});

test("a relay refuses a route canProxy does not allow", async (t) => {
    // canProxy defaults to false, so the relay should refuse to pass anything on.
    const link = await pair(t);
    const elsewhere = hexId();

    const gone = new Promise((resolve) => link.server.on("disconnected", (_peer, reason) => resolve(reason)));
    link.clientPeer.forward({
        to: elsewhere,
        from: link.client.id,
        msg: rpcFrame(100, ["whatever"], [])
    });

    assert.match(String(await gone), /Invalid forward packet/i);
});

test("proxying still works end to end and the proxied peer is usable", async (t) => {
    const relay = new AnySocket();
    const a = new AnySocket();
    const b = new AnySocket();
    t.after(() => stop(relay, a, b));

    relay.canProxy = () => true;
    b.canAcceptProxy = () => true;

    const port = await listen(relay);
    await a.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true });
    await b.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true });
    await wait(150);

    const bSeesA = new Promise((resolve) => b.on("connected", resolve));
    const proxied = await a.proxy(b.id, relay.id);

    assert.equal(proxied.id, b.id);
    assert.ok(proxied.isProxy(), "the new peer should be a proxy");
    assert.equal(proxied.relayID, relay.id);
    await bSeesA;

    const received = new Promise((resolve) => b.on("message", (packet) => resolve(packet.msg)));
    await proxied.send({ through: "the relay" });
    assert.deepEqual(await received, { through: "the relay" });
});

test("a proxied peer can be end-to-end encrypted through the relay", async (t) => {
    const relay = new AnySocket();
    const a = new AnySocket();
    const b = new AnySocket();
    t.after(() => stop(relay, a, b));

    relay.canProxy = () => true;
    b.canAcceptProxy = () => true;

    const port = await listen(relay);
    await a.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true });
    await b.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true });
    await wait(150);

    const proxied = await a.proxy(b.id, relay.id);
    const up = new Promise((resolve) => proxied.on("e2e", resolve));
    proxied.e2e();
    await up;

    assert.ok(proxied.isE2EEnabled());

    const received = new Promise((resolve) => b.on("message", (packet) => resolve(packet.msg)));
    await proxied.send({ secret: "end to end" });
    assert.deepEqual(await received, { secret: "end to end" });
});
