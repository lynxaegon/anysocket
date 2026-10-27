const test = require("node:test");
const assert = require("node:assert");
const net = require("net");
const crypto = require("crypto");
const { EventEmitter } = require("events");
const AnyProtocol = require("../../src/libs/AnyProtocol");
const Frame = require("../../src/libs/Frame");
const E2E = require("../../src/libs/E2E");
const constants = require("../../src/libs/_constants");
const { listen, stop, wait, AnySocket } = require("../helpers/loopback");

/**
 * Ways to take a 1.0 connection back to the old protocol, where nothing is
 * authenticated: old-format frames slipped into a 1.0 session, a handshake with
 * its version removed, and a wss dial pushed onto plain ws.
 */

/** A text frame in the 0.4.x format, which 1.0.x writes its first AUTH in: plaintext JSON. */
function legacyFrame(type, payload, asBuffer = false) {
    const seq = new Uint8Array(4);
    new DataView(seq.buffer).setInt32(0, 77, false);
    const text = "1" + String(type) +
        String.fromCharCode(...seq) + JSON.stringify(payload);
    return asBuffer ? Buffer.from(text, "utf8") : text;
}

class MemoryPeer extends EventEmitter {
    constructor() {
        super();
        this.id = "22222222222242228222222222222222";
        this.connectionID = "memory";
        this.isProxy = false;
        this.reason = null;
    }
    isClient() { return false; }
    send() { return Promise.resolve(); }
    disconnect(reason) { this.reason = String(reason); }
}

/**
 * A receiver already past an authenticated 1.0 e2e handshake, with a known
 * receive key, so a test can hand it any frame and see what is delivered.
 */
function receiver(t) {
    const transport = new MemoryPeer();
    const secret = crypto.randomBytes(32);
    const owner = {
        id: "11111111111141118111111111111111",
        instanceID: "33333333333343338333333333333333",
        authSecret: () => secret,
        authOptional: () => false,
        authPacket: () => undefined,
        onAuth: () => true
    };
    const protocol = new AnyProtocol(owner, transport, { heartbeatEnabled: false, requireE2E: true });
    protocol.protocolVersion = constants.PROTOCOL_VERSION;
    protocol.remoteProtocolVersion = constants.PROTOCOL_VERSION;
    protocol.e2eRequired = true;
    protocol.ENCRYPTION_STATE = constants.PROTOCOL_ENCRYPTION.E2EE;
    protocol.changeState(constants.PROTOCOL_STATES.CONNECTED);

    const session = Object.getOwnPropertySymbols(protocol).find((s) => s.description === "e2e session");
    const recvKey = { cipher: "aes-256-gcm", raw: crypto.randomBytes(32), webKey: null };
    protocol[session] = {
        ready: true, authenticated: true, kex: "x25519", cipher: "aes-256-gcm",
        sendKey: { cipher: "aes-256-gcm", raw: crypto.randomBytes(32), webKey: null },
        recvKey, sendCounter: 0, recvCounter: 0, binding: new Uint8Array(32)
    };

    const delivered = [];
    protocol.on("message", (_, packet) => delivered.push(packet));
    protocol.on("internal", (_, packet) => delivered.push(packet));
    t.after(() => protocol.disconnect("test done"));

    const feed = async (bytes) => {
        transport.emit("message", transport, bytes);
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
    };
    return { transport, recvKey, delivered, feed };
}

async function sealed(key, type, payload) {
    const header = Frame.encode({ flags: Frame.FLAGS.FINAL | Frame.FLAGS.FIRST | Frame.FLAGS.ENCRYPTED, type, seq: 77, payload: new Uint8Array(0) });
    return Frame.concat([header, await E2E.seal(key, 0, header, Frame.bytes(JSON.stringify(payload)))]);
}

test("an encrypted 1.0 frame is delivered", async (t) => {
    const r = receiver(t);
    await r.feed(await sealed(r.recvKey, constants.PACKET_TYPE.LINK, { marker: "valid" }));
    assert.deepEqual(r.delivered.map((p) => p.data), [{ marker: "valid" }]);
    assert.equal(r.transport.reason, null);
});

test("a plaintext 1.0 frame on an encrypted connection is refused", async (t) => {
    const r = receiver(t);
    await r.feed(Frame.encode({
        flags: Frame.FLAGS.FINAL | Frame.FLAGS.FIRST,
        type: constants.PACKET_TYPE.LINK,
        seq: 77,
        payload: Frame.bytes(JSON.stringify({ marker: "plaintext" }))
    }));
    assert.equal(r.delivered.length, 0);
    assert.notEqual(r.transport.reason, null);
});

