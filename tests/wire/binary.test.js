const test = require("node:test");
const assert = require("node:assert");
const LegacyAnySocket = require("anysocket-legacy");
const Frame = require("../../src/libs/Frame");
const constants = require("../../src/libs/_constants");
const { pair, listen, stop, rawSocket, wait, AnySocket } = require("../helpers/loopback");

/** Record whether each outgoing message leaves as bytes or as a string. */
function watchWire(peer) {
    const socket = rawSocket(peer);
    const sent = [];
    const original = socket.send.bind(socket);

    socket.send = (data, cb) => {
        sent.push(typeof data == "string" ? "text" : "binary");
        return original(data, cb);
    };

    return sent;
}

test("two 1.0 peers put binary frames on the wire", async (t) => {
    const link = await pair(t);
    const sent = watchWire(link.clientPeer);

    await link.clientPeer.send({ hello: "world" });
    await wait(50);

    assert.deepEqual(sent, ["binary"]);
});

// The format is chosen per connection from what the peer announced, so an old
// peer cannot be handed a frame it has no way to read.
test("a 0.4.x peer is still sent legacy text frames", async (t) => {
    const server = new AnySocket();
    const legacy = new LegacyAnySocket();
    t.after(() => stop(server, legacy));

    let serverPeer = null;
    server.on("connected", (peer) => { serverPeer = peer; });

    const port = await listen(server);
    await legacy.connect("ws", "127.0.0.1", port);
    await wait(150);

    const sent = watchWire(serverPeer);
    await serverPeer.send({ hello: "legacy" });
    await wait(50);

    assert.deepEqual(sent, ["text"]);
});

test("a Uint8Array arrives as bytes, not as a JSON-ified object", async (t) => {
    const link = await pair(t);
    const payload = new Uint8Array([0, 1, 127, 128, 254, 255]);

    const received = new Promise((resolve) => link.server.once("message", (packet) => resolve(packet.msg)));
    await link.clientPeer.send(payload);

    const got = await received;
    assert.ok(got instanceof Uint8Array, "expected bytes, got " + Object.prototype.toString.call(got));
    assert.deepEqual(Array.from(got), Array.from(payload));
});

test("a Buffer arrives as bytes too", async (t) => {
    const link = await pair(t);
    const payload = Buffer.from("not text at all", "utf8");

    const received = new Promise((resolve) => link.server.once("message", (packet) => resolve(packet.msg)));
    await link.clientPeer.send(payload);

    const got = await received;
    assert.deepEqual(Array.from(got), Array.from(payload));
});

test("bytes cost no more on the wire than they are", async (t) => {
    const link = await pair(t);
    const payload = new Uint8Array(4096);
    let observed = 0;

    const socket = rawSocket(link.clientPeer);
    const original = socket.send.bind(socket);
    socket.send = (data, cb) => { observed += data.length; return original(data, cb); };

    await link.clientPeer.send(payload);
    await wait(50);

    // Previously a byte payload went through JSON, which turned each byte into
    // several characters. Now it is the payload plus one 6-byte header.
    assert.equal(observed, payload.length + Frame.HEADER_SIZE);
});

test("a large binary payload survives chunking", async (t) => {
    const link = await pair(t);
    const payload = new Uint8Array(constants.MAX_PACKET_SIZE + 2048);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 256;

    const received = new Promise((resolve) => link.server.once("message", (packet) => resolve(packet.msg)));
    await link.clientPeer.send(payload);

    const got = await received;
    assert.equal(got.length, payload.length);
    assert.deepEqual(Array.from(got.subarray(0, 32)), Array.from(payload.subarray(0, 32)));
    assert.deepEqual(Array.from(got.subarray(-32)), Array.from(payload.subarray(-32)));
});

test("binary round-trips over an encrypted link", async (t) => {
    const link = await pair(t);
    const up = new Promise((resolve) => link.clientPeer.on("e2e", resolve));
    link.clientPeer.e2e();
    await up;

    const payload = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    const received = new Promise((resolve) => link.server.once("message", (packet) => resolve(packet.msg)));
    await link.clientPeer.send(payload);

    assert.deepEqual(Array.from(await received), Array.from(payload));
});

// Encrypted payloads used to be hex, so every one of them was twice the size.
test("an encrypted payload is no longer hex-expanded", async (t) => {
    const link = await pair(t);
    const up = new Promise((resolve) => link.clientPeer.on("e2e", resolve));
    link.clientPeer.e2e();
    await up;

    const payload = new Uint8Array(1024);
    let observed = 0;

    const socket = rawSocket(link.clientPeer);
    const original = socket.send.bind(socket);
    socket.send = (data, cb) => { observed += data.length; return original(data, cb); };

    await link.clientPeer.send(payload);
    await wait(50);

    // AES-CBC: a 16-byte IV plus padding to the block size, and the header.
    assert.ok(observed < payload.length * 1.5,
        payload.length + " bytes became " + observed + " on the wire");
});

test("request/reply still matches up on binary frames", async (t) => {
    const link = await pair(t);
    link.server.on("message", (packet) => packet.reply({ seen: packet.msg.n }));

    const replies = await Promise.all([1, 2, 3].map((n) => link.clientPeer.send({ n }, true)));
    assert.deepEqual(replies.map((r) => r.msg.seen), [1, 2, 3]);
});

test("a relayed link stays on the legacy format", async (t) => {
    const relay = new AnySocket();
    const a = new AnySocket();
    const b = new AnySocket();
    t.after(() => stop(relay, a, b));

    relay.canProxy = () => true;

    const port = await listen(relay);
    await a.connect("ws", "127.0.0.1", port);
    await b.connect("ws", "127.0.0.1", port);
    await wait(150);

    const proxied = await a.proxy(b.id, relay.id);

    // Its frames are opaque to the relay, which re-wraps them per hop, so the
    // format has to be the lowest along the route — not knowable from here yet.
    assert.equal(proxied.protocolVersion(), constants.PROTOCOL_VERSION_LEGACY);

    const received = new Promise((resolve) => b.once("message", (packet) => resolve(packet.msg)));
    await proxied.send({ through: "the relay" });
    assert.deepEqual(await received, { through: "the relay" });
});
