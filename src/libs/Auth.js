/**
 * Built-in mutual authentication from a shared secret.
 *
 * Without this, every application rolls its own on top of authPacket()/onAuth()
 * — and that pair makes it hard: authPacket() is called both for the dialer's
 * packet and for the listener's reply with no way to tell them apart, so a
 * challenge scheme has to infer direction and pair two calls by side effect.
 * That is easy to get subtly wrong, and it is the same work every time.
 *
 * What this gives instead is symmetric: both ends send a challenge, both prove
 * themselves, and neither needs to know which end it is. A proof covers both
 * challenges, both ids and the negotiated version, so it is good only for the
 * one exchange it was made in — a captured proof cannot be replayed, and
 * because each side's proof names itself, neither can be reflected back.
 *
 * WebCrypto throughout, so node and the browser share the implementation.
 */

const Frame = require("./Frame");

const subtle = () => {
    const webcrypto = globalThis.crypto;
    if (!webcrypto || !webcrypto.subtle) {
        throw new Error("WebCrypto is not available, so the built-in auth cannot be used");
    }
    return webcrypto.subtle;
};

const LABEL = "anysocket/1 auth";
const CHALLENGE_BYTES = 32;

/** A fresh challenge. */
function challenge() {
    const bytes = new Uint8Array(CHALLENGE_BYTES);
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
}

const lengthPrefixed = (bytes) => {
    const view = Frame.asBytes(bytes);
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, view.length, false);
    return Frame.concat([length, view]);
};

function compareBytes(a, b) {
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i++) {
        if (a[i] != b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return a.length - b.length;
}

/**
 * What both ends sign.
 *
 * The two parties go in by their bytes rather than by who dialled, so each end
 * builds the same transcript. `proofFor` names the party whose proof this is,
 * which is what keeps a proof from being reflected back at its author.
 */
function transcript(params) {
    const local = Frame.concat([
        lengthPrefixed(Frame.bytes(params.localID || "")),
        lengthPrefixed(params.localChallenge)
    ]);
    const remote = Frame.concat([
        lengthPrefixed(Frame.bytes(params.remoteID || "")),
        lengthPrefixed(params.remoteChallenge)
    ]);
    const localFirst = compareBytes(local, remote) <= 0;

    return Frame.concat([
        lengthPrefixed(Frame.bytes(LABEL)),
        lengthPrefixed(Frame.bytes(String(params.protocolVersion))),
        lengthPrefixed(Frame.bytes((params.capabilities || []).join(","))),
        localFirst ? local : remote,
        localFirst ? remote : local,
        lengthPrefixed(Frame.bytes(params.proofFor || ""))
    ]);
}

const key = (secret) => subtle().importKey(
    "raw",
    typeof secret == "string" ? Frame.bytes(secret) : Frame.asBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
);

/** Our proof, for the party named by `proofFor`. */
async function prove(secret, params) {
    const signed = await subtle().sign("HMAC", await key(secret), transcript(params));
    return Frame.toBase64(new Uint8Array(signed));
}

/**
 * Check a proof. Uses WebCrypto's verify rather than comparing the bytes
 * ourselves, so the comparison does not leak where a mismatch began.
 */
async function verify(secret, params, proof) {
    if (typeof proof != "string" || !proof) return false;

    let bytes;
    try {
        bytes = Frame.fromBase64(proof);
    } catch (e) {
        return false;
    }

    try {
        return await subtle().verify("HMAC", await key(secret), bytes, transcript(params));
    } catch (e) {
        return false;
    }
}

module.exports = {
    LABEL,
    CHALLENGE_BYTES,
    challenge,
    transcript,
    prove,
    verify,
    compareBytes
};
