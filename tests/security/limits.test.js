const test = require("node:test");
const assert = require("node:assert");
const WebSocket = require("ws");
const AnyPacker = require("../../src/libs/AnyPacker");
const constants = require("../../src/libs/_constants");
const { pair, listen, stop, rawSocket, wait, AnySocket } = require("../helpers/loopback");

const partial = (seq, payload) =>
    String(constants.PACKET_LENGTH.PARTIAL) + String(constants.PACKET_TYPE.AUTH) +
    AnyPacker.packInt32(seq) + payload;

// Reassembly was unbounded, so a peer that never finished its packets could
// hold memory open — including before it had authenticated at all.
test("an unauthenticated peer cannot pile up partial packets", async (t) => {
    const server = new AnySocket();
    t.after(() => stop(server));

    const port = await listen(server);
    const attacker = new WebSocket("ws://127.0.0.1:" + port + "/");
    await new Promise((resolve) => attacker.on("open", resolve));
    const closed = new Promise((resolve) => attacker.on("close", resolve));

    // Several different seqs, none of them ever completed.
    for (let seq = 1; seq <= 8; seq++) {
        attacker.send(partial(seq, '{"id":"x"'));
    }

    await closed;
    assert.ok(true, "the connection was dropped instead of buffering");
});

test("an unauthenticated peer cannot send an oversized handshake", async (t) => {
    const server = new AnySocket();
    t.after(() => stop(server));

    const port = await listen(server);
    const attacker = new WebSocket("ws://127.0.0.1:" + port + "/");
    await new Promise((resolve) => attacker.on("open", resolve));
    const closed = new Promise((resolve) => attacker.on("close", resolve));

    // One seq, but far more than a handshake could ever need.
    attacker.send(partial(1, "x".repeat(70 * 1024)));

    await closed;
    assert.ok(true, "the connection was dropped instead of buffering");
});

test("the handshake limit does not apply to live traffic", async (t) => {
    // Comfortably past maxHandshakeMessageSize, on an authenticated connection.
    const link = await pair(t);
    const big = "z".repeat(256 * 1024);

    const received = new Promise((resolve) => link.server.on("message", (packet) => resolve(packet.msg)));
    await link.clientPeer.send({ big });

    assert.equal((await received).big.length, big.length);
    assert.ok(link.client.hasPeer(link.server.id));
});

test("a live peer exceeding maxMessageSize is dropped", async (t) => {
    const link = await pair(t, { connect: { maxMessageSize: 4096 }, listen: { maxMessageSize: 4096 } });
    const gone = new Promise((resolve) => link.server.on("disconnected", (_peer, reason) => resolve(reason)));

    const socket = rawSocket(link.clientPeer);
    for (let i = 0; i < 4; i++) {
        socket.send(
            String(constants.PACKET_LENGTH.PARTIAL) + String(constants.PACKET_TYPE.LINK) +
            AnyPacker.packInt32(77) + "y".repeat(2048)
        );
    }

    assert.match(String(await gone), /too large/i);
});

test("maxPartialPackets bounds concurrent reassembly on a live peer", async (t) => {
    const link = await pair(t, { connect: { maxPartialPackets: 4 }, listen: { maxPartialPackets: 4 } });
    const gone = new Promise((resolve) => link.server.on("disconnected", (_peer, reason) => resolve(reason)));

    const socket = rawSocket(link.clientPeer);
    for (let seq = 10; seq < 20; seq++) {
        socket.send(
            String(constants.PACKET_LENGTH.PARTIAL) + String(constants.PACKET_TYPE.LINK) +
            AnyPacker.packInt32(seq) + "partial"
        );
    }

    assert.match(String(await gone), /too many partial packets/i);
});
