const AnySocket = require("../../src/index.js");

/**
 * Listen on ws on a port the OS picks. Test files run in parallel processes, and
 * choosing ports ourselves — however randomly — let two of them collide and a
 * client reach the wrong file's server. Port 0 removes the collision outright.
 */
async function listen(server, options = {}) {
    return server.listen("ws", Object.assign({}, options, { port: 0 }));
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

    // Wait for the peer that is *our* client, not merely the first to arrive.
    // Test files run in parallel, so another file's client can reach this port
    // and would otherwise be handed back as the server-side peer.
    const serverSide = new Promise((resolve) => {
        const onConnected = (peer) => {
            if (peer.id !== client.id) return;
            server.off ? server.off("connected", onConnected) : server.removeListener("connected", onConnected);
            resolve(peer);
        };
        server.on("connected", onConnected);
    });

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
function protocolOf(peer) {
    const sym = Object.getOwnPropertySymbols(peer).find((s) => s.description === "private protocol");
    return peer[sym];
}

function rawSocket(peer) {
    return protocolOf(peer).peer.socket;
}

/**
 * A port the OS just handed out, for something that cannot take port 0 itself —
 * the published 0.4.32 turns 0 into 80, and dies on a busy port. Every other
 * listener in the suite takes port 0, so the OS will not give this one out again
 * to a parallel test file in the moment before it is used.
 */
function freePort() {
    const http = require("http");
    return new Promise((resolve, reject) => {
        const probe = http.createServer();
        probe.once("error", reject);
        probe.listen(0, "0.0.0.0", () => {
            const port = probe.address().port;
            probe.close(() => resolve(port));
        });
    });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { pair, expectRefused, stop, listen, rawSocket, protocolOf, wait, freePort, AnySocket };
