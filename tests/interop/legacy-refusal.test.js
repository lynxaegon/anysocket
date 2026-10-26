const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");
const AnySocket = require("../../src/index.js");
const LegacyAnySocket = require("anysocket-legacy");
const constants = require("../../src/libs/_constants");
const { listen, stop, wait, freePort, disconnectReasons } = require("../helpers/loopback");

/**
 * 0.4.x is no longer spoken: a 0.4.32 peer is turned away, in either direction
 * of the dial, without taking anything down on our side.
 *
 * 0.4.32 is the real published package. It only has ws.
 */

const REFUSED = /Protocol version 1 required \(0\.4\.x peers are not supported since anysocket 1\.1\)/;

/** Collect what would otherwise crash the process, for the length of the test. */
function crashes(t) {
    const seen = [];
    const onError = (e) => seen.push(e);
    process.on("unhandledRejection", onError);
    process.on("uncaughtException", onError);
    t.after(() => {
        process.off("unhandledRejection", onError);
        process.off("uncaughtException", onError);
    });
    return seen;
}

test("the 0.4.32 package loads", () => {
    assert.equal(require("anysocket-legacy/package.json").version, "0.4.32");
});

for (const [name, options] of [
    ["", undefined],
    [", even with the built-in auth optional", { auth: { secret: "s", optional: true } }]
]) {
    test("a 0.4.32 dialler is refused with the reason" + name, async (t) => {
        const reasons = disconnectReasons(t);
        const seen = crashes(t);
        const server = new AnySocket(options);
        const legacy = new LegacyAnySocket();
        t.after(() => stop(legacy, server));

        let asked = false;
        let arrived = false;
        server.onAuth = () => { asked = true; return true; };
        server.on("connected", () => { arrived = true; });

        const port = await listen(server);
        await assert.rejects(legacy.connect("ws", "127.0.0.1", port));
        await wait(50);

        assert.equal(arrived, false, "a 0.4.32 peer must never be handed over");
        assert.equal(asked, false, "onAuth is not asked about a peer refused anyway");
        assert.equal(legacy.hasPeer(server.id), false);
        assert.ok(reasons.some((r) => REFUSED.test(r)), "dropped for: " + reasons);
        assert.deepEqual(seen, []);

        // and the listener still serves a peer that speaks version 1
        const client = new AnySocket(options);
        t.after(() => stop(client));
        const peer = await client.connect("ws", "127.0.0.1", port);
        assert.equal(peer.protocolVersion(), constants.PROTOCOL_VERSION);
    });
}

// 0.4.32 cannot read a frame: handed our binary AUTH it throws an uncaught TypeError
// (buf.substr is not a function) and its process dies. So it runs in a process of its
// own here, and what is checked is our side: the dial fails, and nothing of ours does.
test("a 1.1 dialler fails cleanly against a 0.4.32 listener", async (t) => {
    const seen = crashes(t);
    const port = await freePort();
    const script = `
        const Legacy = require(${JSON.stringify(path.dirname(require.resolve("anysocket-legacy/package.json")))});
        const legacy = new Legacy();
        legacy.on("connected", () => console.log("connected"));
        legacy.listen("ws", { port: ${port} }).then(() => console.log("listening"));
        setTimeout(() => process.exit(0), 15000);
    `;
    const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    t.after(() => child.kill());
    let stdout = "";
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d; });
    const exited = new Promise((resolve) => child.on("exit", resolve));
    await new Promise((resolve, reject) => {
        child.stdout.on("data", (d) => { stdout += d; if (/listening/.test(stdout)) resolve(); });
        child.on("exit", () => reject(new Error("0.4.32 never listened: " + stderr)));
    });

    const client = new AnySocket();
    t.after(() => stop(client));
    const failure = await client.connect("ws", "127.0.0.1", port).then(() => null, (e) => e);

    assert.ok(failure, "the dial must not succeed");
    assert.equal(failure.code, AnySocket.ERRORS.CONNECTION_FAILED);
    await Promise.race([exited, wait(2000)]);
    assert.doesNotMatch(stdout, /connected/, "0.4.32 must not have taken the connection");
    assert.deepEqual(seen, []);
});

// What 0.4.32 would answer with if it could read our AUTH: its own, with no version.
// A dialler refuses that, and says why.
test("a 1.1 dialler refuses a 0.4.x AUTH reply with the reason", async (t) => {
    const seen = crashes(t);
    const server = new WebSocket.Server({ port: 0 });
    t.after(() => server.close());
    await new Promise((resolve) => server.on("listening", resolve));
    server.on("connection", (socket) => {
        socket.on("error", () => {});
        socket.once("message", () => {
            const seq = String.fromCharCode(0, 0, 0, 1);
            socket.send("11" + seq + JSON.stringify({ id: "0123456789abcdef0123456789abcdef" }));
        });
    });

    const client = new AnySocket();
    t.after(() => stop(client));
    let asked = false;
    client.onAuth = () => { asked = true; return true; };

    const failure = await client.connect("ws", "127.0.0.1", server.address().port).then(() => null, (e) => e);
    assert.ok(failure, "the dial must not succeed");
    assert.equal(failure.code, AnySocket.ERRORS.CONNECTION_FAILED);
    assert.match(failure.reason, REFUSED);
    assert.equal(asked, false);
    assert.deepEqual(seen, []);
});
