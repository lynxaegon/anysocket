const test = require("node:test");
const assert = require("node:assert");
const Frame = require("../../src/libs/Frame");
const Packet = require("../../src/libs/Packet");
const constants = require("../../src/libs/_constants");

test("a frame round-trips through encode and decode", (t) => {
    const encoded = Frame.encode({
        flags: Frame.FLAGS.FINAL,
        type: constants.PACKET_TYPE.LINK,
        seq: 1234,
        payload: Frame.bytes("hello")
    });

    assert.ok(encoded instanceof Uint8Array);
    assert.equal(encoded.length, Frame.HEADER_SIZE + 5);

    const back = Frame.decode(encoded);
    assert.equal(back.type, constants.PACKET_TYPE.LINK);
    assert.equal(back.seq, 1234);
    assert.equal(back.final, true);
    assert.equal(back.encrypted, false);
    assert.equal(back.binary, false);
    assert.equal(Frame.text(back.payload), "hello");
});

test("the flags survive the trip", (t) => {
    const back = Frame.decode(Frame.encode({
        flags: Frame.FLAGS.FINAL | Frame.FLAGS.ENCRYPTED | Frame.FLAGS.BINARY,
        type: constants.PACKET_TYPE.INTERNAL,
        seq: 7,
        payload: new Uint8Array([1, 2, 3])
    }));

    assert.equal(back.final, true);
    assert.equal(back.encrypted, true);
    assert.equal(back.binary, true);
    assert.deepEqual(Array.from(back.payload), [1, 2, 3]);
});

// The legacy format negated the seq to mark a reply, which cost a bit of range
// and could not be told apart from a decode slip. A flag carries it now, but
// the value handed upwards keeps the old meaning.
test("a reply keeps the negative seq everything above the codec expects", (t) => {
    const encoded = Frame.encode({
        flags: Frame.FLAGS.FINAL | Frame.FLAGS.REPLY,
        type: constants.PACKET_TYPE.LINK,
        seq: -42,
        payload: Frame.bytes("{}")
    });

    assert.equal(Frame.decode(encoded).seq, -42);
    assert.equal(Frame.getSeq(encoded), -42);
});

test("the header can be read without decoding the payload", (t) => {
    const encoded = Frame.encode({
        flags: Frame.FLAGS.FINAL,
        type: constants.PACKET_TYPE.HEARTBEAT,
        seq: 9,
        payload: Frame.bytes("x")
    });

    assert.equal(Frame.getType(encoded), constants.PACKET_TYPE.HEARTBEAT);
    assert.equal(Frame.getSeq(encoded), 9);
});

test("the full 32-bit seq range is usable", (t) => {
    const encoded = Frame.encode({ flags: 0, type: 1, seq: 0xffffffff, payload: Frame.bytes("") });
    assert.equal(Frame.getSeq(encoded), 0xffffffff);

    assert.throws(() => Frame.encode({ flags: 0, type: 1, seq: 0x100000000, payload: Frame.bytes("") }));
});

test("a truncated frame is rejected rather than misread", (t) => {
    assert.throws(() => Frame.decode(new Uint8Array([1, 2, 3])));
});

// Decided from the data, so a frame and a 1.0.x dialler's text AUTH cannot be
// mistaken for each other even when both arrive as bytes.
test("a frame and text are told apart by their first byte", (t) => {
    const legacy = "1" + "1" + "\0\0\0\1" + "{}";
    assert.equal(Frame.isFrame(legacy), false);
    assert.equal(Frame.isFrame(Frame.bytes(legacy)), false, "text handed over as bytes");

    const frame = Frame.encode({ flags: Frame.FLAGS.FINAL, type: 3, seq: 1, payload: Frame.bytes("{}") });
    assert.equal(Frame.isFrame(frame), true);
});

// A 1.0.x dialler's first AUTH is the one text packet still read, and over tcp it
// arrives as bytes.
test("a text AUTH delivered as bytes is still read", (t) => {
    const auth = "1" + String(Packet.TYPE.AUTH) + "\0\0\0\1" +
        JSON.stringify({ id: "a", pv: 1 });

    const packet = require("../../src/libs/LegacyAuth").read(Frame.bytes(auth), 64 * 1024);
    assert.ok(packet);
    assert.deepEqual(packet.data, { id: "a", pv: 1 });
});

test("every packet serializes to binary frames", async (t) => {
    for (const data of [{ a: 1 }, "text", 0, new Uint8Array([1, 2])]) {
        const chunks = await Packet.data(data).setType(Packet.TYPE.LINK).setSeq(3).serialize(1024 * 1024);
        assert.ok(chunks[0] instanceof Uint8Array);
        assert.ok(Frame.isFrame(chunks[0]));
    }
});

test("a binary payload round-trips without a base64 detour", async (t) => {
    const payload = new Uint8Array([0, 1, 2, 250, 251, 255]);
    const out = Packet.data(payload).setType(Packet.TYPE.LINK).setSeq(11);
    const chunks = await out.serialize(1024 * 1024);

    // bytes on the wire, not a base64 or JSON expansion of them: the header,
    // one byte saying what kind of body follows, and the bytes themselves
    assert.equal(chunks[0].length, Frame.HEADER_SIZE + 1 + payload.length);

    const back = Packet.buffer();
    assert.equal(await back.deserialize(chunks[0]), true);
    assert.equal(back.binary, true);
    assert.deepEqual(Array.from(back.data), Array.from(payload));
});

test("a chunked binary payload is rejoined byte for byte", async (t) => {
    const payload = new Uint8Array(5000);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 256;

    const out = Packet.data(payload).setType(Packet.TYPE.LINK).setSeq(12);
    const chunks = await out.serialize(1000);
    // 5000 bytes plus the one-byte body kind, in 1000-byte frames
    assert.equal(chunks.length, 6);

    const back = Packet.buffer();
    let done = false;
    for (const chunk of chunks) {
        done = await back.deserialize(chunk);
    }

    assert.equal(done, true);
    assert.deepEqual(Array.from(back.data), Array.from(payload));
});

// The legacy format chunked a JSON string by character, so a multi-byte
// character could be split across two chunks and arrive broken.
test("a multi-byte character survives being chunked", async (t) => {
    const data = { text: "€".repeat(500) };
    const out = Packet.data(data).setType(Packet.TYPE.LINK).setSeq(13);
    const chunks = await out.serialize(100);

    assert.ok(chunks.length > 1);

    const back = Packet.buffer();
    let done = false;
    for (const chunk of chunks) {
        done = await back.deserialize(chunk);
    }

    assert.equal(done, true);
    assert.deepEqual(back.data, data);
});

test("an undecodable binary frame is flagged, not delivered", async (t) => {
    const frame = Frame.encode({
        flags: Frame.FLAGS.FINAL,
        type: constants.PACKET_TYPE.LINK,
        seq: 14,
        payload: Frame.bytes("{ not json")
    });

    const back = Packet.buffer();
    assert.equal(await back.deserialize(frame), true);
    assert.equal(back.parseError, true);
    assert.equal(back.data, null);
});
