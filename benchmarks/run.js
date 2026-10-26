#!/usr/bin/env node
/**
 * anysocket 1.1 against the published 1.0.1, plain and encrypted.
 *
 * Run with:  npm run bench
 *
 * Every figure is measured here and now, on loopback, in one process — so the
 * numbers are about protocol and framing cost, not about a network. The 1.0.1
 * column comes from the real published package (devDependency `anysocket-1-0`),
 * not from a reimplementation of it. Both ends of every link run the version
 * being measured.
 */

const AnySocket = require("../src/index.js");

let Previous = null;
try {
    Previous = require("anysocket-1-0");
} catch (e) {
    console.error("anysocket-1-0 is not installed; run `npm install` first.\n");
    process.exit(1);
}

const MB = 1024 * 1024;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function link(Lib, opts = {}) {
    const server = new Lib();
    const client = new Lib();
    const wire = Object.assign({ maxPayload: 64 * MB }, opts);

    // port 0: a guessed port can be one another process holds on 127.0.0.1 while
    // the 0.0.0.0 bind still succeeds, and the dial then reaches that process
    const p = await server.listen("ws", Object.assign({ port: 0 }, wire));
    const peer = await client.connect("ws", "127.0.0.1", p, wire);
    await wait(80);

    return {
        server, client, peer,
        stop: async () => {
            try { await client.stop(); } catch (_) {}
            try { await server.stop(); } catch (_) {}
        }
    };
}

/** Count the bytes this peer actually puts on the wire. */
function meter(peer) {
    const sym = Object.getOwnPropertySymbols(peer).find((s) => s.description === "private protocol");
    const socket = peer[sym].peer.socket;
    const stats = { bytes: 0 };
    const original = socket.send.bind(socket);

    socket.send = (data, cb) => {
        stats.bytes += (typeof data == "string" ? Buffer.byteLength(data) : data.length);
        return original(data, cb);
    };
    return stats;
}

const ms = (from) => Number(process.hrtime.bigint() - from) / 1e6;

// ---------------------------------------------------------------- measurements

/**
 * Dial and authenticate, both sides. Timed without any settle wait — one
 * listener, dialled repeatedly, stopping at the moment the listener has a
 * ready peer.
 */
async function connectHandshake(Lib, rounds) {
    const server = new Lib();
    const p = await server.listen("ws", { port: 0, maxPayload: 64 * MB });

    let total = 0;
    for (let i = 0; i < rounds; i++) {
        const client = new Lib();
        const ready = new Promise((r) => server.once("connected", r));

        const t0 = process.hrtime.bigint();
        await client.connect("ws", "127.0.0.1", p, { maxPayload: 64 * MB });
        await ready;
        total += ms(t0);

        try { await client.stop(); } catch (_) {}
    }

    try { await server.stop(); } catch (_) {}
    return { label: "ms", value: total / rounds };
}

async function e2eHandshake(Lib, rounds) {
    let total = 0;
    for (let i = 0; i < rounds; i++) {
        const l = await link(Lib);
        const up = new Promise((r) => l.peer.on("e2e", r));
        const t0 = process.hrtime.bigint();
        l.peer.e2e();
        await up;
        total += ms(t0);
        await l.stop();
    }
    return { label: "ms", value: total / rounds };
}

async function smallMessages(Lib, count, encrypt) {
    const l = await link(Lib);
    if (encrypt) {
        const up = new Promise((r) => l.peer.on("e2e", r));
        l.peer.e2e();
        await up;
    }

    const payload = { seq: 0, blob: "x".repeat(2048), nested: { a: 1, b: [1, 2, 3] } };
    let seen = 0;
    const done = new Promise((resolve) => {
        l.server.on("message", () => { if (++seen === count) resolve(); });
    });

    const stats = meter(l.peer);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < count; i++) {
        payload.seq = i;
        l.peer.send(payload);
    }
    await done;
    const took = ms(t0);
    await l.stop();

    return { label: "msg/s", value: count / (took / 1000), bytes: stats.bytes };
}

/** `binary` sends raw bytes, which both versions carry as bytes. */
async function throughput(Lib, sizeMB, encrypt, binary) {
    const l = await link(Lib);
    if (encrypt) {
        const up = new Promise((r) => l.peer.on("e2e", r));
        l.peer.e2e();
        await up;
    }

    const bytes = sizeMB * MB;
    const payload = binary ? Buffer.alloc(bytes) : { blob: "x".repeat(bytes) };

    const received = new Promise((resolve) => l.server.once("message", (p) => resolve(p.msg)));

    const stats = meter(l.peer);
    const t0 = process.hrtime.bigint();
    l.peer.send(payload);
    const got = await received;
    const took = ms(t0);
    await l.stop();

    const length = binary ? got.length : got.blob.length;
    if (length !== bytes) throw new Error("payload came back wrong: " + length);

    return { label: "MB/s", value: sizeMB / (took / 1000), bytes: stats.bytes };
}

// ---------------------------------------------------------------- repeats

// One sample of a loopback benchmark is noisy — easily +/-30% on a desktop that
// is doing anything else. Each figure is the median of RUNS samples, and a
// figure whose samples spread widely says so, so a noisy number is visible as
// one rather than read as a result. BENCH_RUNS overrides the count.
const RUNS = Math.max(1, parseInt(process.env.BENCH_RUNS, 10) || 5);

function summarise(samples) {
    const sorted = samples.slice().sort((a, b) => a.value - b.value);
    const mid = sorted[Math.floor(sorted.length / 2)];
    const spread = sorted.length > 1
        ? (sorted[sorted.length - 1].value - sorted[0].value) / mid.value
        : 0;
    return Object.assign({}, mid, { spread: spread });
}

