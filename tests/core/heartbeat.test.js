const test = require("node:test");
const assert = require("node:assert");
const net = require("net");
const { stop, wait, freePort, listen, AnySocket } = require("../helpers/loopback");
const LegacyAnySocket = require("anysocket-legacy");

/**
 * The heartbeat ends a link that has gone silent: a quiet link is probed every
 * heartbeatInterval, and with nothing received for heartbeatInterval ×
 * (heartbeatsMaxMissed + 1) it is disconnected. That is the case TCP itself never
 * notices — a peer whose process is frozen, or a path that silently stops
 * delivering, while the connection stays open.
 *
 * The timer used to re-arm only when a reply arrived, so once a probe went
 * unanswered nothing was ever counted as missed and the silent link lived on.
 */
const HB = { heartbeatInterval: 200, heartbeatsMaxMissed: 3 };
const BUDGET = HB.heartbeatInterval * (HB.heartbeatsMaxMissed + 1);

// A tcp proxy that can stop moving bytes in both directions while keeping both
// connections open: a stalled path, or a frozen peer when it never resumes.
async function stallProxy(t, targetPort) {
    let held = false;
    const pending = [];
    const sockets = new Set();
    const pipe = (from, to) => from.on("data", (chunk) => {
        if (held) pending.push(() => to.write(chunk)); else to.write(chunk);
    });
    const server = net.createServer((client) => {
        const upstream = net.connect(targetPort, "127.0.0.1");
        for (const s of [client, upstream]) { sockets.add(s); s.on("error", () => {}); }
        pipe(client, upstream); pipe(upstream, client);
        client.on("close", () => upstream.destroy());
        upstream.on("close", () => client.destroy());
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => { for (const s of sockets) s.destroy(); server.close(); });
    return {
        port: server.address().port,
        hold: () => { held = true; },
        release: () => { held = false; pending.splice(0).forEach((f) => f()); },
    };
}

async function proxiedLink(t, options = HB) {
    const server = new AnySocket();
    const client = new AnySocket();
    t.after(() => stop(server, client));
    server.setRPC({ ping: () => "pong" });
    const port = await server.listen("tcp", { port: 0, ...options });
    const proxy = await stallProxy(t, port);
    const serverSide = new Promise((resolve) => server.once("connected", resolve));
    const peer = await client.connect("tcp", "127.0.0.1", proxy.port, { ...options });
    await serverSide;
    const ended = { client: null, server: null };
    client.on("disconnected", () => { ended.client ??= Date.now(); });
    server.on("disconnected", () => { ended.server ??= Date.now(); });
    return { peer, proxy, ended };
}

test("a link that goes silent is dropped by both ends within the heartbeat budget", async (t) => {
    const { proxy, ended } = await proxiedLink(t);
    const silentAt = Date.now();
    proxy.hold();
    await wait(BUDGET + HB.heartbeatInterval * 3);
    assert.ok(ended.client, "the client never dropped the silent link");
    assert.ok(ended.server, "the server never dropped the silent link");
    for (const at of [ended.client, ended.server]) {
        assert.ok(at - silentAt >= BUDGET - HB.heartbeatInterval, `dropped too early: ${at - silentAt}ms`);
        assert.ok(at - silentAt <= BUDGET + HB.heartbeatInterval * 2, `dropped too late: ${at - silentAt}ms`);
    }
});

test("a stall shorter than the budget is ridden out", async (t) => {
    const { peer, proxy, ended } = await proxiedLink(t);
    proxy.hold();
    await wait(BUDGET - HB.heartbeatInterval * 1.5);
    proxy.release();
    await wait(HB.heartbeatInterval * 3);
    assert.deepEqual(ended, { client: null, server: null });
    assert.equal(await peer.rpc.ping(), "pong");
});

test("an idle link that answers its probes stays up", async (t) => {
    const { peer, ended } = await proxiedLink(t);
    await wait(BUDGET * 3);
    assert.deepEqual(ended, { client: null, server: null });
    assert.equal(await peer.rpc.ping(), "pong");
});

test("with the heartbeat off, a silent link is left to the transport", async (t) => {
    const { proxy, ended } = await proxiedLink(t, { ...HB, heartbeatEnabled: false });
    proxy.hold();
    await wait(BUDGET * 2);
    assert.deepEqual(ended, { client: null, server: null });
});

// A 0.4.x peer answers probes even with its own heartbeat off, so a 1.0 peer that
// probes it does not drop it — in either direction of the dial.
for (const legacyListens of [true, false]) {
    test(`a 1.0 peer probing an idle 0.4.32 ${legacyListens ? "server" : "client"} with its heartbeat off keeps the link`, async (t) => {
        const modern = new AnySocket();
        const legacy = new LegacyAnySocket();
        t.after(() => stop(modern, legacy));
        let dropped = false;
        modern.on("disconnected", () => { dropped = true; });
        legacy.on("disconnected", () => { dropped = true; });
        if (legacyListens) {
            const port = await freePort();   // 0.4.32 cannot listen on port 0
            await legacy.listen("ws", { port, heartbeatEnabled: false });
            await modern.connect("ws", "127.0.0.1", port, HB);
        } else {
            const port = await listen(modern, HB);
            await legacy.connect("ws", "127.0.0.1", port, { heartbeatEnabled: false });
        }
        await wait(BUDGET * 3);
        assert.equal(dropped, false);
    });
}
