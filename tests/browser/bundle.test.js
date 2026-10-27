const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");

/**
 * The built browser bundle, driven as a browser would drive it.
 *
 * The browser build is not a second-class target — it is how the library runs
 * inside an Electron or mobile app — but nothing had ever loaded
 * dist/anysocket.browser.js and made it talk to anything. Three bugs in that
 * path were found by reading it during this release (send() forwarding its whole
 * arguments array, binaryType never set, a reversed decrypt signature), which is
 * exactly the sort of thing this catches.
 *
 * Rather than a DOM, the bundle gets the globals it actually reaches for:
 * `window` with a `document` (which is how its wrappers detect a browser),
 * WebCrypto, and a WebSocket constructor. The real `ws` package stands in for
 * the browser's WebSocket — the two agree on the surface the bundle uses.
 */

const BUNDLE = path.resolve(__dirname, "../../dist/anysocket.browser.js");

/**
 * Load the bundle with browser-shaped globals in place, then put them back.
 * `WebSocketImpl` stands in for the browser's WebSocket; node's ws by default.
 */
function loadBundle(WebSocketImpl) {
    const saved = {
        window: global.window,
        WebSocket: global.WebSocket,
        self: global.self
    };

    const WS = require("ws");

    // The bundle picks its browser modules by checking window.document.
    global.window = {
        crypto: globalThis.crypto,
        document: {},
        btoa: globalThis.btoa,
        atob: globalThis.atob
    };
    global.self = global.window;
    global.WebSocket = WebSocketImpl || WS;

    let AnySocket;
    try {
        delete require.cache[BUNDLE];
        AnySocket = require(BUNDLE);
    } finally {
        // Keep window in place while the bundle runs; the caller restores.
    }

    return {
        AnySocket: AnySocket,
        restore: () => {
            global.window = saved.window;
            global.WebSocket = saved.WebSocket;
            global.self = saved.self;
            delete require.cache[BUNDLE];
        }
    };
}

test("the bundle exists and was built from the current source", (t) => {
    assert.ok(fs.existsSync(BUNDLE), "run `npm run build` first");

    const bundle = fs.statSync(BUNDLE).mtimeMs;
    const newest = ["src/libs", "src/browser", "src/modules", "src/wrappers"]
        .flatMap((dir) => {
            const full = path.resolve(__dirname, "../..", dir);
            const walk = (p) => fs.statSync(p).isDirectory()
                ? fs.readdirSync(p).flatMap((child) => walk(path.join(p, child)))
                : [fs.statSync(p).mtimeMs];
            return walk(full);
        })
        .reduce((a, b) => Math.max(a, b), 0);

    assert.ok(bundle >= newest,
        "dist/anysocket.browser.js is older than src — run `npm run build`");
});

test("the bundle loads under browser globals", (t) => {
    const loaded = loadBundle();
    t.after(loaded.restore);

    assert.equal(typeof loaded.AnySocket, "function");
    const instance = new loaded.AnySocket();
    assert.match(instance.id, /^[0-9a-f]{32}$/, "a browser peer still gets a UUIDv4");
});

test("a browser peer connects to a node server and exchanges messages", async (t) => {
    // The server is the node build, which is the real pairing.
    const NodeAnySocket = require("../../src/index.js");
    const server = new NodeAnySocket();

    const loaded = loadBundle();
    t.after(async () => {
        loaded.restore();
        try { await server.stop(); } catch (_) {}
    });

    const port = await server.listen("ws", { port: 0 });

    const browser = new loaded.AnySocket();
    t.after(async () => { try { await browser.stop(); } catch (_) {} });

    const peer = await browser.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true });
    assert.equal(peer.id, server.id);

    // browser -> node
    const atServer = new Promise((resolve) => server.once("message", (p) => resolve(p.msg)));
    await peer.send({ from: "the browser" });
    assert.deepEqual(await atServer, { from: "the browser" });

    // node -> browser
    const atBrowser = new Promise((resolve) => browser.once("message", (p) => resolve(p.msg)));
    const serverPeer = [...Object.values(server)].length ? null : null;
    await new Promise((r) => setTimeout(r, 50));
    server.broadcast({ from: "the server" });
    assert.deepEqual(await atBrowser, { from: "the server" });
});

