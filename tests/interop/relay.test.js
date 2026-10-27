const test = require("node:test");
const assert = require("node:assert");
const AnySocket = require("../../src/index.js");
const PreviousAnySocket = require("anysocket-1-0");
const { stop, wait } = require("../helpers/loopback");

/**
 * Relayed links where one hop is the published 1.0.1. A relay re-wraps each frame
 * for the next hop, so a relayed frame written by one version has to be one the
 * other reads, whichever end is which.
 */
const layouts = [
    { name: "a 1.1 relay between a 1.1 dialler and a 1.0.1 target", Relay: AnySocket, A: AnySocket, B: PreviousAnySocket },
    { name: "a 1.1 relay between a 1.0.1 dialler and a 1.1 target", Relay: AnySocket, A: PreviousAnySocket, B: AnySocket },
    { name: "a 1.0.1 relay between two 1.1 peers", Relay: PreviousAnySocket, A: AnySocket, B: AnySocket }
];

async function trio(t, layout, scheme, options = {}) {
    const relay = new layout.Relay();
    const a = new layout.A();
    const b = new layout.B();
    t.after(() => stop(a, b, relay));
    relay.canProxy = () => true;
    b.canAcceptProxy = () => true;

    const port = await relay.listen(scheme, Object.assign({ port: 0 }, options.relay));
    await a.connect(scheme, "127.0.0.1", port, { allowInsecureWSFallback: true });
    await b.connect(scheme, "127.0.0.1", port, Object.assign({ allowInsecureWSFallback: true }, options.b));
    await wait(50);
    return { relay, a, b };
}

for (const scheme of ["ws", "tcp"]) {
    for (const layout of layouts) {
        test(layout.name + ", over " + scheme + ": messages, binary, RPC and e2e", async (t) => {
            const { relay, a, b } = await trio(t, layout, scheme);
            b.setRPC({ rev: (bytes) => Buffer.from(bytes).reverse() });

            const bSeesA = new Promise((resolve) => b.on("connected", (peer) => { if (peer.id === a.id) resolve(peer); }));
            const toB = await a.proxy(b.id, relay.id);
            const fromA = await bSeesA;
            assert.ok(toB.isProxy() && fromA.isProxy());
            assert.equal(toB.relayID, relay.id);

            const atB = new Promise((resolve) => b.once("message", (packet) => resolve(packet.msg)));
            await toB.send({ through: "the relay" });
            assert.deepEqual(await atB, { through: "the relay" });

            const atA = new Promise((resolve) => a.once("message", (packet) => resolve(packet.msg)));
            await fromA.send(new Uint8Array([9, 8, 7]));
            assert.deepEqual(Array.from(await atA), [9, 8, 7]);

            assert.deepEqual(Array.from(await toB.rpc.rev(Buffer.from([1, 2, 3]))), [3, 2, 1]);

            // End to end through the relay, and still carrying a chunked message.
            const up = new Promise((resolve) => fromA.once("e2e", resolve));
            await toB.e2e();
            await up;
            assert.ok(toB.isE2EEnabled() && fromA.isE2EEnabled());

            const big = new Uint8Array(6 * 1024 * 1024);
            for (let i = 0; i < big.length; i++) big[i] = i % 251;
            const bigAtB = new Promise((resolve) => b.once("message", (packet) => resolve(packet.msg)));
            await toB.send(big);
            const got = await bigAtB;
            assert.equal(got.length, big.length);
            assert.ok(Buffer.from(got).equals(Buffer.from(big)));
        });

        test(layout.name + ", over " + scheme + ": requireE2E on the far hop", async (t) => {
            const { relay, a, b } = await trio(t, layout, scheme, { b: { requireE2E: true } });

            const bSeesA = new Promise((resolve) => b.on("connected", (peer) => { if (peer.id === a.id) resolve(peer); }));
            const toB = await a.proxy(b.id, relay.id);
            assert.ok(toB.isE2EEnabled(), "proxy() resolved before e2e was up");
            assert.ok((await bSeesA).isE2EEnabled(), "\"connected\" fired before e2e was up");
        });
    }
}
