const test = require("node:test");
const assert = require("node:assert");
const net = require("net");
const crypto = require("crypto");
const Frame = require("../../src/libs/Frame");
const { stop, wait, AnySocket } = require("../helpers/loopback");

/**
 * A raw tcp connection that speaks 1.0 frames by hand, so a test can send what
 * no well-behaved peer would: a second AUTH, a SWITCH that is not an e2e offer,
 * a length hint for a message that never comes.
 */
function rawPeer(t, port) {
    const socket = net.connect(port, "127.0.0.1");
    t.after(() => socket.destroy());
    let buffered = Buffer.alloc(0);
    const inbox = [];
    const waiting = [];
    socket.on("data", (d) => {
        buffered = Buffer.concat([buffered, d]);
        while (buffered.length >= 4) {
            const n = buffered.readUInt32BE(0);
            if (buffered.length < 4 + n) break;
            const frame = Frame.decode(buffered.subarray(4, 4 + n));
            buffered = buffered.subarray(4 + n);
            const msg = { type: frame.type, data: JSON.parse(Frame.text(frame.payload)) };
            if (waiting.length) waiting.shift()(msg); else inbox.push(msg);
        }
    });
    socket.on("error", () => {});

    let seq = 1;
    const write = (bytes) => {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(bytes.length);
        socket.write(Buffer.concat([length, Buffer.from(bytes)]));
    };
    return {
        socket,
        ready: new Promise((resolve) => socket.on("connect", resolve)),
        closed: new Promise((resolve) => socket.on("close", resolve)),
        send(type, body) {
            write(Frame.encode({ flags: 0x11, type, seq: seq++, payload: Frame.bytes(JSON.stringify(body)) }));
        },
        write,
        next() {
            return inbox.length ? Promise.resolve(inbox.shift()) : new Promise((resolve) => waiting.push(resolve));
        }
    };
}

const AUTH = 1;
const SWITCH = 4;
const AUTH_CONFIRM = 7;
const challenge = () => crypto.randomBytes(32).toString("base64");

// Someone without the secret, using one peer to sign the proof another expects.
// It worked while a listener would take a second AUTH on the same connection:
// that signs a fresh proof over its old challenge and a new one of the
// sender's choosing.
test("a second AUTH on a connection is refused, so a peer cannot be used to sign for another", async (t) => {
    const secret = { auth: { secret: "shared-secret" } };
    const v = new AnySocket(secret);
    const w = new AnySocket(secret);
    t.after(() => stop(v, w));
    const portV = await v.listen("tcp", { port: 0 });
    const portW = await w.listen("tcp", { port: 0 });

    let forged = null;
    w.on("connected", (peer) => { forged = peer; });

    const toV = rawPeer(t, portV);
    await toV.ready;
    toV.send(AUTH, { id: w.id, pv: 1, caps: [], ac: challenge() });
    const challengeV = (await toV.next()).data.ac;

    const toW = rawPeer(t, portW);
    await toW.ready;
    toW.send(AUTH, { id: v.id, pv: 1, caps: [], ac: challengeV });
    const challengeW = (await toW.next()).data.ac;

    // The second AUTH, which used to get V to sign over (V, cV, W, cW). Refused,
    // V closes instead of answering.
    toV.send(AUTH, { id: w.id, pv: 1, caps: [], ac: challengeW });
    const answer = await Promise.race([toV.next(), toV.closed.then(() => null)]);
    assert.equal(answer, null, "V must not answer a second AUTH");

    // What the attack would do with an answer: hand V's proof to W.
    if (answer) toW.send(AUTH_CONFIRM, { ap: answer.data.ap });
    await wait(300);
    assert.equal(forged, null, "W must not accept a connection as V");
});

