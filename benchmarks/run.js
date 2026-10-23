#!/usr/bin/env node
/**
 * anysocket 1.0 against the published 0.4.32, plain and encrypted.
 *
 * Run with:  npm run bench
 *
 * Every figure is measured here and now, on loopback, in one process — so the
 * numbers are about protocol and framing cost, not about a network. The 0.4.32
 * column comes from the real published package (devDependency `anysocket-legacy`),
 * not from a reimplementation of it.
 */

const AnySocket = require("../src/index.js");

let Legacy = null;
try {
    Legacy = require("anysocket-legacy");
} catch (e) {
    console.error("anysocket-legacy is not installed; run `npm install` first.\n");
    process.exit(1);
}

const MB = 1024 * 1024;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let port = 30000 + Math.floor(Math.random() * 20000);

async function link(Client, opts = {}) {
    const server = new AnySocket();
    const client = new Client();
    const p = ++port;
    const wire = Object.assign({ maxPayload: 64 * MB }, opts);

    await server.listen("ws", Object.assign({ port: p }, wire));
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
async function connectHandshake(Client, rounds) {
    const server = new AnySocket();
    const p = ++port;
    await server.listen("ws", { port: p, maxPayload: 64 * MB });

    let total = 0;
    for (let i = 0; i < rounds; i++) {
        const client = new Client();
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

async function e2eHandshake(Client, rounds) {
    let total = 0;
    for (let i = 0; i < rounds; i++) {
        const l = await link(Client);
        const up = new Promise((r) => l.peer.on("e2e", r));
        const t0 = process.hrtime.bigint();
        l.peer.e2e();
        await up;
        total += ms(t0);
        await l.stop();
    }
    return { label: "ms", value: total / rounds };
}

async function smallMessages(Client, count, encrypt) {
    const l = await link(Client);
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

/**
 * `binary` sends each version's idiomatic representation of raw bytes: 0.4.32
 * has no path for them in a message, so they go through Packer (base64), which
 * is what its own documentation tells you to do. 1.0 sends the bytes.
 */
async function throughput(Client, sizeMB, encrypt, binary) {
    const legacy = Client === Legacy;
    const l = await link(Client);
    if (encrypt) {
        const up = new Promise((r) => l.peer.on("e2e", r));
        l.peer.e2e();
        await up;
    }

    const bytes = sizeMB * MB;
    let payload;
    if (!binary) payload = { blob: "x".repeat(bytes) };
    else if (legacy) payload = Legacy.Packer.pack(Buffer.alloc(bytes));
    else payload = Buffer.alloc(bytes);

    const received = new Promise((resolve) => l.server.once("message", (p) => resolve(p.msg)));

    const stats = meter(l.peer);
    const t0 = process.hrtime.bigint();
    l.peer.send(payload);
    const got = await received;
    const took = ms(t0);
    await l.stop();

    let length;
    if (!binary) length = got.blob.length;
    else if (legacy) length = Legacy.Packer.unpack(got).length;
    else length = got.length;
    if (length !== bytes) throw new Error("payload came back wrong: " + length);

    return { label: "MB/s", value: sizeMB / (took / 1000), bytes: stats.bytes };
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
    console.log("  " + pad("", w) + "  " + "0.4.32".padStart(12) + "  " + "1.0".padStart(12) + "   change");
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
    console.log("\nanysocket 1.0 vs 0.4.32 — loopback, node " + process.version + ", " + process.platform + "/" + process.arch);

    // --- connection setup
    record("connect + authenticate",
        await connectHandshake(Legacy, 20),
        await connectHandshake(AnySocket, 20));

    record("e2e handshake",
        await e2eHandshake(Legacy, 20),
        await e2eHandshake(AnySocket, 20),
        "0.4.32: secp521r1.  1.0: x25519 (p256 where unavailable)");

    // --- small messages
    let before = await smallMessages(Legacy, 3000, false);
    let after = await smallMessages(AnySocket, 3000, false);
    record("2KB messages, plain", before, after, bytesNote(before, after));

    before = await smallMessages(Legacy, 3000, true);
    after = await smallMessages(AnySocket, 3000, true);
    record("2KB messages, encrypted", before, after, bytesNote(before, after));

    // --- bulk, text
    before = await throughput(Legacy, 32, false, false);
    after = await throughput(AnySocket, 32, false, false);
    record("32MB of text, plain", before, after, bytesNote(before, after, 32 * MB));

    before = await throughput(Legacy, 32, true, false);
    after = await throughput(AnySocket, 32, true, false);
    record("32MB of text, encrypted", before, after, bytesNote(before, after, 32 * MB));

    // --- bulk, binary: where 0.4.32 had no option but to inflate it
    before = await throughput(Legacy, 32, false, true);
    after = await throughput(AnySocket, 32, false, true);
    record("32MB of bytes, plain", before, after, bytesNote(before, after, 32 * MB));

    before = await throughput(Legacy, 32, true, true);
    after = await throughput(AnySocket, 32, true, true);
    record("32MB of bytes, encrypted", before, after, bytesNote(before, after, 32 * MB));

    // --- 1.0 only: plain against encrypted, which is the cost of turning e2e on
    const plain = await throughput(AnySocket, 128, false, true);
    const sealed = await throughput(AnySocket, 128, true, true);
    render();

    console.log();
    console.log("  Cost of turning e2e on, 1.0 only (128MB of bytes):");
    console.log("    plain      " + plain.value.toFixed(0) + " MB/s");
    console.log("    encrypted  " + sealed.value.toFixed(0) + " MB/s   (" +
        ((1 - sealed.value / plain.value) * 100).toFixed(0) + "% slower)");
    console.log();

    process.exit(0);
})().catch((e) => {
    console.error("\nbenchmark failed:", e && e.stack || e);
    process.exit(1);
});
