/**
 * End-to-end encryption for protocol version 1.
 *
 * Written entirely against WebCrypto, which node and the browser both provide,
 * so there is one implementation rather than two that have to be kept in step.
 *
 * What it replaces: an unauthenticated secp521r1 exchange (4.5ms), then
 * AES-256-CBC with no integrity at all, keyed per packet by PBKDF2 at a single
 * iteration, and hex-encoded so every encrypted byte cost two on the wire.
 *
 * The exchange is symmetric. Both sides send the same kind of offer and either
 * may start; there is no initiator to elect and no reply-shaped second message,
 * so a caller never has to know which end it is. Everything both ends must
 * agree on is built in a canonical order, so each derives the same bytes
 * without knowing who dialled.
 */

const Frame = require("./Frame");

const subtle = () => {
    const webcrypto = globalThis.crypto;
    if (!webcrypto || !webcrypto.subtle) {
        throw new Error("WebCrypto is not available, so e2e cannot be negotiated");
    }
    return webcrypto.subtle;
};

// Canonical preference order. Used to break ties so both ends land on the same
// choice from the same two lists.
const KEX = ["x25519", "p256"];
const CIPHERS = ["aes-256-gcm"];

const KEX_PARAMS = {
    x25519: { name: "X25519" },
    p256: { name: "ECDH", namedCurve: "P-256" }
};

// Shared-secret width per curve. X25519 is 32 bytes; P-256 gives a 32-byte
// x-coordinate.
const KEX_BITS = { x25519: 256, p256: 256 };

const LABEL = "anysocket/1 e2e";
const KEY_BYTES = 32;
const BINDING_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

let kexSupport = null;

/** Which exchanges this runtime can actually do. Probed once. */
async function supportedKex() {
    if (kexSupport) return kexSupport;

    const found = [];
    for (const name of KEX) {
        try {
            await subtle().generateKey(KEX_PARAMS[name], true, ["deriveBits"]);
            found.push(name);
        } catch (e) {
            // Older engines have no X25519; P-256 has been there throughout.
        }
    }

    if (!found.length) throw new Error("no usable key exchange in this runtime");
    kexSupport = found;
    return kexSupport;
}

/** Reset the probe. Tests only. */
function _resetSupport() {
    kexSupport = null;
}

/**
 * Our half of the exchange: a public key per exchange we support, a random
 * nonce, and our preferences. Both ends send this same shape.
 */
async function createOffer(options = {}) {
    const available = options.kex || await supportedKex();
    const keys = {};
    const privates = {};

    for (const name of available) {
        const pair = await subtle().generateKey(KEX_PARAMS[name], true, ["deriveBits"]);
        privates[name] = pair.privateKey;
        keys[name] = Frame.toBase64(new Uint8Array(await subtle().exportKey("raw", pair.publicKey)));
    }

    const nonce = new Uint8Array(32);
    globalThis.crypto.getRandomValues(nonce);

    return {
        wire: {
            v: 1,
            kex: available,
            ciphers: options.ciphers || CIPHERS,
            keys: keys,
            nonce: Frame.toBase64(nonce)
        },
        privates: privates,
        nonce: nonce
    };
}

/**
 * Pick the exchange both ends can do, strongest first. A function of the two
 * lists only, so both compute the same answer and neither decides for the
 * other.
 */
function chooseKex(ours, theirs) {
    const mine = Array.isArray(ours) ? ours : [];
    const yours = Array.isArray(theirs) ? theirs : [];

    for (const name of KEX) {
        if (mine.indexOf(name) != -1 && yours.indexOf(name) != -1) return name;
    }
    return null;
}

/**
 * Pick the cipher. Each side lists its own preference order — a machine without
 * AES acceleration may rank differently — and the winner is the one with the
 * lowest combined rank, ties broken by the canonical order. Symmetric, so both
 * ends agree without either imposing its ranking.
 */
function chooseCipher(ours, theirs) {
    const mine = Array.isArray(ours) ? ours : [];
    const yours = Array.isArray(theirs) ? theirs : [];

    let best = null;
    let bestScore = Infinity;

    for (const name of CIPHERS) {
        const a = mine.indexOf(name);
        const b = yours.indexOf(name);
        if (a == -1 || b == -1) continue;

        const score = a + b;
        if (score < bestScore) {
            best = name;
            bestScore = score;
        }
    }
    return best;
}

const lengthPrefixed = (bytes) => {
    const view = Frame.asBytes(bytes);
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, view.length, false);
    return Frame.concat([length, view]);
};

