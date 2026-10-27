const test = require("node:test");
const assert = require("node:assert");
const constants = require("../../src/libs/_constants");
const { pair, protocolOf, listen, stop, wait, disconnectReasons, AnySocket } = require("../helpers/loopback");
const WebSocket = require("ws");

// An AUTH in the 0.4.x text format: flag, type, a 4-character seq, then JSON.
const textAuth = (data) =>
    "1" + String(constants.PACKET_TYPE.AUTH) +
    String.fromCharCode(0, 0, 0, 1) + JSON.stringify(data);

test("capabilities are the intersection, and both ends agree", async (t) => {
    const link = await pair(t, {
        connect: { capabilities: ["alpha", "beta"] },
        listen: { capabilities: ["beta", "gamma"] }
    });

    assert.deepEqual(link.clientPeer.capabilities(), ["beta"]);
    assert.deepEqual(link.serverPeer.capabilities(), ["beta"]);
});

// The order each side happens to declare in must not change the outcome, or the
// two ends would hash different bytes once this feeds a transcript.
test("the order capabilities are declared in does not matter", async (t) => {
    const link = await pair(t, {
        connect: { capabilities: ["zulu", "alpha", "mike"] },
        listen: { capabilities: ["mike", "zulu", "alpha"] }
    });

    assert.deepEqual(link.clientPeer.capabilities(), ["alpha", "mike", "zulu"]);
    assert.deepEqual(link.serverPeer.capabilities(), ["alpha", "mike", "zulu"]);
});

test("no shared capability yields none", async (t) => {
    const link = await pair(t, {
        connect: { capabilities: ["alpha"] },
        listen: { capabilities: ["omega"] }
    });

    assert.deepEqual(link.clientPeer.capabilities(), []);
    assert.deepEqual(link.serverPeer.capabilities(), []);
});

test("narrowing our capabilities keeps a feature off the connection", async (t) => {
    const link = await pair(t, {
        connect: { capabilities: [] },
        listen: { capabilities: ["beta"] }
    });

    assert.deepEqual(link.clientPeer.capabilities(), []);
    assert.deepEqual(link.serverPeer.capabilities(), []);
});

test("a peer announcing a newer version is clamped to what we speak", async (t) => {
    const link = await pair(t);
    const protocol = protocolOf(link.clientPeer);

    protocol._negotiate({ pv: 99, caps: [] });

    assert.equal(protocol.protocolVersion, constants.PROTOCOL_VERSION,
        "we must never claim to speak a version we do not have");
    assert.equal(protocol.remoteProtocolVersion, 99);
});

// The version is never negotiated down: what speaks less is refused before this.
test("a nonsense version leaves the connection on the one we speak", async (t) => {
    const link = await pair(t);
    const protocol = protocolOf(link.clientPeer);

    for (const pv of [undefined, -5, "1", null, 1.5, NaN]) {
        protocol._negotiate({ pv });
        assert.equal(protocol.protocolVersion, constants.PROTOCOL_VERSION, "pv " + String(pv));
        assert.equal(protocol.remoteProtocolVersion, Number.isInteger(pv) ? pv : null);
    }
});

test("nonsense capabilities are ignored rather than trusted", async (t) => {
    const link = await pair(t, { connect: { capabilities: ["beta"] } });
    const protocol = protocolOf(link.clientPeer);

    for (const caps of [undefined, null, "beta", 7, {}]) {
        protocol._negotiate({ pv: 1, caps });
        assert.deepEqual(protocol.capabilities, [], "caps " + JSON.stringify(caps));
    }
});

// A handshake that carries no version is exactly what 0.4.x sends. It used to put the
// connection on the old text format; since 1.1 it is refused, and says why — when the
// listener reads text handshakes at all (acceptLegacyHandshake), and otherwise unread.
for (const [name, data] of [
    ["no version", { id: "0123456789abcdef0123456789abcdef" }],
    ["version 0", { id: "0123456789abcdef0123456789abcdef", pv: 0 }]
]) {
    test("a handshake with " + name + " is refused", async (t) => {
        const reasons = disconnectReasons(t);
        const server = new AnySocket();
        t.after(() => stop(server));

        let serverPeer = null;
        let asked = false;
        server.on("connected", (peer) => { serverPeer = peer; });
        server.onAuth = () => { asked = true; return true; };

        const port = await listen(server, { acceptLegacyHandshake: true });
        const socket = new WebSocket("ws://127.0.0.1:" + port + "/");
        await new Promise((resolve) => socket.on("open", resolve));
        const closed = new Promise((resolve) => socket.on("close", resolve));

        socket.send(textAuth(data));
        await closed;
        await wait(50);

        assert.equal(serverPeer, null, "the handshake must not complete");
        assert.equal(asked, false, "onAuth is never asked about a peer that is refused anyway");
        assert.ok(reasons.some((r) => /Protocol version 1 required/.test(r)), "dropped for: " + reasons);
    });
}

test("the dial direction is reported but is not what drives negotiation", async (t) => {
    const link = await pair(t);

    assert.equal(link.clientPeer.isOutbound(), true);
    assert.equal(link.serverPeer.isOutbound(), false);
    // ...and the negotiated result is identical regardless.
    assert.equal(link.clientPeer.protocolVersion(), link.serverPeer.protocolVersion());
    assert.deepEqual(link.clientPeer.capabilities(), link.serverPeer.capabilities());
});

// Shows which connections still came in through the 1.0.x text AUTH, which a future
// release stops reading. Between two 1.1 peers, neither did.
test("a 1.1 dialler's handshake is not reported as legacy", async (t) => {
    const link = await pair(t);
    assert.equal(link.serverPeer.legacyHandshake(), false);
    assert.equal(link.clientPeer.legacyHandshake(), false);
});
