const test = require("node:test");
const assert = require("node:assert");
const Packet = require("../../src/libs/Packet");
const AnyPacker = require("../../src/libs/AnyPacker");
const constants = require("../../src/libs/_constants");
const { pair, rawSocket, wait } = require("../helpers/loopback");

const frame = (eol, type, seq, payload) =>
    String(eol) + String(type) + AnyPacker.packInt32(seq) + payload;

test("a packet round-trips through encode and decode", async (t) => {
    const out = Packet.data({ hello: "world" }).setType(Packet.TYPE.LINK).setSeq(7);
    const chunks = await out.serialize(constants.MAX_PACKET_SIZE, (p) => Promise.resolve(p));

    assert.equal(chunks.length, 1);
    const back = Packet.buffer();
    assert.equal(await back.deserialize(chunks[0], constants.PROTOCOL_ENCRYPTION.PLAIN), true);
    assert.deepEqual(back.data, { hello: "world" });
    assert.equal(back.seq, 7);
    assert.equal(back.parseError, false);
});

test("a message larger than the packet size is split and rejoined", async (t) => {
    const payload = { blob: "y".repeat(2500) };
    const out = Packet.data(payload).setType(Packet.TYPE.LINK).setSeq(3);
    const chunks = await out.serialize(1000, (p) => Promise.resolve(p));

    assert.ok(chunks.length > 1, "expected several chunks");

    const back = Packet.buffer();
    let done = false;
    for (const chunk of chunks) {
        done = await back.deserialize(chunk, constants.PROTOCOL_ENCRYPTION.PLAIN);
    }

    assert.equal(done, true);
    assert.deepEqual(back.data, payload);
});

// Regression: an undecodable payload was dispatched with data = null, so
// handlers saw a packet that never existed.
test("an undecodable payload is flagged, not delivered as null", async (t) => {
    const bad = frame(constants.PACKET_LENGTH.FULL, Packet.TYPE.LINK, 9, "{ not json");
    const back = Packet.buffer();

    assert.equal(await back.deserialize(bad, constants.PROTOCOL_ENCRYPTION.PLAIN), true);
    assert.equal(back.parseError, true);
    assert.equal(back.data, null);
});

test("an undecodable payload drops the connection", async (t) => {
    const link = await pair(t);
    const gone = new Promise((resolve) => link.server.on("disconnected", (_peer, reason) => resolve(reason)));

    rawSocket(link.clientPeer).send(
        frame(constants.PACKET_LENGTH.FULL, Packet.TYPE.LINK, 11, "{ not json")
    );

    assert.match(String(await gone), /Invalid Packet/i);
    await wait(50);
    await link.stop();
});

test("a packet type the state does not expect drops the connection", async (t) => {
    const link = await pair(t);
    const gone = new Promise((resolve) => link.server.on("disconnected", (_peer, reason) => resolve(reason)));

    // AUTH is only valid during the handshake, never on a live connection.
    rawSocket(link.clientPeer).send(
        frame(constants.PACKET_LENGTH.FULL, Packet.TYPE.AUTH, 12, JSON.stringify({ id: "intruder" }))
    );

    assert.match(String(await gone), /Invalid Packet/i);
    await wait(50);
    await link.stop();
});

// Small 1.0 messages skip the async chunk generator. The bytes must be exactly what it
// would have produced, or a peer reading the other path would see something else.
test("a single-frame message encodes to the same bytes either way", async (t) => {
    const collect = async (packet, size) => {
        const out = [];
        for await (const chunk of packet.chunks(size, null, constants.PROTOCOL_VERSION)) out.push(chunk);
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
    for await (const c of viaFast.chunks(1000, null, constants.PROTOCOL_VERSION)) a.push(Buffer.from(c));
    for await (const c of make().chunks(1000, null, constants.PROTOCOL_VERSION)) b.push(Buffer.from(c));
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
    assert.equal(await back.deserialize(first, constants.PROTOCOL_ENCRYPTION.PLAIN, (s, p) => Promise.resolve(p)), false);
    assert.ok(back.assembled.length <= 64 * 1024 * 1024, "allocated " + back.assembled.length);
});
