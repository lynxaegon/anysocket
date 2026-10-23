const test = require("node:test");
const assert = require("node:assert");
const constants = require("../../src/libs/_constants");
const { pair, protocolOf, rawSocket, listen, stop, wait, AnySocket } = require("../helpers/loopback");
const WebSocket = require("ws");
const AnyPacker = require("../../src/libs/AnyPacker");

const authFrame = (data) =>
    String(constants.PACKET_LENGTH.FULL) + String(constants.PACKET_TYPE.AUTH) +
    AnyPacker.packInt32(1) + JSON.stringify(data);

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

test("a peer announcing nothing is treated as legacy", async (t) => {
    const link = await pair(t);
    const protocol = protocolOf(link.clientPeer);

    protocol._negotiate({});

    assert.equal(protocol.protocolVersion, constants.PROTOCOL_VERSION_LEGACY);
});

test("a nonsense version does not produce a negative one", async (t) => {
    const link = await pair(t);
    const protocol = protocolOf(link.clientPeer);

    for (const pv of [-5, "1", null, 1.5, NaN]) {
        protocol._negotiate({ pv });
        assert.ok(protocol.protocolVersion >= constants.PROTOCOL_VERSION_LEGACY,
            "pv " + String(pv) + " gave " + protocol.protocolVersion);
        assert.ok(protocol.protocolVersion <= constants.PROTOCOL_VERSION);
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

// A handshake that carries no version is exactly what 0.4.x sends.
test("a handshake with no version lands on legacy framing", async (t) => {
    const server = new AnySocket();
    t.after(() => stop(server));

    let serverPeer = null;
    server.on("connected", (peer) => { serverPeer = peer; });

    const port = await listen(server);
    const socket = new WebSocket("ws://127.0.0.1:" + port + "/");
    await new Promise((resolve) => socket.on("open", resolve));

    socket.send(authFrame({ id: "0123456789abcdef0123456789abcdef" }));
    await wait(200);

    assert.ok(serverPeer, "the handshake should have completed");
    assert.equal(serverPeer.protocolVersion(), constants.PROTOCOL_VERSION_LEGACY);
    socket.close();
});

test("the dial direction is reported but is not what drives negotiation", async (t) => {
    const link = await pair(t);

    assert.equal(link.clientPeer.isOutbound(), true);
    assert.equal(link.serverPeer.isOutbound(), false);
    // ...and the negotiated result is identical regardless.
    assert.equal(link.clientPeer.protocolVersion(), link.serverPeer.protocolVersion());
    assert.deepEqual(link.clientPeer.capabilities(), link.serverPeer.capabilities());
});
