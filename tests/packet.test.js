const test = require("node:test");
const assert = require("node:assert");
const Packet = require("../src/libs/Packet");
const AnyPacker = require("../src/libs/AnyPacker");
const constants = require("../src/libs/_constants");
const { pair, rawSocket, wait } = require("./helpers/loopback");

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
