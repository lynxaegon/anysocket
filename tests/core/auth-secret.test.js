const test = require("node:test");
const assert = require("node:assert");
const Auth = require("../../src/libs/Auth");
const Frame = require("../../src/libs/Frame");
const { e2e, pair, expectRefused, wait } = require("../helpers/loopback");

const SECRET = "a shared secret neither end sends";

const withSecret = (secret) => ({
    configure: (server, client) => {
        server.options.auth = { secret: secret };
        client.options.auth = { secret: secret };
    }
});

test("two peers holding the same secret connect", async (t) => {
    const link = await pair(t, withSecret(SECRET));

    assert.equal(link.clientPeer.id, link.server.id);
    assert.equal(link.serverPeer.id, link.client.id);

    const received = new Promise((resolve) => link.server.once("message", (p) => resolve(p.msg)));
    await link.clientPeer.send({ hello: "world" });
    assert.deepEqual(await received, { hello: "world" });
});

test("a dialer with the wrong secret is refused", async (t) => {
    const reason = await expectRefused(t, {
        configure: (server, client) => {
            server.options.auth = { secret: SECRET };
            client.options.auth = { secret: "not the secret" };
        }
    });

    assert.ok(reason, "a dialer that cannot prove the secret must be refused");
});

// Both ends prove themselves, so a listener that does not hold the secret is
// refused by the dialer just as surely as the other way round.
test("a listener with the wrong secret is refused", async (t) => {
    const reason = await expectRefused(t, {
        configure: (server, client) => {
            server.options.auth = { secret: "not the secret" };
            client.options.auth = { secret: SECRET };
        }
    });

    assert.ok(reason, "a listener that cannot prove the secret must be refused");
});

// Requiring the built-in auth would be pointless if a peer could decline it.
test("a peer that does not offer the built-in auth is refused", async (t) => {
    const reason = await expectRefused(t, {
        configure: (server) => {
            server.options.auth = { secret: SECRET };
        }
    });

    assert.ok(reason, "a peer offering no challenge must be refused");
});

test("a dialer requiring the auth refuses a listener without it", async (t) => {
    const reason = await expectRefused(t, {
        configure: (server, client) => {
            client.options.auth = { secret: SECRET };
        }
    });

    assert.ok(reason, "the dialer must refuse a listener that offers no challenge");
});

test("it works the same whichever end dialled", async (t) => {
    const link = await pair(t, withSecret(SECRET));

    for (const dir of [
        { from: link.clientPeer, at: link.server, name: "client -> server" },
        { from: link.serverPeer, at: link.client, name: "server -> client" }
    ]) {
        const received = new Promise((resolve) => dir.at.once("message", (p) => resolve(p.msg)));
        await dir.from.send({ via: dir.name });
        assert.deepEqual(await received, { via: dir.name }, dir.name);
    }
});

test("the built-in auth composes with e2e and a channel binding", async (t) => {
    const link = await pair(t, withSecret(SECRET));
    await e2e(link);
    await wait(50);

    assert.ok(link.clientPeer.isE2EEnabled());
    assert.equal(
        Buffer.from(link.clientPeer.getChannelBinding()).toString("hex"),
        Buffer.from(link.serverPeer.getChannelBinding()).toString("hex")
    );
});

test("a custom onAuth still runs alongside the built-in auth", async (t) => {
    let sawCustom = false;
    const link = await pair(t, {
        configure: (server, client) => {
            server.options.auth = { secret: SECRET };
            client.options.auth = { secret: SECRET };
            server.authPacket = () => "extra";
            client.authPacket = () => "extra";
            server.onAuth = (packet) => { sawCustom = true; return packet.auth === "extra"; };
        }
    });

    assert.ok(link.clientPeer.id);
    assert.ok(sawCustom, "the custom hook should still be consulted");
});

test("a custom onAuth can still refuse a peer that proved the secret", async (t) => {
    const reason = await expectRefused(t, {
        configure: (server, client) => {
            server.options.auth = { secret: SECRET };
            client.options.auth = { secret: SECRET };
            server.onAuth = () => false;
        }
    });

    assert.ok(reason, "the custom hook must still be able to refuse");
});

// ---- the primitive on its own ---------------------------------------------

const params = (overrides = {}) => Object.assign({
    protocolVersion: 1,
    capabilities: [],
    localID: "alice",
    localChallenge: Frame.bytes("challenge-from-alice-0000000000000"),
    remoteID: "bob",
    remoteChallenge: Frame.bytes("challenge-from-bob-00000000000000"),
    proofFor: "alice"
}, overrides);

test("a proof verifies against the same transcript", async (t) => {
    const proof = await Auth.prove(SECRET, params());
    assert.equal(await Auth.verify(SECRET, params(), proof), true);
});

test("a proof fails under a different secret", async (t) => {
    const proof = await Auth.prove(SECRET, params());
    assert.equal(await Auth.verify("another secret", params(), proof), false);
});

// Each side's proof names itself, so one cannot be sent back at its author.
test("a proof cannot be reflected at its author", async (t) => {
    const fromAlice = await Auth.prove(SECRET, params({ proofFor: "alice" }));

    assert.equal(await Auth.verify(SECRET, params({ proofFor: "bob" }), fromAlice), false,
        "alice's proof must not pass as bob's");
});

// A proof covers both challenges, so one captured from an earlier exchange is
// worthless in a later one.
test("a proof from another exchange does not verify", async (t) => {
    const proof = await Auth.prove(SECRET, params());

    const freshChallenge = Auth.challenge();
    assert.equal(
        await Auth.verify(SECRET, params({ remoteChallenge: freshChallenge }), proof),
        false,
        "a replayed proof must not verify against a new challenge"
    );
});

test("both ends build the same transcript from opposite points of view", async (t) => {
    const alice = params({ proofFor: "alice" });
    const bob = params({
        localID: "bob",
        localChallenge: alice.remoteChallenge,
        remoteID: "alice",
        remoteChallenge: alice.localChallenge,
        proofFor: "alice"
    });

    const fromAlice = Buffer.from(Auth.transcript(alice)).toString("hex");
    const fromBob = Buffer.from(Auth.transcript(bob)).toString("hex");
    assert.equal(fromAlice, fromBob, "the transcript must not depend on which end builds it");
});

test("a changed version changes the transcript", async (t) => {
    const proof = await Auth.prove(SECRET, params({ protocolVersion: 1 }));
    assert.equal(await Auth.verify(SECRET, params({ protocolVersion: 0 }), proof), false);
});

test("a malformed proof is refused rather than throwing", async (t) => {
    for (const bad of [undefined, null, "", 42, {}, "not base64 @@@"]) {
        assert.equal(await Auth.verify(SECRET, params(), bad), false, String(bad));
    }
});

test("every challenge is different", async (t) => {
    const seen = new Set();
    for (let i = 0; i < 50; i++) {
        const value = Buffer.from(Auth.challenge()).toString("hex");
        assert.equal(value.length / 2, Auth.CHALLENGE_BYTES);
        assert.ok(!seen.has(value), "a challenge repeated");
        seen.add(value);
    }
});
