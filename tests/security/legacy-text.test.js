const test = require("node:test");
const assert = require("node:assert");
const net = require("net");
const crypto = require("crypto");
const WebSocket = require("ws");
const Frame = require("../../src/libs/Frame");
const constants = require("../../src/libs/_constants");
const { pair, listen, stop, rawSocket, wait, disconnectReasons, AnySocket } = require("../helpers/loopback");

/**
 * The one text packet still read: a 1.0.x dialler's first AUTH. It is read by
 * LegacyAuth, which takes exactly one whole AUTH before the handshake and
 * nothing else, so none of the old format's reassembly is reachable. Everything
 * here is what must be refused.
 */

// The 1.0.x text format's end-of-message flag: whole, or one part of several.
const FULL = "1";
const PARTIAL = "2";
const { AUTH, LINK, SWITCH, HEARTBEAT, FORWARD } = constants.PACKET_TYPE;
const seq1 = String.fromCharCode(0, 0, 0, 1);
const text = (eol, type, body) => String(eol) + String(type) + seq1 + body;
const authBody = (extra) => JSON.stringify(Object.assign({ id: crypto.randomBytes(16).toString("hex"), pv: 1, caps: [] }, extra));

/** A raw connection over ws or tcp that can send text and frames, and see what comes back. */
async function raw(t, scheme, port) {
    const inbox = [];
    let socket;
    let closed;
    if (scheme == "ws") {
        socket = new WebSocket("ws://127.0.0.1:" + port + "/");
        socket.on("error", () => {});
        socket.on("message", (data) => inbox.push(data));
        closed = new Promise((resolve) => socket.on("close", resolve));
        await new Promise((resolve) => socket.on("open", resolve));
    } else {
        socket = net.connect(port, "127.0.0.1");
        socket.on("error", () => {});
        let buffered = Buffer.alloc(0);
        socket.on("data", (d) => {
            buffered = Buffer.concat([buffered, d]);
            while (buffered.length >= 4 && buffered.length >= 4 + buffered.readUInt32BE(0)) {
                inbox.push(buffered.subarray(4, 4 + buffered.readUInt32BE(0)));
                buffered = buffered.subarray(4 + buffered.readUInt32BE(0));
            }
        });
        closed = new Promise((resolve) => socket.on("close", resolve));
        await new Promise((resolve) => socket.on("connect", resolve));
    }
    t.after(() => (socket.terminate ? socket.terminate() : socket.destroy()));

    return {
        inbox,
        closed,
        send(message) {
            if (scheme == "ws") return socket.send(message);
            // As a 1.0.x dialler's tcp transport sends a string: UTF-8, length first.
            const body = typeof message == "string" ? Buffer.from(message, "utf8") : Buffer.from(message);
            const length = Buffer.alloc(4);
            length.writeUInt32BE(body.length);
            socket.write(Buffer.concat([length, body]));
        },
        /** Resolves "closed", or "open" if it is still up after `ms`. */
        outcome(ms = 2000) {
            return Promise.race([closed.then(() => "closed"), wait(ms).then(() => "open")]);
        }
    };
}

/**
 * A listener, watched for crashes, that must still serve a well-behaved peer afterwards.
 * It reads 1.0.x handshakes (acceptLegacyHandshake), so what is refused here is refused
 * by LegacyAuth itself.
 */
async function victim(t, scheme, options = { acceptLegacyHandshake: true }) {
    const reasons = disconnectReasons(t);
    const unhandled = [];
    const onUnhandled = (e) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    t.after(() => process.off("unhandledRejection", onUnhandled));

    const server = new AnySocket();
    t.after(() => stop(server));
    let arrived = 0;
    server.on("connected", () => { arrived++; });
    const port = scheme == "ws"
        ? await listen(server, options)
        : await server.listen("tcp", Object.assign({}, options, { port: 0 }));

    return {
        port,
        reasons,
        arrived: () => arrived,
        async stillServes() {
            await wait(30);
            assert.deepEqual(unhandled, []);
            const client = new AnySocket();
            t.after(() => stop(client));
            await client.connect(scheme, "127.0.0.1", port, { allowInsecureWSFallback: true });
        }
    };
}