async function median(fn) {
    await fn(); // warm-up, discarded: the first pass pays for JIT compilation
    const samples = [];
    for (let i = 0; i < RUNS; i++) samples.push(await fn());
    return summarise(samples);
}

/**
 * Both sides of a comparison, sampled alternately. Taking every sample of one
 * and then every sample of the other lets anything that drifts over a run —
 * heat, a background task — land on one side only and read as a difference
 * between them; interleaving spreads it across both. A warm-up pair is taken
 * and thrown away first.
 */
async function compare(before, after) {
    await before();
    await after();

    const a = [];
    const b = [];
    for (let i = 0; i < RUNS; i++) {
        a.push(await before());
        b.push(await after());
    }
    return [summarise(a), summarise(b)];
}

// ---------------------------------------------------------------- presentation

const rows = [];

function record(name, before, after, note) {
    rows.push({ name, before, after, note });
}

function render() {
    const pad = (s, n) => String(s).padEnd(n);
    const num = (v) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));

    const w = Math.max(...rows.map((r) => r.name.length), 28);
    console.log();
    console.log("  " + pad("", w) + "  " + "1.0.1".padStart(12) + "  " + "1.1".padStart(12) + "   change");
    console.log("  " + "-".repeat(w + 46));

    for (const row of rows) {
        if (!row.after) {
            console.log("  " + pad(row.name, w));
            continue;
        }

        const before = row.before ? num(row.before.value) + " " + row.before.label : "—";
        const after = num(row.after.value) + " " + row.after.label;

        let change = "";
        if (row.before) {
            const lowerIsBetter = row.after.label === "ms";
            const ratio = lowerIsBetter
                ? row.before.value / row.after.value
                : row.after.value / row.before.value;
            change = ratio >= 1.05 ? ratio.toFixed(2) + "x faster"
                : ratio <= 0.95 ? (1 / ratio).toFixed(2) + "x slower"
                : "about the same";
        }

        console.log("  " + pad(row.name, w) + "  " + before.padStart(12) + "  " + after.padStart(12) + "   " + change);
        if (row.note) console.log("  " + pad("", w) + "  " + row.note);
        const noisy = [row.before, row.after].filter((r) => r && r.spread > 0.25);
        if (noisy.length) {
            console.log("  " + pad("", w) + "  (noisy: samples ranged over " +
                noisy.map((r) => Math.round(r.spread * 100) + "%").join(" / ") + " of the median)");
        }
    }
}

function bytesNote(before, after, payloadBytes) {
    if (!before || !after) return null;
    const fmt = (b) => (b / MB).toFixed(2) + "MB";
    const ratio = before.bytes / after.bytes;
    return "on the wire: " + fmt(before.bytes) + " -> " + fmt(after.bytes) +
        (ratio >= 1.05 ? "  (" + ratio.toFixed(2) + "x fewer bytes)" : "") +
        (payloadBytes ? "  for " + fmt(payloadBytes) + " of payload" : "");
}

(async () => {
    console.log("\nanysocket 1.1 vs 1.0.1 — loopback, node " + process.version + ", " + process.platform + "/" + process.arch + ", median of " + RUNS);

    // --- connection setup
    record("connect + authenticate",
        ...await compare(() => connectHandshake(Previous, 20), () => connectHandshake(AnySocket, 20)));

    record("e2e handshake",
        ...await compare(() => e2eHandshake(Previous, 20), () => e2eHandshake(AnySocket, 20)));

    // --- small messages
    let [before, after] = await compare(() => smallMessages(Previous, 3000, false), () => smallMessages(AnySocket, 3000, false));
    record("2KB messages, plain", before, after, bytesNote(before, after));

    [before, after] = await compare(() => smallMessages(Previous, 3000, true), () => smallMessages(AnySocket, 3000, true));
    record("2KB messages, encrypted", before, after, bytesNote(before, after));

    // --- bulk, text
    [before, after] = await compare(() => throughput(Previous, 32, false, false), () => throughput(AnySocket, 32, false, false));
    record("32MB of text, plain", before, after, bytesNote(before, after, 32 * MB));

    [before, after] = await compare(() => throughput(Previous, 32, true, false), () => throughput(AnySocket, 32, true, false));
    record("32MB of text, encrypted", before, after, bytesNote(before, after, 32 * MB));

    // --- bulk, binary
    [before, after] = await compare(() => throughput(Previous, 32, false, true), () => throughput(AnySocket, 32, false, true));
    record("32MB of bytes, plain", before, after, bytesNote(before, after, 32 * MB));

    [before, after] = await compare(() => throughput(Previous, 32, true, true), () => throughput(AnySocket, 32, true, true));
    record("32MB of bytes, encrypted", before, after, bytesNote(before, after, 32 * MB));

    // --- 1.1 only: plain against encrypted, which is the cost of turning e2e on
    const [plain, sealed] = await compare(() => throughput(AnySocket, 128, false, true), () => throughput(AnySocket, 128, true, true));
    render();

    console.log();
    console.log("  Cost of turning e2e on, 1.1 only (128MB of bytes):");
    console.log("    plain      " + plain.value.toFixed(0) + " MB/s");
    console.log("    encrypted  " + sealed.value.toFixed(0) + " MB/s   (" +
        ((1 - sealed.value / plain.value) * 100).toFixed(0) + "% slower)");
    console.log();

    process.exit(0);
})().catch((e) => {
    console.error("\nbenchmark failed:", e && e.stack || e);
    process.exit(1);
});
