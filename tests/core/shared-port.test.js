const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const net = require("net");
const { stop, wait, AnySocket } = require("../helpers/loopback");

/**
 * tcp on a port the same instance already serves ws/http on: one port for
 * browsers and ws peers, and for tcp peers. A connection is told apart by its
 * first byte — 0 is a tcp frame's length, anything else is http (or TLS).
 */
async function shared(t, tcpOptions = {}) {
    const server = new AnySocket();
    t.after(() => stop(server));
    server.setRPC({ who: (peer) => peer.id });
    server.http.get("/hello", (peer) => { peer.status(200).body("hi").end(); });

    const port = await server.listen("ws", { port: 0 });
    const tcpPort = await server.listen("tcp", Object.assign({ port }, tcpOptions));
    return { server, port, tcpPort };
}

const httpGet = (port, path) => new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path }, (res) => {
        let body = "";
        res.on("data", (d) => body += d);
        res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
});

test("ws, tcp and http share one port", async (t) => {
    const { port, tcpPort } = await shared(t);
    assert.equal(tcpPort, port);

    const viaWs = new AnySocket();
    const viaTcp = new AnySocket();
    t.after(() => stop(viaWs, viaTcp));

    const ws = await viaWs.connect("ws", "127.0.0.1", port);
    const tcp = await viaTcp.connect("tcp", "127.0.0.1", port);
    assert.equal(await ws.rpc.who(), viaWs.id);
    assert.equal(await tcp.rpc.who(), viaTcp.id);
    assert.deepEqual(await httpGet(port, "/hello"), { status: 200, body: "hi" });
});

test("a large encrypted message crosses a shared port over tcp", async (t) => {
    const { server, port } = await shared(t);
    const client = new AnySocket();
    t.after(() => stop(client));

    const peer = await client.connect("tcp", "127.0.0.1", port);
    await peer.e2e();
    const payload = Buffer.alloc(9 * 1024 * 1024, 5);
    const received = new Promise((resolve) => server.on("message", (packet) => resolve(packet.msg)));
    await peer.send(payload);
    assert.ok(Buffer.from(await received).equals(payload));
});

test("a connection that never speaks is dropped", async (t) => {
    const { port } = await shared(t, { sniffTimeout: 150 });
    const socket = net.connect(port, "127.0.0.1");
    t.after(() => socket.destroy());
    socket.on("error", () => {});
    await new Promise((resolve) => socket.on("connect", resolve));

    const closed = new Promise((resolve) => socket.on("close", resolve));
    const result = await Promise.race([closed.then(() => "closed"), wait(2000).then(() => "still open")]);
    assert.equal(result, "closed");
});

test("stopping the instance stops every transport on the shared port", async (t) => {
    const { server, port } = await shared(t);
    await server.stop();
    await assert.rejects(httpGet(port, "/hello"));
});

test("tcp on its own port is unaffected", async (t) => {
    const server = new AnySocket();
    const client = new AnySocket();
    t.after(() => stop(server, client));
    server.setRPC({ who: (peer) => peer.id });

    const wsPort = await server.listen("ws", { port: 0 });
    const tcpPort = await server.listen("tcp", { port: 0 });
    assert.notEqual(tcpPort, wsPort);
    const peer = await client.connect("tcp", "127.0.0.1", tcpPort);
    assert.equal(await peer.rpc.who(), client.id);
});
