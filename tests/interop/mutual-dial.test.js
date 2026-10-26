const test = require("node:test");
const assert = require("node:assert");
const AnySocket = require("../../src/index.js");
const LegacyAnySocket = require("anysocket-legacy");
const { stop, wait, freePort } = require("../helpers/loopback");

/**
 * A 1.0 peer and a 0.4.x peer that dial each other at once.
 *
 * 1.0 keeps the connection dialled by the lower id; 0.4.x keeps whichever became ready
 * first on its side. Applying our rule against it, the two ends often dropped opposite
 * connections and lost both — over and over, for as long as a fleet was mid-upgrade. Against
 * a 0.4.x peer we now let it choose, and adopt the one it keeps.
 */
async function round(t) {
    const modern = new AnySocket();
    const legacy = new LegacyAnySocket();
    t.after(() => stop(modern, legacy));

    const modernPort = await modern.listen("ws", { port: 0 });
    const legacyPort = await freePort();
    await legacy.listen("ws", legacyPort);

    const drops = { modern: 0, legacy: 0 };
    modern.on("disconnected", () => drops.modern++);
    legacy.on("disconnected", () => drops.legacy++);

    await Promise.allSettled([
        modern.connect("ws", "127.0.0.1", legacyPort),
        legacy.connect("ws", "127.0.0.1", modernPort)
    ]);
    await wait(500);

    return { modern, legacy, drops };
}

test("a 1.0 and a 0.4.x peer dialling each other keep a connection", async (t) => {
    for (let i = 0; i < 8; i++) {
        const { modern, legacy, drops } = await round(t);

        assert.ok(modern.hasPeer(legacy.id), "round " + i + ": the 1.0 peer lost the 0.4.x peer");
        assert.ok(legacy.hasPeer(modern.id), "round " + i + ": the 0.4.x peer lost the 1.0 peer");

        // Messages cross both ways on whatever connection survived.
        const toLegacy = new Promise((resolve) => legacy.on("message", (p) => resolve(p.msg)));
        const toModern = new Promise((resolve) => modern.on("message", (p) => resolve(p.msg)));
        modern.broadcast({ round: i, from: "modern" });
        legacy.broadcast({ round: i, from: "legacy" });
        assert.deepEqual(await Promise.race([toLegacy, wait(2000).then(() => "nothing")]), { round: i, from: "modern" });
        assert.deepEqual(await Promise.race([toModern, wait(2000).then(() => "nothing")]), { round: i, from: "legacy" });

        await stop(modern, legacy);
    }
});