// The 0.4.x exchange is gone. Accepted on a 1.0 connection it only ever marked the
// connection encrypted and satisfied requireE2E, while everything went in clear; a
// SWITCH in its shape has to drop the connection, not be ignored or half-run.
test("a SWITCH that is not an e2e offer drops the connection", async (t) => {
    const victim = new AnySocket();
    t.after(() => stop(victim));
    const port = await victim.listen("tcp", { port: 0, requireE2E: true });

    let connected = false;
    victim.on("connected", () => { connected = true; });

    const attacker = rawPeer(t, port);
    await attacker.ready;
    attacker.send(AUTH, { id: crypto.randomBytes(16).toString("hex"), pv: 1, caps: [] });
    attacker.send(SWITCH, { type: 2, key: crypto.randomBytes(133).toString("base64"), nonce: crypto.randomBytes(32).toString("hex") });

    await attacker.closed;
    assert.equal(connected, false);
});

// The total a multi-chunk message announces is the sender's word. Taken as it
// was, 11 bytes before auth had us allocate 4GB.
test("a length hint over the cap is refused before anything is allocated", async (t) => {
    const server = new AnySocket({ auth: { secret: "s3cret" } });
    t.after(() => stop(server));
    const port = await server.listen("tcp", { port: 0 });

    const before = process.memoryUsage().arrayBuffers;
    const attacker = rawPeer(t, port);
    await attacker.ready;
    // FIRST, not FINAL; AUTH; seq 1; a hint of 4GB-1; one byte of body
    attacker.write([0x10, AUTH, 0, 0, 0, 1, 0xff, 0xff, 0xff, 0xff, 0x41]);

    await attacker.closed;
    const grew = process.memoryUsage().arrayBuffers - before;
    assert.ok(grew < 64 * 1024 * 1024, "allocated " + grew + " bytes for an 11-byte frame");
});

test("a frame that fails to decode ends the connection, not the process", async (t) => {
    const server = new AnySocket();
    t.after(() => stop(server));
    const port = await server.listen("tcp", { port: 0 });

    // An allocation the runtime refuses, the way a memory-capped one would.
    const Real = global.Uint8Array;
    let refused = false;
    global.Uint8Array = new Proxy(Real, {
        construct(target, args) {
            if (args[0] === 1000) { refused = true; throw new RangeError("Array buffer allocation failed"); }
            return Reflect.construct(target, args);
        }
    });
    t.after(() => { global.Uint8Array = Real; });

    const unhandled = [];
    const onUnhandled = (e) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    t.after(() => process.off("unhandledRejection", onUnhandled));

    const attacker = rawPeer(t, port);
    await attacker.ready;
    attacker.write([0x10, AUTH, 0, 0, 0, 1, 0, 0, 0x03, 0xe8, 0x41]);   // hint: 1000 bytes
    await attacker.closed;
    await wait(50);

    global.Uint8Array = Real;
    assert.ok(refused, "the test never reached the allocation it means to fail");
    assert.deepEqual(unhandled, []);
});

test("a binary ws message too short for a header ends the connection, not the process", async (t) => {
    const WebSocket = require("ws");
    const server = new AnySocket();
    t.after(() => stop(server));
    const port = await server.listen("ws", { port: 0 });

    const unhandled = [];
    const onUnhandled = (e) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    t.after(() => process.off("unhandledRejection", onUnhandled));

    // What a 0.4.x browser client's send(argsArray) became over node's ws: one 0x00.
    for (const bytes of [[0x00], [0x10, 0x01], [0x00, 0x00, 0x00, 0x00, 0x00]]) {
        const attacker = new WebSocket("ws://127.0.0.1:" + port + "/");
        await new Promise((resolve) => attacker.on("open", resolve));
        const closed = new Promise((resolve) => attacker.on("close", resolve));
        attacker.send(Buffer.from(bytes));
        await closed;
    }
    await wait(50);
    assert.deepEqual(unhandled, []);

    // and it still serves
    const client = new AnySocket();
    t.after(() => stop(client));
    await client.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true });
});

// ---- relay announcements ------------------------------------------------------

