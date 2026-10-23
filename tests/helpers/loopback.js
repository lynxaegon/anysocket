const AnySocket = require("../../src/index.js");

// `node --test` runs each file in its own process, in parallel, so a shared
// starting port would have the files fighting over it. Randomise the base and
// still retry below, because nothing stops an unrelated process from holding one.
let port = 19000 + Math.floor(Math.random() * 20000);
const nextPort = () => ++port;

const isPortTaken = (e) => String(e && (e.code || e.message || e)).includes("EADDRINUSE");

/** Listen on ws, moving to another port if something already holds this one. */
async function listen(server, options = {}, attempts = 25) {
    for (let i = 0; i < attempts; i++) {
        const p = nextPort();
        try {
            await server.listen("ws", Object.assign({ port: p }, options));
            return p;
        } catch (e) {
            if (!isPortTaken(e)) throw e;
        }
    }
    throw new Error("no free port after " + attempts + " attempts");
}

/**
 * Two instances talking over ws: `server` listening, `client` dialled into it.
 * Resolves once both ends are ready, with the AnyPeer each one holds for the
 * other. `configure(server, client)` runs before either side starts, which is
 * where auth hooks and RPC tables belong.
 *
 * Pass the test context as `t` and both instances are torn down when the test
 * ends, including when it fails — a leaked listener keeps the process alive and
 * hangs the whole file.
 */
async function pair(t, options = {}) {
    const server = new AnySocket();
    const client = new AnySocket();
    if (t) t.after(() => stop(server, client));

    if (options.configure) {
        options.configure(server, client);
    }

    const serverSide = new Promise((resolve) => server.once("connected", resolve));
    const p = await listen(server, options.listen);
    const clientPeer = await client.connect("ws", "127.0.0.1", p, options.connect);
    const serverPeer = await serverSide;

    return {
        server,
        client,
        serverPeer,
        clientPeer,
        port: p,
        stop: () => stop(server, client)
    };
}

/** Dial a server whose handshake is expected to fail. Resolves the reason. */
async function expectRefused(t, options = {}) {
    const server = new AnySocket();
    const client = new AnySocket();
    if (t) t.after(() => stop(server, client));

    if (options.configure) {
        options.configure(server, client);
    }

    const p = await listen(server, options.listen);

    try {
        await client.connect("ws", "127.0.0.1", p, options.connect);
    } catch (e) {
        return e || new Error("refused");
    }

    return null;
}

async function stop(...instances) {
    for (const instance of instances) {
        try {
            await instance.stop();
        } catch (_) { /* already down */ }
    }
}

/**
 * The transport socket behind an AnyPeer, for tests that need to put bytes on
 * the wire by hand. AnyPeer keeps its protocol on a private Symbol.
 */
function rawSocket(peer) {
    const sym = Object.getOwnPropertySymbols(peer).find((s) => s.description === "private protocol");
    return peer[sym].peer.socket;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { pair, expectRefused, stop, listen, rawSocket, wait, nextPort, AnySocket };
