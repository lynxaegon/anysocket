const test = require("node:test");
const assert = require("node:assert");
const SerialQueue = require("../../src/libs/SerialQueue");

/**
 * The queue every connection pushes its frames through, in and out: one item at a
 * time, in order, holding while paused, dropping what is left when killed.
 */
const tick = () => new Promise((r) => setImmediate(r));

test("items reach the worker one at a time, in order, with its context", async () => {
    const ctx = { seen: [], busy: false };
    const q = new SerialQueue(ctx, function (item, done) {
        assert.equal(this, ctx);
        assert.equal(this.busy, false, "two items in hand at once");
        this.busy = true;
        setTimeout(() => { this.seen.push(item); this.busy = false; done(); }, 1);
    });
    for (let i = 0; i < 20; i++) q.push(i);
    while (ctx.seen.length < 20) await tick();
    assert.deepEqual(ctx.seen, Array.from({ length: 20 }, (_, i) => i));
});

test("a worker that finishes synchronously does not grow the stack", () => {
    const seen = [];
    const q = new SerialQueue(null, (item, done) => { seen.push(item); done(); });
    for (let i = 0; i < 200000; i++) q.push(i);
    assert.equal(seen.length, 200000);
    assert.equal(q.length(), 0);
});

test("pause holds what is pushed; the item in hand still finishes; resume carries on", async () => {
    const seen = [];
    let release = null;
    const q = new SerialQueue(null, (item, done) => {
        if (item === "slow") release = () => { seen.push(item); done(); };
        else { seen.push(item); done(); }
    });
    q.push("slow");
    q.pause();
    q.push("a");
    q.push("b");
    release();
    await tick();
    assert.deepEqual(seen, ["slow"]);
    assert.deepEqual(q.getQueue(), ["a", "b"]);
    q.resume();
    assert.deepEqual(seen, ["slow", "a", "b"]);
});

test("kill drops what was not handed out; the queue still works after", async () => {
    const seen = [];
    let finish = null;
    const q = new SerialQueue(null, (item, done) => { seen.push(item); finish = done; });
    q.push(1);
    q.push(2);
    q.push(3);
    q.kill();
    assert.deepEqual(q.getQueue(), []);
    finish();
    assert.deepEqual(seen, [1]);
    q.push(4);
    finish();
    assert.deepEqual(seen, [1, 4]);
});

test("a done called twice hands out nothing extra", () => {
    const seen = [];
    let finish = null;
    const q = new SerialQueue(null, (item, done) => { seen.push(item); finish = done; });
    q.push(1);
    q.push(2);
    const first = finish;
    first();
    first();
    assert.deepEqual(seen, [1, 2]);
    assert.equal(q.running, true, "item 2 is still in hand");
});