async function viaRelay(t) {
    const v = new AnySocket();
    const a = new AnySocket();
    const b = new AnySocket();
    t.after(() => stop(v, a, b));
    const port = await v.listen("tcp", { port: 0 });
    const aV = await a.connect("tcp", "127.0.0.1", port);
    await b.connect("tcp", "127.0.0.1", port);
    await wait(100);
    return { v, a, b, aV };
}

test("a peer cannot end our direct connection to another peer", async (t) => {
    const { v, b, aV } = await viaRelay(t);

    aV.sendInternal({ type: 1, action: "disconnected", id: b.id });
    await wait(200);

    assert.ok(v.hasDirectPeer(b.id), "the direct connection to B must survive");
});

test("a peer cannot announce relayed peers we did not accept", async (t) => {
    const { v, aV } = await viaRelay(t);
    const fake = crypto.randomBytes(16).toString("hex");

    aV.sendInternal({ type: 1, action: "connected", id: fake });
    await wait(200);

    assert.equal(v.hasPeer(fake), false);
});

test("a relayed link the target refuses rejects proxy() with the reason", async (t) => {
    const relay = new AnySocket();
    const a = new AnySocket();
    const b = new AnySocket();
    t.after(() => stop(relay, a, b));
    relay.canProxy = () => true;
    // b leaves canAcceptProxy at its default: no

    const port = await relay.listen("tcp", { port: 0 });
    await a.connect("tcp", "127.0.0.1", port);
    await b.connect("tcp", "127.0.0.1", port);
    await wait(100);

    await assert.rejects(a.proxy(b.id, relay.id), /refused by the peer/);
    assert.equal(a.hasPeer(b.id), false);
    assert.equal(b.hasPeer(a.id), false);
});

test("a relayed link over a connection that requires e2e is encrypted before anyone gets it", async (t) => {
    const relay = new AnySocket();
    const a = new AnySocket();
    const b = new AnySocket();
    t.after(() => stop(relay, a, b));
    relay.canProxy = () => true;
    b.canAcceptProxy = () => true;

    const port = await relay.listen("tcp", { port: 0, requireE2E: true });
    await a.connect("tcp", "127.0.0.1", port);
    await b.connect("tcp", "127.0.0.1", port);
    await wait(100);

    const bSeesA = new Promise((resolve) => b.on("connected", (peer) => { if (peer.id === a.id) resolve(peer); }));
    const proxied = await a.proxy(b.id, relay.id);
    assert.ok(proxied.isProxy());
    assert.ok(proxied.isE2EEnabled(), "proxy() must not resolve before e2e is up");

    const fromA = await bSeesA;
    assert.ok(fromA.isE2EEnabled(), "\"connected\" must not fire before e2e is up");

    const received = new Promise((resolve) => b.on("message", (packet) => resolve(packet.msg)));
    await proxied.send({ through: "the relay, encrypted" });
    assert.deepEqual(await received, { through: "the relay, encrypted" });
});

// The requirement can come from the far hop alone: here only the target dialled
// the relay asking for it. The relay carries it to the dialler, which starts e2e.
test("a relayed link is encrypted when only the far hop requires it", async (t) => {
    const relay = new AnySocket();
    const a = new AnySocket();
    const b = new AnySocket();
    t.after(() => stop(relay, a, b));
    relay.canProxy = () => true;
    b.canAcceptProxy = () => true;

    const port = await relay.listen("tcp", { port: 0 });
    await a.connect("tcp", "127.0.0.1", port);
    await b.connect("tcp", "127.0.0.1", port, { requireE2E: true });
    await wait(100);

    const bSeesA = new Promise((resolve) => b.on("connected", (peer) => { if (peer.id === a.id) resolve(peer); }));
    const proxied = await a.proxy(b.id, relay.id);
    assert.ok(proxied.isE2EEnabled());
    assert.ok((await bSeesA).isE2EEnabled());
});