/** Bytewise compare, for ordering the two parties. */
function compareBytes(a, b) {
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i++) {
        if (a[i] != b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return a.length - b.length;
}

/**
 * Derive the two directional keys and the channel binding.
 *
 * The transcript covers the label, the version and capabilities the connection
 * already negotiated, the chosen suite, and both parties' id, public key and
 * nonce. Binding the negotiated version in is what makes a downgrade
 * detectable: forcing a weaker connection changes the binding, so an
 * application comparing bindings notices.
 *
 * The two parties are ordered by their blobs, not by who dialled, so both ends
 * build the same transcript. Each side takes the key for its own position, so
 * the two directions have separate keys without anyone being "the client".
 */
async function derive(params) {
    const kex = params.kex;
    const cipher = params.cipher;

    const localBlob = Frame.concat([
        lengthPrefixed(Frame.bytes(params.localID || "")),
        lengthPrefixed(params.localPublicKey),
        lengthPrefixed(params.localNonce)
    ]);
    const remoteBlob = Frame.concat([
        lengthPrefixed(Frame.bytes(params.remoteID || "")),
        lengthPrefixed(params.remotePublicKey),
        lengthPrefixed(params.remoteNonce)
    ]);

    const localFirst = compareBytes(localBlob, remoteBlob) <= 0;
    const transcript = Frame.concat([
        lengthPrefixed(Frame.bytes(LABEL)),
        lengthPrefixed(Frame.bytes(String(params.protocolVersion))),
        lengthPrefixed(Frame.bytes((params.capabilities || []).join(","))),
        lengthPrefixed(Frame.bytes(kex)),
        lengthPrefixed(Frame.bytes(cipher)),
        localFirst ? localBlob : remoteBlob,
        localFirst ? remoteBlob : localBlob
    ]);

    const remoteKey = await subtle().importKey(
        "raw", params.remotePublicKey, KEX_PARAMS[kex], false, []
    );
    const shared = new Uint8Array(await subtle().deriveBits(
        kex == "x25519" ? { name: "X25519", public: remoteKey } : { name: "ECDH", public: remoteKey },
        params.localPrivateKey,
        KEX_BITS[kex]
    ));

    const salt = new Uint8Array(await subtle().digest("SHA-256", transcript));
    const hkdf = await subtle().importKey("raw", shared, "HKDF", false, ["deriveBits"]);
    const derived = new Uint8Array(await subtle().deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: salt, info: Frame.bytes(LABEL + " keys") },
        hkdf,
        (KEY_BYTES * 2 + BINDING_BYTES) * 8
    ));

    const first = derived.subarray(0, KEY_BYTES);
    const second = derived.subarray(KEY_BYTES, KEY_BYTES * 2);
    const binding = derived.subarray(KEY_BYTES * 2, KEY_BYTES * 2 + BINDING_BYTES);

    const importKey = (raw) => subtle().importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);

    return {
        kex: kex,
        cipher: cipher,
        // Whoever sorts first sends under the first key, so the two ends agree
        // which key is which without reference to direction.
        sendKey: await importKey(localFirst ? first : second),
        recvKey: await importKey(localFirst ? second : first),
        binding: binding
    };
}

/**
 * Nonce from the message counter. Each direction has its own key and its own
 * counter starting at zero, so a (key, nonce) pair is never reused. The counter
 * is not sent: it is implied by position in the stream, which also means a
 * replayed or reordered frame simply fails to authenticate.
 */
function nonceFor(counter) {
    const nonce = new Uint8Array(NONCE_BYTES);
    const view = new DataView(nonce.buffer);
    view.setUint32(4, Math.floor(counter / 0x100000000), false);
    view.setUint32(8, counter % 0x100000000, false);
    return nonce;
}

/** Encrypt, with the frame header authenticated alongside it. */
async function seal(key, counter, header, plaintext) {
    return new Uint8Array(await subtle().encrypt(
        { name: "AES-GCM", iv: nonceFor(counter), additionalData: header, tagLength: TAG_BYTES * 8 },
        key,
        plaintext
    ));
}

/** Decrypt. Throws if the frame was altered, replayed or arrived out of order. */
async function open(key, counter, header, ciphertext) {
    return new Uint8Array(await subtle().decrypt(
        { name: "AES-GCM", iv: nonceFor(counter), additionalData: header, tagLength: TAG_BYTES * 8 },
        key,
        ciphertext
    ));
}

module.exports = {
    KEX,
    CIPHERS,
    LABEL,
    NONCE_BYTES,
    TAG_BYTES,
    BINDING_BYTES,
    supportedKex,
    createOffer,
    chooseKex,
    chooseCipher,
    derive,
    nonceFor,
    seal,
    open,
    compareBytes,
    _resetSupport
};