for (const scheme of ["ws", "tcp"]) {
    const name = (what) => what + ", over " + scheme;

    // The positive case, so the refusals below are known to be refusals and not a
    // decoder that reads nothing at all.
    test(name("one whole text AUTH completes the handshake, answered with a frame"), async (t) => {
        const v = await victim(t, scheme);
        const attacker = await raw(t, scheme, v.port);

        attacker.send(text(FULL, AUTH, authBody()));
        await wait(200);

        assert.equal(v.arrived(), 1);
        assert.ok(attacker.inbox.length >= 1, "no answer");
        const answer = attacker.inbox[0];
        assert.notEqual(typeof answer, "string");
        assert.ok(Frame.isFrame(answer));
        assert.equal(Frame.decode(answer).type, AUTH);
        assert.equal(JSON.parse(Frame.text(Frame.decode(answer).payload)).pv, constants.PROTOCOL_VERSION);
    });

    const refused = {
        "a partial text AUTH": () => [text(PARTIAL, AUTH, authBody())],
        "a partial AUTH followed by the rest": () => {
            const body = authBody();
            return [text(PARTIAL, AUTH, body.slice(0, 10)), text(FULL, AUTH, body.slice(10))];
        },
        "a text LINK before any AUTH": () => [text(FULL, LINK, "{}")],
        "a text SWITCH before any AUTH": () => [text(FULL, SWITCH, JSON.stringify({ type: 2, key: "k", nonce: "n" }))],
        "a text HEARTBEAT before any AUTH": () => [text(FULL, HEARTBEAT, "1")],
        "a text FORWARD before any AUTH": () => [String(FORWARD) + "x".repeat(32) + text(FULL, LINK, "{}")],
        "a text AUTH that is not JSON": () => [text(FULL, AUTH, "{ not json")],
        "a text AUTH whose body is not an object": () => [text(FULL, AUTH, "[1,2,3]")],
        "a text AUTH with no version": () => [text(FULL, AUTH, JSON.stringify({ id: crypto.randomBytes(16).toString("hex") }))],
        // Under the tcp transport's own pre-auth limit, so it is the decoder that refuses it.
        "a text AUTH over maxHandshakeMessageSize": () => [text(FULL, AUTH, authBody({ pad: "x".repeat(65 * 1024) }))],
        "a second AUTH, in text, after a frame AUTH": () => [
            Frame.encode({ flags: Frame.FLAGS.FIRST | Frame.FLAGS.FINAL, type: AUTH, seq: 1, payload: Frame.bytes(authBody()) }),
            text(FULL, AUTH, authBody())
        ],
        "a second AUTH, in text, after a text AUTH": () => [text(FULL, AUTH, authBody()), text(FULL, AUTH, authBody())],
        "a text LINK after a text AUTH": () => [text(FULL, AUTH, authBody()), text(FULL, LINK, JSON.stringify({ hi: 1 }))]
    };

    for (const [what, messages] of Object.entries(refused)) {
        test(name(what + " drops the connection"), async (t) => {
            const v = await victim(t, scheme);
            const attacker = await raw(t, scheme, v.port);

            for (const message of messages()) attacker.send(message);

            assert.equal(await attacker.outcome(), "closed");
            if (!/after a/.test(what)) assert.equal(v.arrived(), 0, "the handshake must not complete");
            await v.stillServes();
        });
    }

    test(name("without acceptLegacyHandshake, a 1.0.x AUTH is refused with the reason"), async (t) => {
        const v = await victim(t, scheme, {});
        const attacker = await raw(t, scheme, v.port);
        attacker.send(text(FULL, AUTH, authBody()));

        assert.equal(await attacker.outcome(), "closed");
        assert.equal(v.arrived(), 0);
        assert.ok(v.reasons.some((r) => /needs acceptLegacyHandshake/.test(r)), "dropped for: " + v.reasons);
        await v.stillServes();
    });

    test(name("a text AUTH with no version is refused with the reason"), async (t) => {
        const v = await victim(t, scheme);
        const attacker = await raw(t, scheme, v.port);
        attacker.send(text(FULL, AUTH, JSON.stringify({ id: crypto.randomBytes(16).toString("hex"), pv: 0 })));

        assert.equal(await attacker.outcome(), "closed");
        assert.ok(v.reasons.some((r) => /Protocol version 1 required/.test(r)), "dropped for: " + v.reasons);
    });
}

// Text once the handshake is done, on a connection that went live normally.
for (const [what, message] of [
    ["an AUTH", text(FULL, AUTH, authBody())],
    ["a LINK", text(FULL, LINK, JSON.stringify({ hi: 1 }))],
    ["a partial packet", text(PARTIAL, LINK, "{")]
]) {
    test("text after the handshake drops the connection: " + what, async (t) => {
        const link = await pair(t);
        const gone = new Promise((resolve) => link.server.on("disconnected", (_peer, reason) => resolve(reason)));
        let delivered = false;
        link.server.on("message", () => { delivered = true; });

        rawSocket(link.clientPeer).send(message);

        assert.match(String(await gone), /Not an anysocket frame/);
        assert.equal(delivered, false);
    });
}

test("text on an encrypted connection drops it", async (t) => {
    const link = await pair(t, { listen: { requireE2E: true }, connect: { requireE2E: true } });
    const gone = new Promise((resolve) => link.server.on("disconnected", (_peer, reason) => resolve(reason)));

    rawSocket(link.clientPeer).send(text(FULL, LINK, JSON.stringify({ in: "clear" })));

    assert.match(String(await gone), /Not an anysocket frame/);
});
