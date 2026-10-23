const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const net = require("net");
const { stop, wait, AnySocket } = require("../helpers/loopback");

/** A tcp or ipc link: server listening, client dialled in, both ready. */
async function link(t, scheme, options = {}) {
    const server = new AnySocket();
    const client = new AnySocket();
    t.after(() => stop(server, client));
    if (options.configure) options.configure(server, client);

    const serverSide = new Promise((resolve) => server.on("connected", (p) => {
        if (p.id === client.id) resolve(p);
    }));

    let clientPeer;
    if (scheme == "ipc") {
        const where = process.platform == "win32"
            ? "\\\\.\\pipe\\anysocket-test-" + process.pid + "-" + Math.random().toString(16).slice(2)
            : path.join(os.tmpdir(), "anysocket-" + process.pid + "-" + Math.random().toString(16).slice(2) + ".sock");
        await server.listen("ipc", Object.assign({ path: where }, options.listen));
        clientPeer = await client.connect("ipc", where, null, options.connect);
    } else {
        const port = await server.listen("tcp", Object.assign({ port: 0 }, options.listen));
        clientPeer = await client.connect("tcp", "127.0.0.1", port, options.connect);
    }

    return { server, client, clientPeer, serverPeer: await serverSide };
}

for (const scheme of ["tcp", "ipc"]) {
    test(scheme + ": a message arrives, both directions", async (t) => {
        const l = await link(t, scheme);

        const atServer = new Promise((resolve) => l.server.once("message", (p) => resolve(p.msg)));
        await l.clientPeer.send({ hello: "server" });
        assert.deepEqual(await atServer, { hello: "server" });

        const atClient = new Promise((resolve) => l.client.once("message", (p) => resolve(p.msg)));
        await l.serverPeer.send({ hello: "client" });
        assert.deepEqual(await atClient, { hello: "client" });
    });

    test(scheme + ": speaks the 1.0 protocol", async (t) => {
        const l = await link(t, scheme);
        assert.equal(l.clientPeer.protocolVersion(), 1);
    });

    test(scheme + ": RPC, including binary arguments", async (t) => {
        const l = await link(t, scheme, {
            configure: (server) => server.setRPC({ join: (a, b) => Buffer.concat([a, b]) })
        });

        const out = await l.clientPeer.rpc.join(Buffer.from([1, 2]), Buffer.from([3]));
        assert.deepEqual(Array.from(out), [1, 2, 3]);
    });

    test(scheme + ": e2e", async (t) => {
        const l = await link(t, scheme);
        await l.clientPeer.e2e();

        assert.equal(l.clientPeer.e2eInfo().protocolVersion, 1);
        const atServer = new Promise((resolve) => l.server.once("message", (p) => resolve(p.msg)));
        await l.clientPeer.send({ secret: scheme });
        assert.deepEqual(await atServer, { secret: scheme });
    });

    test(scheme + ": the built-in auth", async (t) => {
        const l = await link(t, scheme, {
            configure: (server, client) => {
                server.options.auth = { secret: "s" };
                client.options.auth = { secret: "s" };
            }
        });
        await l.clientPeer.e2e();
        assert.equal(l.clientPeer.e2eInfo().authenticated, true);
    });
}

// A stream delivers whatever it has, not whole messages. One large message
// arrives in many reads; many small ones can arrive in one.
test("tcp: a message split across many reads is put back together", async (t) => {
    const l = await link(t, "tcp");
    const payload = Buffer.alloc(12 * 1024 * 1024);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 7) % 256;

    const atServer = new Promise((resolve) => l.server.once("message", (p) => resolve(p.msg)));
    await l.clientPeer.send(payload);

    const got = await atServer;
    assert.equal(got.length, payload.length);
    assert.equal(Buffer.compare(Buffer.from(got), payload), 0);
});

test("tcp: many messages in one read are told apart", async (t) => {
    const l = await link(t, "tcp");
    const seen = [];
    l.server.on("message", (p) => seen.push(p.msg.n));

    // Fired without waiting, so the socket coalesces them.
    for (let n = 0; n < 500; n++) l.clientPeer.send({ n });
    await wait(500);

    assert.deepEqual(seen, Array.from({ length: 500 }, (_, i) => i));
});

test("tcp: a length prefix above the limit drops the connection before allocating", async (t) => {
    const server = new AnySocket();
    t.after(() => stop(server));
    const port = await server.listen("tcp", { port: 0, maxPayload: 1024 });

    const raw = net.connect(port, "127.0.0.1");
    await new Promise((resolve) => raw.once("connect", resolve));
    const closed = new Promise((resolve) => raw.once("close", resolve));

    // Announce a 2GB message.
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(2 * 1024 * 1024 * 1024 - 1, 0);
    raw.write(prefix);

    await closed;
    assert.ok(true, "the server hung up rather than allocate");
});

test("tcp: a busy port rejects listen()", async (t) => {
    const holder = net.createServer();
    await new Promise((resolve) => holder.listen(0, "0.0.0.0", resolve));
    t.after(() => new Promise((resolve) => holder.close(resolve)));

    const server = new AnySocket();
    t.after(() => stop(server));
    await assert.rejects(server.listen("tcp", { port: holder.address().port }), (e) => e.code === "EADDRINUSE");
});

test("tcp: a refused dial rejects connect()", async (t) => {
    const client = new AnySocket();
    t.after(() => stop(client));
    await assert.rejects(client.connect("tcp", "127.0.0.1", 1));
});

test("tcp: connectTimeout bounds a dial that never answers", async (t) => {
    const client = new AnySocket();
    t.after(() => stop(client));

    // A non-routable address: the dial neither succeeds nor is refused.
    const started = Date.now();
    await assert.rejects(client.connect("tcp", "10.255.255.1", 9, { connectTimeout: 300 }));
    assert.ok(Date.now() - started < 5000, "the dial should have been abandoned near the timeout");
});

test("ipc needs a path", (t) => {
    const server = new AnySocket();
    assert.throws(() => server.listen("ipc", {}), /path/);
});

test("ws: connectTimeout bounds a dial that never answers, as on tcp", async (t) => {
    const client = new AnySocket();
    t.after(() => stop(client));

    const started = Date.now();
    await assert.rejects(client.connect("ws", "10.255.255.1", 9, { connectTimeout: 300 }));
    assert.ok(Date.now() - started < 5000, "the dial should have been abandoned near the timeout");
});
