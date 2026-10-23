const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const { spawnSync } = require("child_process");
const path = require("path");
const { stop, wait, AnySocket } = require("../helpers/loopback");

/** A port something else is already holding. */
async function occupied(t) {
    const holder = http.createServer();
    await new Promise((resolve) => holder.listen(0, "0.0.0.0", resolve));
    t.after(() => new Promise((resolve) => holder.close(resolve)));
    return holder.address().port;
}

// Port 0 used to be impossible: `port || 80` turned it into 80.
test("listen(port 0) binds a free port and reports it", async (t) => {
    const server = new AnySocket();
    t.after(() => stop(server));

    const port = await server.listen("ws", { port: 0 });
    assert.equal(typeof port, "number");
    assert.ok(port > 0, "expected the port the OS assigned, got " + port);

    const client = new AnySocket();
    t.after(() => stop(client));
    const peer = await client.connect("ws", "127.0.0.1", port);
    assert.equal(peer.id, server.id);
});

test("listen() resolves with the port it bound", async (t) => {
    const server = new AnySocket();
    t.after(() => stop(server));

    const free = await new Promise((resolve) => {
        const probe = http.createServer().listen(0, () => {
            const p = probe.address().port;
            probe.close(() => resolve(p));
        });
    });

    assert.equal(await server.listen("ws", { port: free }), free);
});

test("a busy port rejects listen() instead of hanging", async (t) => {
    const port = await occupied(t);
    const server = new AnySocket();
    t.after(() => stop(server));

    await assert.rejects(server.listen("ws", { port }), (e) => {
        assert.equal(e.code, "EADDRINUSE");
        return true;
    });
});

// The worst of the four. The inner http listen was not awaited, so a failure to
// bind raised a second rejection that nothing could catch — and under node's
// default that kills the process, even when the caller handles listen()'s own.
// Run in a child process, because the failure mode is the process dying.
test("a failed listen() does not crash the process", async (t) => {
    const port = await occupied(t);
    const script = `
        const AnySocket = require(${JSON.stringify(path.resolve(__dirname, "../../src/index.js"))});
        (async () => {
            const s = new AnySocket();
            try { await s.listen("ws", { port: ${port} }); } catch (e) { console.log("caught " + e.code); }
            await new Promise((r) => setTimeout(r, 400));
            console.log("alive");
            process.exit(0);
        })();
    `;

    const run = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 15000 });

    assert.match(run.stdout, /caught EADDRINUSE/, "the caller should see the error");
    assert.match(run.stdout, /alive/, "the process must survive a failed listen; stderr:\n" + run.stderr);
    assert.equal(run.status, 0);
});

// There was a single http-server slot, so a second listen on the same instance
// reused the first server and never bound anything.
test("listen() can be retried on the same instance after a failure", async (t) => {
    const busy = await occupied(t);
    const server = new AnySocket();
    t.after(() => stop(server));

    await assert.rejects(server.listen("ws", { port: busy }));

    const port = await Promise.race([
        server.listen("ws", { port: 0 }),
        wait(3000).then(() => { throw new Error("the retry hung"); })
    ]);

    const client = new AnySocket();
    t.after(() => stop(client));
    const peer = await client.connect("ws", "127.0.0.1", port);
    assert.equal(peer.id, server.id, "something must actually be answering on the retried port");
});

test("one instance can listen on two ports at once", async (t) => {
    const server = new AnySocket();
    t.after(() => stop(server));

    const first = await server.listen("ws", { port: 0 });
    const second = await server.listen("ws", { port: 0 });
    assert.notEqual(first, second);

    for (const port of [first, second]) {
        const client = new AnySocket();
        t.after(() => stop(client));
        const peer = await client.connect("ws", "127.0.0.1", port);
        assert.equal(peer.id, server.id, "port " + port + " is not being served");
    }
});

// http and ws asked for on the same port share one server — that is how the
// http router and websocket upgrades live together. It must still work, in
// either order, including when the http side is already up.
test("http and ws on the same port still share it", async (t) => {
    const server = new AnySocket();
    t.after(() => stop(server));

    server.http.get("/ping", (peer) => peer.status(200).body("pong").end());

    const port = await server.listen("http", { port: 0 });
    const wsPort = await Promise.race([
        server.listen("ws", { port: port }),
        wait(3000).then(() => { throw new Error("ws on an http server that is already up hung"); })
    ]);
    assert.equal(wsPort, port);

    const body = await new Promise((resolve, reject) => {
        http.get("http://127.0.0.1:" + port + "/ping", (res) => {
            let data = "";
            res.on("data", (c) => (data += c));
            res.on("end", () => resolve(data));
        }).on("error", reject);
    });
    assert.equal(body, "pong");

    const client = new AnySocket();
    t.after(() => stop(client));
    const peer = await client.connect("ws", "127.0.0.1", port);
    assert.equal(peer.id, server.id);
});
