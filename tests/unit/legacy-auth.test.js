const test = require("node:test");
const assert = require("node:assert");
const LegacyAuth = require("../../src/libs/LegacyAuth");
const Packet = require("../../src/libs/Packet");
const Frame = require("../../src/libs/Frame");

/**
 * LegacyAuth reads one thing: the whole first AUTH of a 1.0.x dialler, in its
 * text format. Everything else in that format must come back null.
 */

const FULL = "1";
const PARTIAL = "2";
// The text format: a 1-char end flag, a 1-char type, a 4-char seq, then JSON.
const text = (eol, type, seq, payload) =>
    String(eol) + String(type) + String.fromCharCode(seq >>> 24, (seq >>> 16) & 0xff, (seq >>> 8) & 0xff, seq & 0xff) + payload;

test("a whole text AUTH is read, as a string or as bytes", (t) => {
    const auth = text(FULL, Packet.TYPE.AUTH, 1, JSON.stringify({ id: "a", pv: 1 }));

    for (const recv of [auth, Frame.bytes(auth), Buffer.from(auth, "utf8")]) {
        const packet = LegacyAuth.read(recv, 64 * 1024);
        assert.ok(packet, "not read from " + typeof recv);
        assert.equal(packet.type, Packet.TYPE.AUTH);
        assert.equal(packet.seq, 1);
        assert.deepEqual(packet.data, { id: "a", pv: 1 });
    }
});

test("the seq of a text AUTH survives characters past ASCII", (t) => {
    const seq = 0x01ff80c3;
    const auth = text(FULL, Packet.TYPE.AUTH, seq, "{}");
    // As a 1.0.x dialler's tcp transport sends it: the string as UTF-8.
    assert.equal(LegacyAuth.read(Buffer.from(auth, "utf8"), 1024).seq, seq);
});

test("text that is not one whole AUTH is not read", (t) => {
    const body = JSON.stringify({ id: "a", pv: 1 });
    const cases = {
        "a partial AUTH": text(PARTIAL, Packet.TYPE.AUTH, 1, body),
        "a LINK": text(FULL, Packet.TYPE.LINK, 1, body),
        "a SWITCH": text(FULL, Packet.TYPE.SWITCH, 1, body),
        "a FORWARD": String(Packet.TYPE.FORWARD) + "x".repeat(40),
        "a body that is not JSON": text(FULL, Packet.TYPE.AUTH, 1, "{ not json"),
        "a body that is not an object": text(FULL, Packet.TYPE.AUTH, 1, "[1,2]"),
        "a null body": text(FULL, Packet.TYPE.AUTH, 1, "null"),
        "a header and nothing else": "11",
        "nothing": ""
    };
    for (const [name, recv] of Object.entries(cases)) {
        assert.equal(LegacyAuth.read(recv, 64 * 1024), null, name);
    }
});

test("a text AUTH over the cap is not read", (t) => {
    const auth = text(FULL, Packet.TYPE.AUTH, 1, JSON.stringify({ id: "a", pad: "x".repeat(2000) }));
    assert.equal(LegacyAuth.read(auth, 1024), null);
    assert.equal(LegacyAuth.read(Frame.bytes(auth), 1024), null);
    assert.ok(LegacyAuth.read(auth, 4096));
});
