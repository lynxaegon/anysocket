const test = require("node:test");
const assert = require("node:assert");
const { pair, expectRefused } = require("../helpers/loopback");

test("a synchronous onAuth still gates the handshake", async (t) => {
    const link = await pair(t, {
        configure: (server, client) => {
            server.authPacket = () => "server-secret";
            client.authPacket = () => "client-secret";
            server.onAuth = (packet) => packet.auth === "client-secret";
            client.onAuth = (packet) => packet.auth === "server-secret";
        }
    });

    assert.ok(link.serverPeer.id);
    assert.equal(link.clientPeer.id, link.server.id);
    await link.stop();
});

test("a rejecting sync onAuth refuses the peer", async (t) => {
    const reason = await expectRefused(t, {
        configure: (server) => {
            server.onAuth = () => false;
        }
    });

    assert.ok(reason, "the dial should have been refused");
});

// Regression: onAuth used to be called without being awaited, so an async
// implementation returned a Promise — always truthy — and every peer passed.
test("a rejecting ASYNC onAuth refuses the peer", async (t) => {
    const reason = await expectRefused(t, {
        configure: (server) => {
            server.onAuth = async () => false;
        }
    });

    assert.ok(reason, "an async onAuth returning false must refuse the dial");
});

test("an async onAuth that resolves true is accepted", async (t) => {
    const link = await pair(t, {
        configure: (server, client) => {
            server.authPacket = () => "token";
            server.onAuth = async (packet) => {
                await new Promise((r) => setTimeout(r, 10));
                return packet.auth === "token" || packet.auth === undefined;
            };
            client.authPacket = () => "token";
        }
    });

    assert.ok(link.clientPeer.id);
    await link.stop();
});

test("an onAuth that throws refuses the peer instead of crashing", async (t) => {
    const reason = await expectRefused(t, {
        configure: (server) => {
            server.onAuth = () => {
                throw new Error("auth backend down");
            };
        }
    });

    assert.ok(reason, "a throwing onAuth must refuse the dial");
});

test("an async onAuth that rejects refuses the peer", async (t) => {
    const reason = await expectRefused(t, {
        configure: (server) => {
            server.onAuth = async () => {
                throw new Error("auth backend down");
            };
        }
    });

    assert.ok(reason, "a rejecting async onAuth must refuse the dial");
});

test("a peer with no id is refused", async (t) => {
    const reason = await expectRefused(t, {
        configure: (server, client) => {
            client.id = "";
        }
    });

    assert.ok(reason, "an AUTH packet without an id must be refused");
});