test("a browser peer negotiates 1.0 and encrypts with the modern suite", async (t) => {
    const NodeAnySocket = require("../../src/index.js");
    const constants = require("../../src/libs/_constants");
    const server = new NodeAnySocket();

    const loaded = loadBundle();
    t.after(async () => {
        loaded.restore();
        try { await server.stop(); } catch (_) {}
    });

    const port = await server.listen("ws", { port: 0 });
    const browser = new loaded.AnySocket();
    t.after(async () => { try { await browser.stop(); } catch (_) {} });

    const peer = await browser.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true });
    assert.equal(peer.protocolVersion(), constants.PROTOCOL_VERSION,
        "the browser build must speak the 1.0 protocol");

    await peer.e2e();

    const info = peer.e2eInfo();
    assert.equal(info.protocolVersion, 1);
    assert.equal(info.cipher, "aes-256-gcm");
    assert.ok(["x25519", "p256"].indexOf(info.kex) != -1, "unexpected exchange: " + info.kex);

    // and the binding both ends agree on
    assert.equal(peer.getChannelBinding().length, 32);

    const atServer = new Promise((resolve) => server.once("message", (p) => resolve(p.msg)));
    await peer.send({ secret: "from the browser" });
    assert.deepEqual(await atServer, { secret: "from the browser" });
});

test("binary round-trips from the browser build", async (t) => {
    const NodeAnySocket = require("../../src/index.js");
    const server = new NodeAnySocket();

    const loaded = loadBundle();
    t.after(async () => {
        loaded.restore();
        try { await server.stop(); } catch (_) {}
    });

    const port = await server.listen("ws", { port: 0 });
    const browser = new loaded.AnySocket();
    t.after(async () => { try { await browser.stop(); } catch (_) {} });

    const peer = await browser.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true });
    await peer.e2e();

    const payload = new Uint8Array([0, 1, 2, 250, 251, 255]);
    const atServer = new Promise((resolve) => server.once("message", (p) => resolve(p.msg)));
    await peer.send(payload);

    const got = await atServer;
    assert.deepEqual(Array.from(got), Array.from(payload),
        "bytes must survive the browser build's framing");
});

test("RPC works from the browser build", async (t) => {
    const NodeAnySocket = require("../../src/index.js");
    const server = new NodeAnySocket();
    server.setRPC({ greet: (name) => "hello " + name });

    const loaded = loadBundle();
    t.after(async () => {
        loaded.restore();
        try { await server.stop(); } catch (_) {}
    });

    const port = await server.listen("ws", { port: 0 });
    const browser = new loaded.AnySocket();
    t.after(async () => { try { await browser.stop(); } catch (_) {} });

    const peer = await browser.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true });
    assert.equal(await peer.rpc.greet("world"), "hello world");
});

// The browser's isBuffer read `.buffer` of whatever it was given, so a null or undefined
// RPC argument threw before the call went out (and a null result, when the browser answers).
test("RPC from the browser build takes null and undefined arguments", async (t) => {
    const NodeAnySocket = require("../../src/index.js");
    const server = new NodeAnySocket();
    server.setRPC({ echo: (a, b, c, d, peer) => [a, b === undefined ? "undefined" : b, c, d], nothing: () => null });

    const loaded = loadBundle();
    t.after(async () => {
        loaded.restore();
        try { await server.stop(); } catch (_) {}
    });

    const port = await server.listen("ws", { port: 0 });
    const browser = new loaded.AnySocket();
    t.after(async () => { try { await browser.stop(); } catch (_) {} });

    const peer = await browser.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true });
    assert.deepEqual(await peer.rpc.echo(null, undefined, 0, false), [null, null, 0, false]);
    assert.equal(await peer.rpc.nothing(), null);
});

test("a browser answering an RPC with null", async (t) => {
    const NodeAnySocket = require("../../src/index.js");
    const server = new NodeAnySocket();
    const loaded = loadBundle();
    t.after(async () => {
        loaded.restore();
        try { await server.stop(); } catch (_) {}
    });

    const port = await server.listen("ws", { port: 0 });
    const browser = new loaded.AnySocket();
    browser.setRPC({ nothing: () => null, maybe: (value) => value });
    t.after(async () => { try { await browser.stop(); } catch (_) {} });

    const connected = new Promise((resolve) => server.once("connected", resolve));
    await browser.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true });
    const browserPeer = await connected;
    assert.equal(await browserPeer.rpc.nothing(), null);
    assert.equal(await browserPeer.rpc.maybe(null), null);
});

