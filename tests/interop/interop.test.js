const test = require("node:test");
const assert = require("node:assert");
const AnySocket = require("../../src/index.js");
const PreviousAnySocket = require("anysocket-1-0");
const { stop, wait } = require("../helpers/loopback");

/**
 * Interop with the published 1.0.1, tested against the real package rather than
 * a mock of it.
 *
 * 1.1 sends everything as frames, its first AUTH included; a 1.0.1 dialler still
 * writes that first AUTH in its old text format, which 1.1 reads for that one
 * packet. Every feature is run in both directions of the dial and over both
 * transports that carry it, because the two directions take different paths
 * through the handshake.
 */

const SECRET = "shared-secret";

const directions = [
    { name: "1.1 dials 1.0.1", Dialler: AnySocket, Listener: PreviousAnySocket },
    { name: "1.0.1 dials 1.1", Dialler: PreviousAnySocket, Listener: AnySocket }
];

/**
 * A listener and a dialler of the given kinds, connected. Resolves once both ends
 * hold the other, with the peer each one holds. `listen` and `connect` are the
 * transport options of each end; `listener` and `dialler` their constructor options.
 */
async function link(t, scheme, direction, options = {}) {
    const listener = new direction.Listener(options.listener);
    const dialler = new direction.Dialler(options.dialler);
    t.after(() => stop(dialler, listener));
    if (options.configure) options.configure(listener, dialler);

    const listenerSide = new Promise((resolve) => {
        listener.on("connected", (peer) => { if (peer.id === dialler.id) resolve(peer); });
    });
    const port = await listener.listen(scheme, Object.assign({}, options.listen, { port: 0 }));
    const diallerPeer = await dialler.connect(scheme, "127.0.0.1", port, Object.assign({}, options.connect));
    const listenerPeer = await listenerSide;
    return { listener, dialler, listenerPeer, diallerPeer, port };
}

/** The next message `instance` receives. */
const nextMessage = (instance) => new Promise((resolve) => instance.once("message", resolve));

/** `starter` turns e2e on; resolves once both ends are encrypted. */
async function encrypt(starter, other) {
    const up = other.isE2EEnabled() ? null : new Promise((resolve) => other.once("e2e", resolve));
    await starter.e2e();
    if (up) await up;
}

const pattern = (length) => {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) bytes[i] = (i * 7) % 256;
    return bytes;
};

const sameBytes = (got, want) => {
    assert.equal(got.length, want.length);
    assert.ok(Buffer.from(got.buffer, got.byteOffset, got.byteLength).equals(Buffer.from(want)), "bytes differ");
};

test("the 1.0.1 package loads", () => {
    assert.equal(require("anysocket-1-0/package.json").version, "1.0.1");
});

