const test = require("node:test");
const assert = require("node:assert");
const net = require("net");
const WebSocket = require("ws");
const Frame = require("../../src/libs/Frame");
const constants = require("../../src/libs/_constants");
const { pair, listen, stop, rawSocket, protocolOf, wait, AnySocket } = require("../helpers/loopback");

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

// A 1.0.x dialler writes its first AUTH as text, not knowing yet what the other end
// speaks. Nothing here does: a 1.0.x listener reads a frame AUTH as it reads any
// frame, and there is no older listener left to write text for.
test("a dialler's first AUTH is a binary frame, over ws", async (t) => {
    const server = new WebSocket.Server({ port: 0 });
    t.after(() => server.close());
    await new Promise((resolve) => server.on("listening", resolve));
    const first = new Promise((resolve) => server.on("connection", (socket) => {
        socket.once("message", (data, isBinary) => resolve({ data, isBinary }));
    }));

    const client = new AnySocket();
    t.after(() => stop(client));
    client.connect("ws", "127.0.0.1", server.address().port, { authTimeout: 500 }).catch(() => {});

    const { data, isBinary } = await first;
    assert.notEqual(typeof data, "string", "sent as a text message");
    if (isBinary !== undefined) assert.equal(isBinary, true);
    assert.ok(Frame.isFrame(data));
    const frame = Frame.decode(data);
    assert.equal(frame.type, constants.PACKET_TYPE.AUTH);
    assert.equal(JSON.parse(Frame.text(frame.payload)).pv, constants.PROTOCOL_VERSION);
});

test("a dialler's first AUTH is a binary frame, over tcp", async (t) => {
    const server = net.createServer();
    t.after(() => server.close());
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const first = new Promise((resolve) => server.on("connection", (socket) => {
        socket.on("error", () => {});
        let buffered = Buffer.alloc(0);
        socket.on("data", (d) => {
            buffered = Buffer.concat([buffered, d]);
            if (buffered.length >= 4 && buffered.length >= 4 + buffered.readUInt32BE(0)) {
                resolve(buffered.subarray(4, 4 + buffered.readUInt32BE(0)));
                socket.destroy();
            }
        });
    }));

    const client = new AnySocket();
    t.after(() => stop(client));
    client.connect("tcp", "127.0.0.1", server.address().port, { authTimeout: 500 }).catch(() => {});

    const data = await first;
    assert.ok(Frame.isFrame(data), "starts with " + data[0]);
    assert.equal(Frame.decode(data).type, constants.PACKET_TYPE.AUTH);
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
    // several characters. Now it is the payload, one 6-byte header, and one byte
    // saying what kind of body follows.
    assert.equal(observed, payload.length + Frame.HEADER_SIZE + 1);
});

test("a large binary payload survives chunking", async (t) => {
    const link = await pair(t);
    const payload = new Uint8Array(protocolOf(link.clientPeer).options.maxPacketSize + 2048);
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

/** A relay with two peers dialled into it. */
async function trio(t) {
    const relay = new AnySocket();
    const a = new AnySocket();
    const b = new AnySocket();
    t.after(() => stop(relay, a, b));

    relay.canProxy = () => true;
    b.canAcceptProxy = () => true;

    const port = await listen(relay);
    await a.connect("ws", "127.0.0.1", port);
    await b.connect("ws", "127.0.0.1", port);
    await wait(150);

    return { relay, a, b, port };
}

// A relayed frame is opaque bytes the relay re-wraps for each hop, so its
// format has to be one every hop can carry — and an endpoint cannot see the
// version of a hop further along. The relay settles it by requiring 1.0 on
// both hops, which makes the relayed link 1.0 at both ends by construction.
test("a relayed link speaks 1.0", async (t) => {
    const { relay, a, b } = await trio(t);
    const proxied = await a.proxy(b.id, relay.id);

    assert.equal(proxied.protocolVersion(), constants.PROTOCOL_VERSION);
    assert.ok(proxied.supportsRelay());

    const received = new Promise((resolve) => b.once("message", (packet) => resolve(packet.msg)));
    await proxied.send({ through: "the relay" });
    assert.deepEqual(await received, { through: "the relay" });
});

test("binary travels over a relayed link as bytes", async (t) => {
    const { relay, a, b } = await trio(t);
    const proxied = await a.proxy(b.id, relay.id);

    const payload = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const received = new Promise((resolve) => b.once("message", (packet) => resolve(packet.msg)));
    await proxied.send(payload);

    const got = await received;
    assert.ok(got instanceof Uint8Array, "expected bytes through the relay");
    assert.deepEqual(Array.from(got), Array.from(payload));
});

test("a chunked payload survives a relayed link", async (t) => {
    const { relay, a, b } = await trio(t);
    const proxied = await a.proxy(b.id, relay.id);

    const payload = new Uint8Array(5 * 1024 * 1024);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 256;

    const received = new Promise((resolve) => b.once("message", (packet) => resolve(packet.msg)));
    await proxied.send(payload);

    const got = await received;
    assert.equal(got.length, payload.length);
    assert.deepEqual(Array.from(got.subarray(-16)), Array.from(payload.subarray(-16)));
});
