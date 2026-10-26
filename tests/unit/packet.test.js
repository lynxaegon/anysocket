const test = require("node:test");
const assert = require("node:assert");
const Packet = require("../../src/libs/Packet");
const Frame = require("../../src/libs/Frame");
const { pair, rawSocket, wait } = require("../helpers/loopback");

const frame = (type, seq, payload) =>
    Frame.encode({ flags: Frame.FLAGS.FIRST | Frame.FLAGS.FINAL, type, seq, payload: Frame.bytes(payload) });

// The 1.0.x text format: a 1-char end flag, a 1-char type, a 4-char seq, then JSON.
const text = (eol, type, seq, payload) =>
    String(eol) + String(type) + String.fromCharCode(seq >>> 24, (seq >>> 16) & 0xff, (seq >>> 8) & 0xff, seq & 0xff) + payload;

test("a packet round-trips through encode and decode", async (t) => {
    const out = Packet.data({ hello: "world" }).setType(Packet.TYPE.LINK).setSeq(7);
    const chunks = await out.serialize(1024 * 1024);

    assert.equal(chunks.length, 1);
    const back = Packet.buffer();
    assert.equal(await back.deserialize(chunks[0]), true);
    assert.deepEqual(back.data, { hello: "world" });
    assert.equal(back.seq, 7);
    assert.equal(back.parseError, false);
});

test("a message larger than the packet size is split and rejoined", async (t) => {
    const payload = { blob: "y".repeat(2500) };
    const out = Packet.data(payload).setType(Packet.TYPE.LINK).setSeq(3);
    const chunks = await out.serialize(1000);

    assert.ok(chunks.length > 1, "expected several chunks");

    const back = Packet.buffer();
    let done = false;
    for (const chunk of chunks) {
        done = await back.deserialize(chunk);
    }

    assert.equal(done, true);
    assert.deepEqual(back.data, payload);
});

// Regression: an undecodable payload was dispatched with data = null, so
// handlers saw a packet that never existed.
test("an undecodable payload is flagged, not delivered as null", async (t) => {
    const bad = frame(Packet.TYPE.LINK, 9, "{ not json");
    const back = Packet.buffer();

    assert.equal(await back.deserialize(bad), true);
    assert.equal(back.parseError, true);
    assert.equal(back.data, null);
});

// Text is never reassembled: the one text packet read, a 1.0.x dialler's AUTH, goes
// through LegacyAuth.
test("text handed to the frame decoder is flagged, not read", async (t) => {
    const back = Packet.buffer();
    const legacy = text("1", Packet.TYPE.LINK, 9, "{}");

    assert.equal(await back.deserialize(legacy), true);
    assert.equal(back.parseError, true);
    const asBytes = Packet.buffer();
    assert.equal(await asBytes.deserialize(Frame.bytes(legacy)), true);
    assert.equal(asBytes.parseError, true);
});

test("an undecodable payload drops the connection", async (t) => {
    const link = await pair(t);
    const gone = new Promise((resolve) => link.server.on("disconnected", (_peer, reason) => resolve(reason)));

    rawSocket(link.clientPeer).send(frame(Packet.TYPE.LINK, 11, "{ not json"));

    assert.match(String(await gone), /Invalid Packet/i);
    await wait(50);
    await link.stop();
});

test("a packet type the state does not expect drops the connection", async (t) => {
    const link = await pair(t);
    const gone = new Promise((resolve) => link.server.on("disconnected", (_peer, reason) => resolve(reason)));

    // AUTH is only valid during the handshake, never on a live connection.
    rawSocket(link.clientPeer).send(frame(Packet.TYPE.AUTH, 12, JSON.stringify({ id: "intruder" })));

    assert.match(String(await gone), /Invalid Packet/i);
    await wait(50);
    await link.stop();
});

// Small 1.0 messages skip the async chunk generator. The bytes must be exactly what it
// would have produced, or a peer reading the other path would see something else.
test("a single-frame message encodes to the same bytes either way", async (t) => {
    const collect = async (packet, size) => {
        const out = [];
        for await (const chunk of packet.chunks(size)) out.push(chunk);
        return out;
    };
    const bytes = new Uint8Array([1, 2, 3, 250]);
    const cases = [
        () => Packet.data({ hello: "world", n: [1, 2] }).setType(Packet.TYPE.LINK).setSeq(7),
        () => Packet.data({ reply: true }).setType(Packet.TYPE.LINK).setSeq(-9),
        () => Packet.data(bytes).setType(Packet.TYPE.LINK).setSeq(11),
        () => Packet.data("ünïcødé ✓").setType(Packet.TYPE.INTERNAL).setSeq(12),
    ];
    for (const make of cases) {
        const fast = make().singleFrame(1024);
        const slow = await collect(make(), 1024);
        assert.equal(slow.length, 1);
        assert.deepEqual(Buffer.from(fast), Buffer.from(slow[0]));
    }
});

test("a message too big for one frame is left to the chunk path, unchanged", async (t) => {
    const make = () => Packet.data({ blob: "z".repeat(5000) }).setType(Packet.TYPE.LINK).setSeq(5);
    const viaFast = make();
    assert.equal(viaFast.singleFrame(1000), null);
    const a = [], b = [];
    for await (const c of viaFast.chunks(1000)) a.push(Buffer.from(c));
    for await (const c of make().chunks(1000)) b.push(Buffer.from(c));
    assert.ok(a.length > 1);
    assert.deepEqual(a, b);
});

// With maxMessageSize unset there is no cap to hold an announced total to, and the whole
// total was allocated from the first frame: 11 bytes could reserve 4GB. Now only a part is
// allocated up front, and the rest as the bytes actually arrive.
test("an announced total is not allocated before the bytes arrive", async (t) => {
    const Frame = require("../../src/libs/Frame");
    const payload = new Uint8Array(Frame.LENGTH_HINT + 16);
    new DataView(payload.buffer).setUint32(0, 0xFFFFFFF0, false);
    const first = Frame.encode({ flags: Frame.FLAGS.FIRST | Frame.FLAGS.BINARY, type: Packet.TYPE.LINK, seq: 5, payload });

    const back = Packet.buffer();
    back.maxTotal = Infinity;
    assert.equal(await back.deserialize(first), false);
    assert.ok(back.assembled.length <= 64 * 1024 * 1024, "allocated " + back.assembled.length);
});