for (const scheme of ["ws", "tcp"]) {
    for (const direction of directions) {
        const name = (what) => direction.name + " over " + scheme + ": " + what;

        test(name("both ends settle on version 1"), async (t) => {
            const l = await link(t, scheme, direction);
            assert.equal(l.diallerPeer.protocolVersion(), 1);
            assert.equal(l.listenerPeer.protocolVersion(), 1);
            assert.equal(l.diallerPeer.id, l.listener.id);
            assert.equal(l.listenerPeer.id, l.dialler.id);

            // Only a 1.0.1 dialler's AUTH arrives in the text format, and only the
            // 1.1 end can say so.
            const modernEnd = direction.Listener === AnySocket ? l.listenerPeer : l.diallerPeer;
            assert.equal(modernEnd.legacyHandshake(), direction.Dialler === PreviousAnySocket);
        });

        test(name("messages and replies cross both ways"), async (t) => {
            const l = await link(t, scheme, direction);

            const atListener = nextMessage(l.listener);
            await l.diallerPeer.send({ from: "dialler" });
            assert.deepEqual((await atListener).msg, { from: "dialler" });

            const atDialler = nextMessage(l.dialler);
            await l.listenerPeer.send({ from: "listener" });
            assert.deepEqual((await atDialler).msg, { from: "listener" });

            l.listener.on("message", (packet) => packet.reply({ echo: packet.msg.n + 1 }));
            l.dialler.on("message", (packet) => packet.reply({ echo: packet.msg.n * 2 }));
            assert.deepEqual((await l.diallerPeer.send({ n: 41 }, true)).msg, { echo: 42 });
            assert.deepEqual((await l.listenerPeer.send({ n: 21 }, true)).msg, { echo: 42 });
        });

        test(name("binary payloads arrive as bytes both ways"), async (t) => {
            const l = await link(t, scheme, direction);
            const bytes = new Uint8Array([0, 1, 127, 128, 254, 255]);

            const atListener = nextMessage(l.listener);
            await l.diallerPeer.send(bytes);
            const got = (await atListener).msg;
            assert.ok(got instanceof Uint8Array, "arrived as " + Object.prototype.toString.call(got));
            sameBytes(got, bytes);

            const atDialler = nextMessage(l.dialler);
            await l.listenerPeer.send(Buffer.from(bytes));
            sameBytes((await atDialler).msg, bytes);
        });

        test(name("RPC with binary arguments and results, both ways"), async (t) => {
            const l = await link(t, scheme, direction, {
                configure: (listener, dialler) => {
                    const rpc = {
                        join: (a, label, b) => Buffer.concat([Buffer.from(a), Buffer.from(label), Buffer.from(b)]),
                        size: (b) => b.length,
                        plain: (x) => x * 2
                    };
                    listener.setRPC(rpc);
                    dialler.setRPC(rpc);
                }
            });

            for (const [caller, callee] of [[l.diallerPeer, "listener"], [l.listenerPeer, "dialler"]]) {
                const joined = await caller.rpc.join(Buffer.from([1, 2]), "-", new Uint8Array([3]));
                sameBytes(joined, new Uint8Array([1, 2, 45, 3]));
                assert.equal(await caller.rpc.size(pattern(70000)), 70000, "calling the " + callee);
                assert.equal(await caller.rpc.plain(21), 42);
                await assert.rejects(caller.rpc.missing(), /not found/i);
            }
        });

        for (const starter of ["dialler", "listener"]) {
            test(name("e2e started by the " + starter), async (t) => {
                const l = await link(t, scheme, direction);
                const [a, b] = starter === "dialler"
                    ? [l.diallerPeer, l.listenerPeer]
                    : [l.listenerPeer, l.diallerPeer];
                await encrypt(a, b);

                assert.ok(a.isE2EEnabled() && b.isE2EEnabled());
                assert.deepEqual(a.getChannelBinding(), b.getChannelBinding());
                assert.equal(a.e2eInfo().cipher, b.e2eInfo().cipher);

                const atListener = nextMessage(l.listener);
                await l.diallerPeer.send({ secret: "to the listener" });
                assert.deepEqual((await atListener).msg, { secret: "to the listener" });
                const atDialler = nextMessage(l.dialler);
                await l.listenerPeer.send({ secret: "to the dialler" });
                assert.deepEqual((await atDialler).msg, { secret: "to the dialler" });
            });
        }

        test(name("both ends starting e2e at once"), async (t) => {
            const l = await link(t, scheme, direction);
            await Promise.all([l.diallerPeer.e2e(), l.listenerPeer.e2e()]);
            await wait(20);
            assert.ok(l.diallerPeer.isE2EEnabled() && l.listenerPeer.isE2EEnabled());
            const atListener = nextMessage(l.listener);
            await l.diallerPeer.send({ crossed: true });
            assert.deepEqual((await atListener).msg, { crossed: true });
        });

        test(name("built-in auth with a shared secret"), async (t) => {
            const secret = { auth: { secret: SECRET } };
            const l = await link(t, scheme, direction, { listener: secret, dialler: secret });
            assert.equal(l.diallerPeer.isAuthenticated(), true);
            assert.equal(l.listenerPeer.isAuthenticated(), true);

            // The secret goes into the e2e keys on an authenticated link.
            await encrypt(l.diallerPeer, l.listenerPeer);
            assert.equal(l.diallerPeer.e2eInfo().authenticated, true);
            assert.equal(l.listenerPeer.e2eInfo().authenticated, true);
            const atListener = nextMessage(l.listener);
            await l.diallerPeer.send({ keyed: "by the secret" });
            assert.deepEqual((await atListener).msg, { keyed: "by the secret" });
        });

        test(name("a wrong secret is refused"), async (t) => {
            const listener = new direction.Listener({ auth: { secret: SECRET } });
            const dialler = new direction.Dialler({ auth: { secret: "not-it" } });
            t.after(() => stop(dialler, listener));
            let arrived = false;
            listener.on("connected", () => { arrived = true; });

            const port = await listener.listen(scheme, { port: 0 });
            await assert.rejects(dialler.connect(scheme, "127.0.0.1", port));
            await wait(50);
            assert.equal(arrived, false);
        });

        for (const asker of ["dialler", "listener"]) {
            test(name("requireE2E asked for by the " + asker + " only"), async (t) => {
                const options = asker === "dialler"
                    ? { connect: { requireE2E: true } }
                    : { listen: { requireE2E: true } };
                const l = await link(t, scheme, direction, options);

                // Neither end is handed a peer it could talk to in clear.
                assert.ok(l.diallerPeer.isE2EEnabled(), "dialler not encrypted on arrival");
                assert.ok(l.listenerPeer.isE2EEnabled(), "listener not encrypted on arrival");
                assert.ok(l.diallerPeer.requiresE2E() && l.listenerPeer.requiresE2E());

                const atDialler = nextMessage(l.dialler);
                await l.listenerPeer.send({ required: true });
                assert.deepEqual((await atDialler).msg, { required: true });
            });
        }

        test(name("a large chunked message, encrypted, both ways"), async (t) => {
            const l = await link(t, scheme, direction);
            await encrypt(l.diallerPeer, l.listenerPeer);
            const big = pattern(10 * 1024 * 1024 + 123);

            const atListener = nextMessage(l.listener);
            await l.diallerPeer.send(big);
            sameBytes((await atListener).msg, big);

            const text = "ü".repeat(3 * 1024 * 1024);
            const atDialler = nextMessage(l.dialler);
            await l.listenerPeer.send({ text });
            assert.equal((await atDialler).msg.text, text);
        });

        test(name("each end chunks to the frame limit the other announced"), async (t) => {
            // Small limits at both ends, so a sender that ignored the other's would be
            // dropped by its transport with nothing delivered.
            const limits = { maxPayload: 1024 * 1024, maxPacketSize: 4 * 1024 * 1024 };
            const l = await link(t, scheme, direction, { listen: limits, connect: limits });
            assert.equal(l.diallerPeer.remoteMaxFrame(), 1024 * 1024);
            assert.equal(l.listenerPeer.remoteMaxFrame(), 1024 * 1024);

            const big = pattern(3 * 1024 * 1024);
            const atListener = nextMessage(l.listener);
            await l.diallerPeer.send(big);
            sameBytes((await atListener).msg, big);
            const atDialler = nextMessage(l.dialler);
            await l.listenerPeer.send(big);
            sameBytes((await atDialler).msg, big);
        });
    }
}