// The bug the browser client of a real consumer was relying on: an async onAuth
// returned a Promise, which is truthy, so it accepted any server.
test("an async onAuth is enforced in the browser build too", async (t) => {
    const NodeAnySocket = require("../../src/index.js");
    const server = new NodeAnySocket();

    const loaded = loadBundle();
    t.after(async () => {
        loaded.restore();
        try { await server.stop(); } catch (_) {}
    });

    const port = await server.listen("ws", { port: 0 });
    const browser = new loaded.AnySocket();
    browser.onAuth = async () => false;
    t.after(async () => { try { await browser.stop(); } catch (_) {} });

    let refused = null;
    try {
        await browser.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true });
        // the dial may resolve before the reply is judged; give it a moment
        await new Promise((r) => setTimeout(r, 300));
        if (browser.hasPeer(server.id)) refused = null;
        else refused = new Error("refused after connecting");
    } catch (e) {
        refused = e;
    }

    assert.ok(refused, "a browser peer refusing the server must not end up connected");
});

/**
 * A WebSocket as strict as a browser's about its second argument, the
 * subprotocols: anything but a string or a list of strings is a SyntaxError.
 * node's ws takes an options object there, so standing in for the browser it let
 * through what every browser refuses. `seen` collects what each construction got.
 */
function strictBrowserWebSocket(seen) {
    const WS = require("ws");
    return class BrowserWebSocket extends WS {
        constructor(url, protocols) {
            seen.push(protocols);
            const valid = protocols === undefined || typeof protocols == "string" ||
                (Array.isArray(protocols) && protocols.every((p) => typeof p == "string"));
            if (!valid) {
                throw new SyntaxError("Failed to construct 'WebSocket': The subprotocol '" + String(protocols) + "' is invalid.");
            }
            super(url, protocols);
        }
    };
}

// connectTimeout and cookies used to go to the browser's WebSocket as its
// subprotocols, so every dial that set either threw before it started.
test("a browser peer dials with connectTimeout and cookies set", async (t) => {
    const NodeAnySocket = require("../../src/index.js");
    const server = new NodeAnySocket();
    const seen = [];
    const loaded = loadBundle(strictBrowserWebSocket(seen));
    t.after(async () => {
        loaded.restore();
        try { await server.stop(); } catch (_) {}
    });

    const port = await server.listen("ws", { port: 0 });
    const browser = new loaded.AnySocket();
    t.after(async () => { try { await browser.stop(); } catch (_) {} });

    const peer = await browser.connect("ws", "127.0.0.1", port, { allowInsecureWSFallback: true, connectTimeout: 3000, cookies: { session: "abc" } });
    assert.equal(peer.id, server.id);
    assert.ok(seen.length >= 1);
    assert.deepEqual(seen.filter((p) => p !== undefined), [], "only the URL reaches a browser WebSocket");

    // The timer is gone once the link is up: it must not close a live connection.
    await new Promise((r) => setTimeout(r, 50));
    const atServer = new Promise((resolve) => server.once("message", (p) => resolve(p.msg)));
    await peer.send({ still: "up" });
    assert.deepEqual(await atServer, { still: "up" });
});

test("connectTimeout bounds a browser dial to a server that never upgrades", async (t) => {
    const net = require("net");
    const sockets = [];
    const silent = net.createServer((socket) => { sockets.push(socket); socket.on("error", () => {}); });
    await new Promise((resolve) => silent.listen(0, "127.0.0.1", resolve));
    t.after(() => { sockets.forEach((s) => s.destroy()); silent.close(); });

    const loaded = loadBundle(strictBrowserWebSocket([]));
    t.after(loaded.restore);
    const browser = new loaded.AnySocket();
    t.after(async () => { try { await browser.stop(); } catch (_) {} });

    const started = Date.now();
    await assert.rejects(browser.connect("ws", "127.0.0.1", silent.address().port, { allowInsecureWSFallback: true, connectTimeout: 300 }));
    const took = Date.now() - started;
    // The secure attempt and the plain one each get the timeout, as on node.
    assert.ok(took < 3000, "took " + took + "ms");
    assert.ok(took >= 250, "gave up after " + took + "ms, before the timeout");
});

test("BrowserWS drops a second argument a browser would refuse", (t) => {
    const seen = [];
    const saved = global.WebSocket;
    global.WebSocket = class { constructor(url, protocols) { seen.push(arguments.length, protocols); } };
    t.after(() => { global.WebSocket = saved; });
    const BrowserWS = require("../../src/browser/ws.js");

    new BrowserWS("ws://x/", { handshakeTimeout: 5 });
    new BrowserWS("ws://x/", ["chat", 3]);
    new BrowserWS("ws://x/", null);
    assert.deepEqual(seen, [1, undefined, 1, undefined, 1, undefined]);

    seen.length = 0;
    new BrowserWS("ws://x/", "chat");
    new BrowserWS("ws://x/", ["chat", "v2"]);
    assert.deepEqual(seen, [2, "chat", 2, ["chat", "v2"]]);
});
