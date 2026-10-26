const test = require("node:test");
const assert = require("node:assert");
const net = require("net");
const { stop, wait, AnySocket } = require("../helpers/loopback");

/**
 * A socket error on an established connection — a reset or a broken pipe, the other end
 * dying mid-connection — ends that connection, never the process. The transport peer
 * re-emitted it as "error" with nothing listening, and node threw that as an uncaught
 * exception: one peer's crash took down whoever it was talking to.
 */
function noUncaught(t) {
    const caught = [];
    const onUncaught = (e) => caught.push(e);
    // node:test reports uncaught exceptions as failures of their own; listening keeps the
    // process alive long enough to assert on them.
    process.on("uncaughtException", onUncaught);
    t.after(() => process.off("uncaughtException", onUncaught));
    return caught;
}

test("a tcp peer resetting its connection does not crash the other end", async (t) => {
    const caught = noUncaught(t);
    const server = new AnySocket();
    t.after(() => stop(server));
    const port = await server.listen("tcp", { port: 0 });

    for (let i = 0; i < 5; i++) {
        const socket = net.connect(port, "127.0.0.1");
        socket.on("error", () => {});
        await new Promise((resolve) => socket.on("connect", resolve));
        await wait(20);
        socket.resetAndDestroy();   // RST: the server side sees ECONNRESET
    }
    await wait(200);
    assert.deepEqual(caught.map(String), []);

    // ...and still serves.
    const client = new AnySocket();
    t.after(() => stop(client));
    server.setRPC({ ping: () => "pong" });
    const peer = await client.connect("tcp", "127.0.0.1", port);
    assert.equal(await peer.rpc.ping(), "pong");
});

test("a connected peer whose socket resets is announced as disconnected", async (t) => {
    const caught = noUncaught(t);
    const server = new AnySocket();
    const client = new AnySocket();
    t.after(() => stop(server, client));
    const port = await server.listen("tcp", { port: 0 });

    const serverSide = new Promise((resolve) => server.on("connected", resolve));
    await client.connect("tcp", "127.0.0.1", port);
    await serverSide;

    const gone = new Promise((resolve) => server.on("disconnected", (peer, reason) => resolve(reason)));
    // Reset every client-side socket from under the instance.
    for (const handle of process._getActiveHandles()) {
        if (handle instanceof net.Socket && handle.remotePort === port) handle.resetAndDestroy();
    }
    const reason = await Promise.race([gone, wait(3000).then(() => "never")]);
    assert.notEqual(reason, "never");
    assert.deepEqual(caught.map(String), []);
});
