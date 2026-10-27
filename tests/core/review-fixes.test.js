const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { spawnSync } = require("child_process");
const { pair, listen, stop, wait, AnySocket } = require("../helpers/loopback");

const LOW = "00000000000000000000000000000001";
const HIGH = "ffffffffffffffffffffffffffffff01";

// A connection retired by the duplicate rule used to vanish silently: its peer
// id was cleared before it disconnected, so nothing announced it, and whatever
// was waiting on it sat out the full reply timeout.
test("a superseded connection rejects pending calls and announces itself", async (t) => {
    const a = new AnySocket();
    const b = new AnySocket();
    a.id = LOW;
    b.id = HIGH;
    t.after(() => stop(a, b));

    // A call that is never answered, so it is still pending at the swap.
    a.setRPC({ never: () => new Promise(() => {}) });

    const portA = await listen(a);
    const portB = await listen(b);

    // The higher id dials first: that connection is the one the rule retires.
    const first = await b.connect("ws", "127.0.0.1", portA, { allowInsecureWSFallback: true });
    await wait(80);

    const gone = new Promise((resolve) => b.on("disconnected", (peer, reason) => {
        if (peer === first) resolve(reason);
    }));

    const started = Date.now();
    const pending = first.rpc.never().then(() => "resolved", (e) => e);

    // Now the lower id dials — the connection both ends will keep.
    await a.connect("ws", "127.0.0.1", portB, { allowInsecureWSFallback: true });

    const outcome = await Promise.race([pending, wait(5000).then(() => "STILL PENDING")]);
    assert.notEqual(outcome, "STILL PENDING", "the retired connection's call must not wait out the reply timeout");
    assert.ok(Date.now() - started < 5000);

    assert.match(String(await gone), /superseded/i, "the retired peer object should be announced");
    await wait(100);
    assert.ok(b.hasPeer(a.id), "and the agreed connection is in place");
});

// With a secret, the listener signs before replying — real asynchronous work,
// during which another connection's AUTH can be handled. An application pairing
// its onAuth with the authPacket() that follows got another connection's value.
test("authPacket() pairs with its own onAuth even while signing", async (t) => {
    const server = new AnySocket({ auth: { secret: "s" } });
    t.after(() => stop(server));

    let last = null;
    server.onAuth = (packet) => { last = packet.id; return true; };
    server.authPacket = () => { const v = last; last = null; return v; };

    const port = await listen(server);

    const dialers = [];
    for (let i = 0; i < 12; i++) {
        const c = new AnySocket({ auth: { secret: "s" } });
        let echoed = null;
        c.onAuth = (packet) => { echoed = packet.auth; return true; };
        dialers.push({ c, get echoed() { return echoed; } });
    }
    t.after(() => stop(...dialers.map((d) => d.c)));

    // All at once, so their handshakes overlap.
    await Promise.all(dialers.map((d) => d.c.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true })));

    for (const d of dialers) {
        assert.equal(d.echoed, d.c.id, "a dialer was handed another connection's authPacket()");
    }
});

// A failed call used to reject with packet.data — the caller's own outgoing call,
// method and arguments included — instead of what went wrong.
test("a failed RPC reports why, not what it sent", async (t) => {
    const link = await pair(t, {
        configure: (server) => server.setRPC({ never: () => new Promise(() => {}) }),
        connect: { replyTimeout: 200 }
    });

    const rejection = await link.clientPeer.rpc.never("a-secret-argument").then(() => null, (e) => e);

    assert.ok(rejection, "the call should have failed");
    assert.doesNotMatch(JSON.stringify(rejection), /a-secret-argument/,
        "the rejection must not carry the call's own arguments");
    assert.match(String(rejection && (rejection.message || rejection)), /timeout/i);
});

// send() never settled before 1.0, so it is called everywhere without awaiting
// or catching. Now that it can reject, an unhandled failure would crash the
// process. Run in a child, because the failure mode is the process dying.
test("an un-awaited send() that fails does not crash the process", async (t) => {
    const script = `
        const AnySocket = require(${JSON.stringify(path.resolve(__dirname, "../../src/index.js"))});
        (async () => {
            const server = new AnySocket();
            const client = new AnySocket();
            const port = await server.listen("ws", { port: 0 });
            const peer = await client.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true });
            await client.stop();
            // fired and forgotten, on a peer that is gone
            peer.send({ into: "the void" });
            peer.send(new Uint8Array(8));
            client.broadcast({ also: "gone" });
            peer.e2e();
            await new Promise((r) => setTimeout(r, 400));
            console.log("alive");
            process.exit(0);
        })();
    `;

    const run = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 20000 });
    assert.match(run.stdout, /alive/, "the process must survive; stderr:\n" + run.stderr);
    assert.equal(run.status, 0);
});

test("an awaited send() still sees the failure", async (t) => {
    const link = await pair(t);
    await link.client.stop();

    await assert.rejects(link.clientPeer.send({ nope: true }));
});
