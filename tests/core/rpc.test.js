const test = require("node:test");
const assert = require("node:assert");
const { pair } = require("../helpers/loopback");

const withRPC = (t, rpc) => pair(t, { configure: (server) => server.setRPC(rpc) });

test("an RPC returns its value", async (t) => {
    const link = await withRPC(t, { hello: { world: (name) => "Hello World, " + name } });

    assert.equal(await link.clientPeer.rpc.hello.world("LynxAegon"), "Hello World, LynxAegon");
    await link.stop();
});

test("an RPC receives the calling peer as its last argument", async (t) => {
    let sawPeer = null;
    const link = await withRPC(t, { who: (peer) => { sawPeer = peer && peer.id; return "ok"; } });

    await link.clientPeer.rpc.who();
    assert.equal(sawPeer, link.client.id);
    await link.stop();
});

test("a missing method rejects with 404", async (t) => {
    const link = await withRPC(t, {});

    await assert.rejects(link.clientPeer.rpc.nope.missing(), (e) => {
        assert.equal(e.code, 404);
        return true;
    });
    await link.stop();
});

// Regression: a thrown Error has no enumerable fields, so an async RPC that
// rejected serialized to {} and the caller got no message at all.
test("an async RPC that throws reports a readable message", async (t) => {
    const link = await withRPC(t, {
        boom: async () => { throw new Error("kaboom"); }
    });

    await assert.rejects(link.clientPeer.rpc.boom(), (e) => {
        assert.equal(e.error, "kaboom", "expected the thrown message, got " + JSON.stringify(e.error));
        assert.equal(e.code, 500);
        return true;
    });
    await link.stop();
});

test("a sync RPC that throws reports a readable message", async (t) => {
    const link = await withRPC(t, {
        boom: () => { throw new Error("sync kaboom"); }
    });

    await assert.rejects(link.clientPeer.rpc.boom(), (e) => {
        assert.equal(e.error, "sync kaboom");
        return true;
    });
    await link.stop();
});

test("an RPC that rejects with a string keeps the string", async (t) => {
    const link = await withRPC(t, {
        nope: async () => { throw "plain string failure"; }
    });

    await assert.rejects(link.clientPeer.rpc.nope(), (e) => {
        assert.equal(e.error, "plain string failure");
        return true;
    });
    await link.stop();
});

test("binary arguments and results round-trip", async (t) => {
    const link = await withRPC(t, {
        echo: (buf) => Buffer.concat([buf, Buffer.from([4, 5])])
    });

    const result = await link.clientPeer.rpc.echo(Buffer.from([1, 2, 3]));
    assert.deepEqual(Array.from(result), [1, 2, 3, 4, 5]);
    await link.stop();
});
