const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { spawnSync } = require("child_process");
const LegacyAnySocket = require("anysocket-legacy");
const { e2e, pair, listen, stop, rawSocket, wait, freePort, AnySocket } = require("../helpers/loopback");

/** Total bytes a peer puts on the wire while `fn` runs. */
async function bytesSent(peer, fn) {
    const socket = rawSocket(peer);
    const original = socket.send.bind(socket);
    let total = 0;
    socket.send = (data, cb) => {
        total += typeof data == "string" ? Buffer.byteLength(data) : data.length;
        return original(data, cb);
    };
    try {
        await fn();
    } finally {
        socket.send = original;
    }
    return total;
}

// RPC used to base64 every binary argument and result even after the frame
// itself became binary, so bytes through RPC still cost a third extra and a
// pass through a string.
test("a binary RPC argument costs its own size, not base64's", async (t) => {
    const link = await pair(t, { configure: (server) => server.setRPC({ size: (b) => b.length }) });
    const payload = Buffer.alloc(64 * 1024, 7);

    const sent = await bytesSent(link.clientPeer, () => link.clientPeer.rpc.size(payload));

    assert.ok(sent < payload.length * 1.05,
        payload.length + " bytes of argument became " + sent + " on the wire (base64 would be ~" +
        Math.round(payload.length * 4 / 3) + ")");
});

test("a binary RPC result costs its own size, not base64's", async (t) => {
    const big = Buffer.alloc(64 * 1024, 3);
    const link = await pair(t, { configure: (server) => server.setRPC({ give: () => big }) });

    const sent = await bytesSent(link.serverPeer, () => link.clientPeer.rpc.give());

    assert.ok(sent < big.length * 1.05, big.length + " bytes of result became " + sent + " on the wire");
});

test("binary arguments and results keep their bytes and arrive as Buffers", async (t) => {
    const link = await pair(t, {
        configure: (server) => server.setRPC({
            echo: (a, b) => {
                assert.ok(Buffer.isBuffer(a), "an argument should arrive as a Buffer on node");
                return Buffer.concat([a, Buffer.from([0xff]), b]);
            }
        })
    });

    const result = await link.clientPeer.rpc.echo(Buffer.from([1, 2, 3]), new Uint8Array([9, 8]));

    assert.ok(Buffer.isBuffer(result), "the result should be a Buffer on node, so .toString() etc. still work");
    assert.deepEqual(Array.from(result), [1, 2, 3, 0xff, 9, 8]);
});

test("binary and plain arguments mix in one call", async (t) => {
    const link = await pair(t, {
        configure: (server) => server.setRPC({
            describe: (name, data, count) => name + ":" + data.length + ":" + count
        })
    });

    assert.equal(await link.clientPeer.rpc.describe("file", Buffer.alloc(1000), 3), "file:1000:3");
});

test("a large binary RPC payload survives chunking", async (t) => {
    const link = await pair(t, { configure: (server) => server.setRPC({ sum: (b) => {
        let s = 0;
        for (let i = 0; i < b.length; i++) s = (s + b[i]) % 65536;
        return s;
    } }) });

    const payload = Buffer.alloc(9 * 1024 * 1024);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
    let expected = 0;
    for (let i = 0; i < payload.length; i++) expected = (expected + payload[i]) % 65536;

    assert.equal(await link.clientPeer.rpc.sum(payload), expected);
});

test("binary RPC still works over an encrypted link", async (t) => {
    const link = await pair(t, { configure: (server) => server.setRPC({ rev: (b) => Buffer.from(b).reverse() }) });
    await e2e(link);

    const result = await link.clientPeer.rpc.rev(Buffer.from([1, 2, 3, 4]));
    assert.deepEqual(Array.from(result), [4, 3, 2, 1]);
});

// A 0.4.x peer can only read base64, so that is what it must still get.
test("binary RPC to and from a 0.4.x peer still uses base64", async (t) => {
    const server = new AnySocket();
    const legacy = new LegacyAnySocket();
    t.after(() => stop(server, legacy));

    server.setRPC({ echo: (b) => Buffer.concat([b, Buffer.from([7])]) });
    legacy.setRPC({ twice: (b) => Buffer.concat([b, b]) });

    let serverPeer = null;
    server.on("connected", (p) => { serverPeer = p; });

    const port = await listen(server);
    const peer = await legacy.connect("ws", "127.0.0.1", port);
    await wait(150);

    // old -> new
    assert.deepEqual(Array.from(await peer.rpc.echo(Buffer.from([1, 2]))), [1, 2, 7]);
    // new -> old
    assert.deepEqual(Array.from(await serverPeer.rpc.twice(Buffer.from([5]))), [5, 5]);
});

// Lock in that a failed dial cannot take the process down the way a failed
// listen() could — an application need not swap out its rejection handlers to
// dial something that may not be there.
test("a failed connect() does not crash the process", async (t) => {
    const port = await freePort(); // nothing is listening on it
    const script = `
        const AnySocket = require(${JSON.stringify(path.resolve(__dirname, "../../src/index.js"))});
        (async () => {
            const c = new AnySocket();
            try { await c.connect("ws", "127.0.0.1", ${port}); } catch (e) { console.log("caught " + (e.code || e)); }
            await new Promise((r) => setTimeout(r, 500));
            console.log("alive");
            process.exit(0);
        })();
    `;

    const run = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 20000 });
    assert.match(run.stdout, /caught/, "the caller should see the failure");
    assert.match(run.stdout, /alive/, "the process must survive a failed dial; stderr:\n" + run.stderr);
    assert.equal(run.status, 0);
});
