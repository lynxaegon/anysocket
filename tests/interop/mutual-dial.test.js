const test = require("node:test");
const assert = require("node:assert");
const AnySocket = require("../../src/index.js");
const PreviousAnySocket = require("anysocket-1-0");
const { stop, wait } = require("../helpers/loopback");

/**
 * A 1.1 and a 1.0.1 peer that dial each other at once.
 *
 * Both keep the connection dialled by the lower id, so both have to settle on
 * the same one of the two — whether that is 1.1's frame-AUTH dial or 1.0.1's
 * text-AUTH one. If they chose differently, each would close the other's keeper
 * and both connections would die, every time the two dialled each other.
 */
async function round(t, scheme, ids) {
    const modern = new AnySocket();
    const previous = new PreviousAnySocket();
    [modern.id, previous.id] = ids;
    t.after(() => stop(modern, previous));

    const modernPort = await modern.listen(scheme, { port: 0 });
    const previousPort = await previous.listen(scheme, { port: 0 });

    const drops = [];
    modern.on("disconnected", (_p, reason) => drops.push(reason));
    previous.on("disconnected", (_p, reason) => drops.push(reason));

    const [toPrevious, toModern] = await Promise.allSettled([
        modern.connect(scheme, "127.0.0.1", previousPort, { allowInsecureWSFallback: true }),
        previous.connect(scheme, "127.0.0.1", modernPort, { allowInsecureWSFallback: true })
    ]);
    await wait(300);

    return { modern, previous, drops, toPrevious, toModern };
}

for (const scheme of ["ws", "tcp"]) {
    test("a 1.1 and a 1.0.1 peer dialling each other keep one connection, over " + scheme, async (t) => {
        const low = "0".repeat(32);
        const high = "f".repeat(32);
        // Alternate which end has the lower id, so each end is the designated dialler.
        for (let i = 0; i < 6; i++) {
            const ids = i % 2 ? [low, high] : [high, low];
            const { modern, previous, drops, toPrevious, toModern } = await round(t, scheme, ids);
            const at = "round " + i + ": ";

            // A dial that lost the race still resolves, with the connection that was kept.
            assert.equal(toPrevious.status, "fulfilled", at + "1.1's dial: " + (toPrevious.reason && toPrevious.reason.message));
            assert.equal(toModern.status, "fulfilled", at + "1.0.1's dial: " + (toModern.reason && toModern.reason.message));
            assert.ok(modern.hasPeer(previous.id), at + "1.1 lost the 1.0.1 peer");
            assert.ok(previous.hasPeer(modern.id), at + "1.0.1 lost the 1.1 peer");

            // Both ends kept the same one: the one the lower id dialled.
            const lowerIsModern = modern.id < previous.id;
            const kept = modern.getPeer(previous.id);
            assert.equal(kept.isOutbound(), lowerIsModern, at + "1.1 kept the wrong one");
            assert.equal(previous.getPeer(modern.id).isOutbound(), !lowerIsModern, at + "1.0.1 kept the wrong one");
            assert.equal(kept.legacyHandshake(), !lowerIsModern, at + "legacyHandshake() names the wrong connection");

            // The only peer either end may have dropped is a duplicate it retired for the
            // agreed connection, which it announces as such.
            for (const reason of drops) {
                assert.match(String(reason), /Superseded/, at + "a peer was dropped for: " + reason);
            }

            // Messages cross both ways on whatever connection survived.
            const toP = new Promise((resolve) => previous.once("message", (p) => resolve(p.msg)));
            const toM = new Promise((resolve) => modern.once("message", (p) => resolve(p.msg)));
            modern.broadcast({ round: i, from: "1.1" });
            previous.broadcast({ round: i, from: "1.0.1" });
            assert.deepEqual(await Promise.race([toP, wait(2000).then(() => "nothing")]), { round: i, from: "1.1" });
            assert.deepEqual(await Promise.race([toM, wait(2000).then(() => "nothing")]), { round: i, from: "1.0.1" });

            await stop(modern, previous);
        }
    });
}
