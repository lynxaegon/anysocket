const test = require("node:test");
const assert = require("node:assert");
const net = require("net");
const { e2e, pair, stop, wait, listen, protocolOf, AnySocket } = require("../helpers/loopback");
const PreviousAnySocket = require("anysocket-1-0");

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

// A 1.0.x peer answers probes even with its own heartbeat off, so a peer that
// probes it does not drop it — in either direction of the dial.
for (const previousListens of [true, false]) {
    test(`a peer probing an idle 1.0.1 ${previousListens ? "server" : "client"} with its heartbeat off keeps the link`, async (t) => {
        const modern = new AnySocket();
        const previous = new PreviousAnySocket();
        t.after(() => stop(modern, previous));
        let dropped = false;
        modern.on("disconnected", () => { dropped = true; });
        previous.on("disconnected", () => { dropped = true; });
        if (previousListens) {
            const port = await previous.listen("ws", { port: 0, heartbeatEnabled: false });
            await modern.connect("ws", "127.0.0.1", port, HB);
        } else {
            const port = await listen(modern, HB);
            await previous.connect("ws", "127.0.0.1", port, { heartbeatEnabled: false });
        }
        await wait(BUDGET * 3);
        assert.equal(dropped, false);
    });
}

// A frozen process: writes nothing, and never times anything out itself.
function freeze(peer) {
    const p = protocolOf(peer);
    p.peer.send = () => Promise.resolve();
    p.options.heartbeatEnabled = false;
    p._heartbeat();
}

async function droppedWithin(instance, ms) {
    let reason = null;
    instance.on("disconnected", (_p, r) => { reason = reason || r; });
    await wait(ms);
    return reason;
}

// The timer was armed only by receiving something, and cleared by the e2e switch: a link
// that went quiet right after the handshake or the switch never probed at all.
test("a requireE2E link probes while idle", async (t) => {
    const opts = { ...HB, requireE2E: true };
    const link = await pair(t, { listen: opts, connect: opts });
    let frames = 0;
    for (const peer of [link.serverPeer, link.clientPeer]) {
        const p = protocolOf(peer).peer;
        const send = p.send.bind(p);
        p.send = (m) => { frames++; return send(m); };
    }
    await wait(BUDGET * 2);
    assert.ok(frames > 0, "no heartbeat at all on an idle requireE2E link");
});

test("a requireE2E link drops a peer that freezes", async (t) => {
    const opts = { ...HB, requireE2E: true };
    const link = await pair(t, { listen: opts, connect: opts });
    freeze(link.serverPeer);
    assert.ok(await droppedWithin(link.client, BUDGET + HB.heartbeatInterval * 4));
});

test("a dialler times out a listener that never speaks", async (t) => {
    const link = await pair(t, { listen: { heartbeatEnabled: false }, connect: HB });
    freeze(link.serverPeer);
    assert.ok(await droppedWithin(link.client, BUDGET + HB.heartbeatInterval * 4));
});

test("a peer that freezes right after e2e() is dropped", async (t) => {
    const link = await pair(t, { listen: HB, connect: HB });
    await wait(HB.heartbeatInterval * 2);
    const serverUp = new Promise((r) => link.serverPeer.on("e2e", r));
    link.clientPeer.e2e();
    await serverUp;
    freeze(link.serverPeer);
    assert.ok(await droppedWithin(link.client, BUDGET + HB.heartbeatInterval * 4));
});

test("a heartbeat crossing an e2e offer does not kill the link", async (t) => {
    const opts = { heartbeatInterval: 100, heartbeatsMaxMissed: 5 };
    const link = await pair(t, { listen: opts, connect: opts });
    await wait(250);
    // A slow answer to the offer (latency, a slow key generation): probes fire meanwhile.
    const sp = protocolOf(link.serverPeer);
    const offer = sp._offerE2E.bind(sp);
    sp._offerE2E = async () => { await wait(250); return offer(); };
    let reason = null;
    link.client.on("disconnected", (_p, r) => { reason = reason || "client: " + r; });
    link.server.on("disconnected", (_p, r) => { reason = reason || "server: " + r; });
    await e2e(link);
    await wait(300);
    assert.equal(reason, null);
});

// Receiving only notes the time; the timer waits out the rest of the interval. A link that
// keeps receiving stays up and is never probed.
test("a link that keeps receiving is not probed and stays up", async (t) => {
    const link = await pair(t, { listen: HB, connect: HB });
    const Packet = require("../../src/libs/Packet");
    let probes = 0;
    const p = protocolOf(link.clientPeer);
    const send = p.send.bind(p);
    // Probes only, not its replies to the server's.
    p.send = (packet) => { if (packet.type == Packet.TYPE.HEARTBEAT && packet.data == 1) probes++; return send(packet); };
    const timer = setInterval(() => link.serverPeer.send({ tick: 1 }).catch(() => {}), HB.heartbeatInterval / 3);
    t.after(() => clearInterval(timer));
    await wait(BUDGET * 2);
    clearInterval(timer);
    assert.equal(probes, 0);
    assert.equal(link.client.hasPeer(link.server.id), true);
});
