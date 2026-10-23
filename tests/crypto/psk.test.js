const test = require("node:test");
const assert = require("node:assert");
const E2E = require("../../src/libs/E2E");
const Frame = require("../../src/libs/Frame");
const { pair, wait } = require("../helpers/loopback");

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const SECRET = "the secret both honest ends hold";

/**
 * The property that matters. The key exchange on its own is unauthenticated, so
 * someone on the path can relay the auth handshake untouched and then answer
 * each side's e2e offer with a key of its own. If the keys depend only on the
 * exchange, that party can derive exactly what an honest end derives and read
 * everything. With the secret in the key material it cannot.
 *
 * Tested directly: an attacker holding the honest end's real offer, and its own
 * substituted key pair, tries to derive the honest end's keys.
 */
async function interception(psk) {
    const client = await E2E.createOffer({ kex: ["x25519"] });
    const server = await E2E.createOffer({ kex: ["x25519"] });
    const attacker = await E2E.createOffer({ kex: ["x25519"] });

    const common = { kex: "x25519", cipher: "aes-256-gcm", protocolVersion: 1, capabilities: [] };

    // The client believes it is talking to the server, but the key it received
    // was the attacker's.
    const honest = await E2E.derive(Object.assign({}, common, {
        localID: "client", remoteID: "server",
        localPrivateKey: client.privates.x25519,
        localPublicKey: Frame.fromBase64(client.wire.keys.x25519),
        localNonce: client.nonce,
        remotePublicKey: Frame.fromBase64(attacker.wire.keys.x25519),
        remoteNonce: server.nonce,
        psk: psk
    }));

    // The attacker poses as the server toward the client. It has everything the
    // wire showed it, and its own private key — but not the secret.
    const forged = await E2E.derive(Object.assign({}, common, {
        localID: "server", remoteID: "client",
        localPrivateKey: attacker.privates.x25519,
        localPublicKey: Frame.fromBase64(attacker.wire.keys.x25519),
        localNonce: server.nonce,
        remotePublicKey: Frame.fromBase64(client.wire.keys.x25519),
        remoteNonce: client.nonce,
        psk: null
    }));

    const header = new Uint8Array([1, 3, 0, 0, 0, 1]);
    const sealed = await E2E.seal(honest.sendKey, 0, header, Frame.bytes("what the client meant to keep private"));

    try {
        return Frame.text(await E2E.open(forged.recvKey, 0, header, sealed));
    } catch (e) {
        return null;
    }
}

test("without a secret, a party in the path can read what it relays", async (t) => {
    // Not a property we want — the baseline that shows the test can tell.
    assert.equal(await interception(null), "what the client meant to keep private",
        "if this fails, the interception test is not exercising anything");
});

test("with a secret, a party in the path cannot derive the keys", async (t) => {
    assert.equal(await interception(SECRET), null,
        "an attacker without the secret must not be able to open the frames");
});

test("two ends holding the same secret still derive the same channel", async (t) => {
    const a = await E2E.createOffer({ kex: ["x25519"] });
    const b = await E2E.createOffer({ kex: ["x25519"] });
    const common = { kex: "x25519", cipher: "aes-256-gcm", protocolVersion: 1, capabilities: [], psk: SECRET };

    const left = await E2E.derive(Object.assign({}, common, {
        localID: "a", remoteID: "b",
        localPrivateKey: a.privates.x25519, localPublicKey: Frame.fromBase64(a.wire.keys.x25519), localNonce: a.nonce,
        remotePublicKey: Frame.fromBase64(b.wire.keys.x25519), remoteNonce: b.nonce
    }));
    const right = await E2E.derive(Object.assign({}, common, {
        localID: "b", remoteID: "a",
        localPrivateKey: b.privates.x25519, localPublicKey: Frame.fromBase64(b.wire.keys.x25519), localNonce: b.nonce,
        remotePublicKey: Frame.fromBase64(a.wire.keys.x25519), remoteNonce: a.nonce
    }));

    assert.equal(hex(left.binding), hex(right.binding));
    assert.ok(left.authenticated && right.authenticated);

    const header = new Uint8Array([1, 3, 0, 0, 0, 2]);
    const sealed = await E2E.seal(left.sendKey, 0, header, Frame.bytes("ok"));
    assert.equal(Frame.text(await E2E.open(right.recvKey, 0, header, sealed)), "ok");
});

test("ends holding different secrets cannot talk", async (t) => {
    const a = await E2E.createOffer({ kex: ["x25519"] });
    const b = await E2E.createOffer({ kex: ["x25519"] });
    const common = { kex: "x25519", cipher: "aes-256-gcm", protocolVersion: 1, capabilities: [] };

    const left = await E2E.derive(Object.assign({}, common, {
        psk: "one secret", localID: "a", remoteID: "b",
        localPrivateKey: a.privates.x25519, localPublicKey: Frame.fromBase64(a.wire.keys.x25519), localNonce: a.nonce,
        remotePublicKey: Frame.fromBase64(b.wire.keys.x25519), remoteNonce: b.nonce
    }));
    const right = await E2E.derive(Object.assign({}, common, {
        psk: "another secret", localID: "b", remoteID: "a",
        localPrivateKey: b.privates.x25519, localPublicKey: Frame.fromBase64(b.wire.keys.x25519), localNonce: b.nonce,
        remotePublicKey: Frame.fromBase64(a.wire.keys.x25519), remoteNonce: a.nonce
    }));

    const header = new Uint8Array([1, 3, 0, 0, 0, 3]);
    const sealed = await E2E.seal(left.sendKey, 0, header, Frame.bytes("x"));
    await assert.rejects(E2E.open(right.recvKey, 0, header, sealed));
});

test("a connection using the built-in auth is reported as an authenticated channel", async (t) => {
    const link = await pair(t, {
        configure: (server, client) => {
            server.options.auth = { secret: SECRET };
            client.options.auth = { secret: SECRET };
        }
    });
    await link.clientPeer.e2e();
    await wait(50);

    assert.equal(link.clientPeer.e2eInfo().authenticated, true);
    assert.equal(link.serverPeer.e2eInfo().authenticated, true);

    const received = new Promise((resolve) => link.server.once("message", (p) => resolve(p.msg)));
    await link.clientPeer.send({ fine: true });
    assert.deepEqual(await received, { fine: true });
});

test("without the built-in auth the channel is private but not authenticated", async (t) => {
    const link = await pair(t);
    await link.clientPeer.e2e();

    assert.equal(link.clientPeer.e2eInfo().authenticated, false);
});
