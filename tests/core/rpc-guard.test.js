const test = require("node:test");
const assert = require("node:assert");
const Packet = require("../../src/libs/Packet");
const constants = require("../../src/libs/_constants");
const { pair, AnySocket } = require("../helpers/loopback");

const withRPC = (t, rpc, configure) => pair(t, {
    configure: (server, client) => {
        server.setRPC(rpc);
        if (configure) configure(server, client);
    }
});

/**
 * Call a method path the way a hostile peer would: a raw RPC body, not through
 * the proxy, which would never build some of these paths.
 */
async function rawCall(peer, method, params = []) {
    const packet = Packet.data({ type: constants.INTERNAL_PACKET_TYPE.RPC, method, params, bin: [] })
        .setType(constants.PACKET_TYPE.INTERNAL);
    return (await peer._send(packet, true)).msg;
}

// ---- what a method path can reach ---------------------------------------------

// The walk used to follow any property, so every exposed table also exposed
// what objects inherit: Object.assign handed back our own AnyPeer for the
// connection, Object.freeze froze it.
test("a method path never reaches what objects inherit", async (t) => {
    const link = await withRPC(t, { ping: () => "pong", list: [1, 2, 3] });

    for (const path of [
        ["hasOwnProperty"],
        ["toString"],
        ["constructor", "assign"],
        ["constructor", "freeze"],
        ["constructor", "constructor"],
        ["__proto__", "propertyIsEnumerable"],
        ["ping", "call"],
        ["ping", "constructor"],
        ["list", "push"]
    ]) {
        const reply = await rawCall(link.clientPeer, path, [{}]);
        assert.equal(reply.code, 404, path.join(".") + " answered " + JSON.stringify(reply));
    }
    assert.deepEqual(link.server.rpc.list, [1, 2, 3]);
});

test("a malformed method path is not found", async (t) => {
    const link = await withRPC(t, { ping: () => "pong" });

    for (const path of ["ping", [], [1], [null], [["ping"]], {}]) {
        const reply = await rawCall(link.clientPeer, path);
        assert.equal(reply.code, 404, JSON.stringify(path));
    }
});

test("methods a class defines are callable, on an instance exposed directly", async (t) => {
    class Base { hello(name) { return "hello " + name; } }
    class Service extends Base { add(a, b) { return a + b; } }
    const link = await withRPC(t, new Service());

    assert.equal(await link.clientPeer.rpc.add(2, 3), 5);
    assert.equal(await link.clientPeer.rpc.hello("you"), "hello you");
});

// ---- rpcGuard ----------------------------------------------------------------

test("without a guard, every exposed method is callable", async (t) => {
    const link = await withRPC(t, { ping: () => "pong" });
    assert.equal(await link.clientPeer.rpc.ping(), "pong");
});

test("a guard sees the calling peer, the path and the arguments", async (t) => {
    let seen = null;
    const link = await withRPC(t, { a: { b: (x, y) => x + y } }, (server) => {
        server.rpcGuard = (peer, path, args) => { seen = { id: peer.id, path, args }; return true; };
    });

    assert.equal(await link.clientPeer.rpc.a.b(1, 2), 3);
    assert.deepEqual(seen, { id: link.client.id, path: ["a", "b"], args: [1, 2] });
});

test("a refused call never runs, and rejects with 403", async (t) => {
    let ran = false;
    const link = await withRPC(t, { admin: { wipe: () => { ran = true; } }, ping: () => "pong" }, (server) => {
        server.rpcGuard = (peer, path) => path[0] !== "admin";
    });

    assert.equal(await link.clientPeer.rpc.ping(), "pong");
    await assert.rejects(link.clientPeer.rpc.admin.wipe(), (e) => {
        assert.equal(e.code, AnySocket.ERRORS.RPC_FORBIDDEN);
        assert.equal(e.status, 403);
        assert.equal(e.error, "Forbidden");
        return true;
    });
    assert.equal(ran, false);
});

test("only true allows: a guard returning something else refuses", async (t) => {
    let ran = 0;
    for (const answer of [false, undefined, null, 1, "yes", {}]) {
        const link = await withRPC(t, { go: () => { ran++; } }, (server) => {
            server.rpcGuard = () => answer;
        });
        await assert.rejects(link.clientPeer.rpc.go(), (e) => e.code === AnySocket.ERRORS.RPC_FORBIDDEN && e.status === 403, JSON.stringify(answer));
        await link.stop();
    }
    assert.equal(ran, 0);
});

test("an async guard is awaited", async (t) => {
    const link = await withRPC(t, { ping: () => "pong" }, (server) => {
        server.rpcGuard = async (peer) => { await new Promise((r) => setTimeout(r, 20)); return peer.id !== "nobody"; };
    });
    assert.equal(await link.clientPeer.rpc.ping(), "pong");
});

test("a guard that throws refuses, with its reason", async (t) => {
    let ran = false;
    const link = await withRPC(t, { go: () => { ran = true; } }, (server) => {
        server.rpcGuard = () => { throw new Error("not authenticated"); };
    });

    await assert.rejects(link.clientPeer.rpc.go(), (e) => {
        assert.equal(e.code, AnySocket.ERRORS.RPC_FORBIDDEN);
        assert.equal(e.status, 403);
        assert.equal(e.error, "not authenticated");
        return true;
    });
    assert.equal(ran, false);
});

test("rpcGuard can be given to the constructor", async (t) => {
    const server = new AnySocket({ rpcGuard: () => false });
    assert.equal(typeof server.rpcGuard, "function");
    await server.stop().catch(() => {});
});

test("a guard sees binary arguments decoded", async (t) => {
    let seen = null;
    const link = await withRPC(t, { size: (bytes) => bytes.length }, (server) => {
        server.rpcGuard = (peer, path, args) => { seen = args[0]; return true; };
    });

    assert.equal(await link.clientPeer.rpc.size(Buffer.from([1, 2, 3])), 3);
    assert.ok(Buffer.isBuffer(seen) && seen.length === 3);
});

// ---- the caller's proxy --------------------------------------------------------

// The proxy wraps a function, and answered whatever that function had itself —
// so a remote method called "name", "length" or "call" could not be reached.
test("remote methods may be named like a function's own properties", async (t) => {
    const link = await withRPC(t, { name: () => "n", length: () => "l", call: () => "c", apply: () => "a", bind: () => "b" });

    assert.equal(await link.clientPeer.rpc.name(), "n");
    assert.equal(await link.clientPeer.rpc.length(), "l");
    assert.equal(await link.clientPeer.rpc.call(), "c");
    assert.equal(await link.clientPeer.rpc.apply(), "a");
    assert.equal(await link.clientPeer.rpc.bind(), "b");
});

test("awaiting or serializing the proxy makes no remote call", async (t) => {
    let calls = 0;
    const link = await withRPC(t, {}, (server) => {
        server.rpcGuard = () => { calls++; return true; };
    });

    const unhandled = [];
    const onUnhandled = (e) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    t.after(() => process.off("unhandledRejection", onUnhandled));

    await link.clientPeer.rpc;
    JSON.stringify({ peer: link.clientPeer.rpc });
    String(link.clientPeer.rpc[Symbol.toPrimitive]);
    await new Promise((r) => setTimeout(r, 100));

    assert.equal(calls, 0);
    assert.deepEqual(unhandled, []);
});