for (const asBuffer of [false, true]) {
    test(`a text frame after the handshake is refused (${asBuffer ? "Buffer" : "string"})`, async (t) => {
        const r = receiver(t);
        await r.feed(legacyFrame(constants.PACKET_TYPE.LINK, { marker: "forged" }, asBuffer));
        assert.equal(r.delivered.length, 0, "forged plaintext was delivered");
        assert.notEqual(r.transport.reason, null);
    });
}

test("a text RPC after the handshake is refused", async (t) => {
    const r = receiver(t);
    await r.feed(legacyFrame(constants.PACKET_TYPE.INTERNAL, {
        type: constants.INTERNAL_PACKET_TYPE.RPC, method: ["nothing"], params: [], bin: []
    }, true));
    assert.equal(r.delivered.length, 0, "forged RPC was delivered");
    assert.notEqual(r.transport.reason, null);
});

/** A raw tcp socket, framed as the tcp transport frames: a 4-byte length, then the bytes. */
function rawSocket(t, port) {
    const socket = net.connect(port, "127.0.0.1");
    t.after(() => socket.destroy());
    socket.on("error", () => {});
    // Read what the server sends, or "close" never comes.
    socket.resume();
    return {
        ready: new Promise((resolve) => socket.on("connect", resolve)),
        closed: new Promise((resolve) => socket.on("close", resolve)),
        write(bytes) {
            const length = Buffer.alloc(4);
            length.writeUInt32BE(bytes.length);
            socket.write(Buffer.concat([length, Buffer.from(bytes)]));
        }
    };
}

async function tcpServer(t, options = {}) {
    const server = new AnySocket();
    t.after(() => stop(server));
    const reasons = [];
    server.on("disconnected", (_p, reason) => reasons.push(String(reason)));
    const port = await server.listen("tcp", Object.assign({ port: 0 }, options));
    return { server, port, reasons };
}

const id = () => crypto.randomBytes(16).toString("hex");

test("over a socket, a text frame after a 1.0.x AUTH drops the connection", async (t) => {
    const { server, port } = await tcpServer(t, { acceptLegacyHandshake: true });
    let delivered = false;
    let connected = false;
    server.on("message", () => { delivered = true; });
    server.on("connected", () => { connected = true; });

    const raw = rawSocket(t, port);
    await raw.ready;
    raw.write(Buffer.from(legacyFrame(constants.PACKET_TYPE.AUTH, { id: id(), pv: 1, inst: id() })));
    await wait(100);
    raw.write(Buffer.from(legacyFrame(constants.PACKET_TYPE.LINK, { marker: "forged" })));

    await raw.closed;
    assert.equal(connected, true, "the 1.0.x AUTH was read");
    assert.equal(delivered, false);
});

test("a 1.0 handshake with its version removed is refused", async (t) => {
    const { port } = await tcpServer(t);
    const raw = rawSocket(t, port);
    await raw.ready;
    // What a 1.0 peer sends, minus `pv`: it reads as 0.4.x, but no 0.4.x peer
    // sends an instance id.
    raw.write(Buffer.from(legacyFrame(constants.PACKET_TYPE.AUTH, { id: id(), inst: id() })));
    await raw.closed;
});

test("the built-in auth's challenge with the version removed is refused", async (t) => {
    const { port } = await tcpServer(t, { auth: { secret: "s" } });
    const raw = rawSocket(t, port);
    await raw.ready;
    raw.write(Buffer.from(legacyFrame(constants.PACKET_TYPE.AUTH, {
        id: id(), ac: crypto.randomBytes(32).toString("base64")
    })));
    await raw.closed;
});

test("a failed wss dial is final by default", async (t) => {
    const server = new AnySocket();
    const client = new AnySocket();
    t.after(() => stop(server, client));
    let reached = false;
    server.on("connected", () => { reached = true; });
    const port = await listen(server);

    await assert.rejects(client.connect("ws", "127.0.0.1", port));
    await wait(100);
    assert.equal(reached, false, "it went on to dial plain ws");
});

test("with allowInsecureWSFallback on, a failed wss dial is retried as plain ws", async (t) => {
    const server = new AnySocket();
    const client = new AnySocket();
    t.after(() => stop(server, client));
    const port = await listen(server);

    assert.ok(await client.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true }));
});
