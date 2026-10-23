/**
 * End-to-end encryption for protocol version 1.
 *
 * The key exchange is WebCrypto, which node and the browser both provide. The
 * per-frame cipher is node's own crypto where there is one, and WebCrypto
 * otherwise: both are the same AES-256-GCM, so the two interoperate, but
 * WebCrypto completes every call through a thread-pool round trip — about
 * 22µs whatever the size, which is 7x the whole cost of sealing a 2kB frame
 * synchronously. A connection is set up once; its frames are sealed millions
 * of times. node's crypto also brings ChaCha20-Poly1305, which WebCrypto lacks.
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

// node's crypto, when present. In the browser build this require resolves to
// the browser shim, which has no createCipheriv, so the WebCrypto path is used.
const nodeCrypto = (() => {
    try {
        const c = require("crypto");
        return c && typeof c.createCipheriv === "function" ? c : null;
    } catch (e) {
        return null;
    }
})();

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
// Canonical cipher order, for breaking ties. AES-GCM first: it is the only
// AEAD WebCrypto has, and the faster of the two wherever the CPU accelerates
// AES. ChaCha20-Poly1305 is node-only, and wins on CPUs that do not.
const CIPHERS = ["aes-256-gcm", "chacha20-poly1305"];

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

let cipherPreference = null;

/**
 * The ciphers this runtime offers, fastest first.
 *
 * Measured rather than assumed: AES is quicker wherever the CPU accelerates it
 * and much slower in software, where ChaCha20 wins — the difference between,
 * say, an x86 server and an ARM board without crypto extensions. Each end
 * ranks by its own measurement and the negotiation picks the lowest combined
 * rank, so neither imposes its preference on the other. Measured once.
 */
function supportedCiphers() {
    if (cipherPreference) return cipherPreference;
    if (!nodeCrypto) return (cipherPreference = ["aes-256-gcm"]);

    const block = new Uint8Array(16 * 1024);
    const key = new Uint8Array(32);
    const iv = new Uint8Array(NONCE_BYTES);
    const run = (name, rounds) => {
        const started = process.hrtime.bigint();
        for (let i = 0; i < rounds; i++) {
            const c = nodeCrypto.createCipheriv(name, key, iv, { authTagLength: TAG_BYTES });
            c.update(block);
            c.final();
        }
        return Number(process.hrtime.bigint() - started);
    };

    // Ciphers this build of node actually has.
    const available = CIPHERS.filter((name) => {
        try {
            run(name, 1);
            return true;
        } catch (e) {
            return false;
        }
    });

    // Warm every cipher up before timing any of them — the first one timed
    // otherwise absorbs the warm-up and loses on that alone, which ranked
    // ChaCha20 ahead of AES on a machine that accelerates AES. Then interleave
    // and keep each one's best, so a stall during one round cannot decide it.
    for (const name of available) run(name, 32);
    const best = {};
    for (let round = 0; round < 3; round++) {
        for (const name of available) {
            const took = run(name, 96);
            best[name] = Math.min(best[name] == null ? Infinity : best[name], took);
        }
    }

    // A small gap is noise, not a preference; keep the canonical order for it so
    // the choice does not flip from one start to the next.
    const MARGIN = 1.15;
    cipherPreference = available.slice().sort((a, b) => {
        const ratio = best[a] / best[b];
        if (ratio > 1 / MARGIN && ratio < MARGIN) return CIPHERS.indexOf(a) - CIPHERS.indexOf(b);
        return best[a] - best[b];
    });
    if (!cipherPreference.length) cipherPreference = ["aes-256-gcm"];
    return cipherPreference;
}

/** Reset the probes. Tests only. */
function _resetSupport() {
    kexSupport = null;
    cipherPreference = null;
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
            ciphers: options.ciphers || supportedCiphers(),
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

    // With a pre-shared secret, it goes into the key material alongside the
    // exchange. The key exchange on its own is unauthenticated, so an on-path
    // party could stand in the middle of it — relaying the auth handshake
    // untouched, then answering each side's offer with keys of its own. It cannot
    // derive the keys either side ends up with if those depend on a secret it
    // does not have, so the substitution simply fails to produce a working
    // channel. Without a secret the exchange is still private against anyone
    // only listening, but not against someone in the path.
    let ikm = shared;
    if (params.psk) {
        const pskKey = await subtle().importKey(
            "raw",
            typeof params.psk == "string" ? Frame.bytes(params.psk) : Frame.asBytes(params.psk),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );
        const bound = new Uint8Array(await subtle().sign("HMAC", pskKey, Frame.bytes(LABEL + " psk")));
        ikm = Frame.concat([shared, bound]);
    }

    const salt = new Uint8Array(await subtle().digest("SHA-256", transcript));
    const hkdf = await subtle().importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    const derived = new Uint8Array(await subtle().deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: salt, info: Frame.bytes(LABEL + " keys") },
        hkdf,
        (KEY_BYTES * 2 + BINDING_BYTES) * 8
    ));

    const first = derived.subarray(0, KEY_BYTES);
    const second = derived.subarray(KEY_BYTES, KEY_BYTES * 2);
    const binding = derived.subarray(KEY_BYTES * 2, KEY_BYTES * 2 + BINDING_BYTES);

    // A handle per direction. node's crypto takes the raw key; WebCrypto needs
    // a CryptoKey, imported only where it is the path that will be used.
    const importKey = async (raw) => {
        const handle = { cipher: cipher, raw: raw.slice(), webKey: null };
        if (!nodeCrypto) {
            if (cipher !== "aes-256-gcm") throw new Error(cipher + " is not available in this runtime");
            handle.webKey = await subtle().importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
        }
        return handle;
    };

    return {
        kex: kex,
        cipher: cipher,
        // True when the keys depend on a pre-shared secret, so the channel is
        // authenticated and not merely private.
        authenticated: !!params.psk,
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

/**
 * Encrypt, with the frame header authenticated alongside it. Returns the
 * ciphertext followed by the tag — what WebCrypto produces too, so the two
 * paths are interchangeable on the wire.
 */
function seal(key, counter, header, plaintext) {
    if (key.webKey) {
        return subtle().encrypt(
            { name: "AES-GCM", iv: nonceFor(counter), additionalData: header, tagLength: TAG_BYTES * 8 },
            key.webKey,
            plaintext
        ).then((out) => new Uint8Array(out));
    }

    const out = new Uint8Array(plaintext.length + TAG_BYTES);
    sealInto(key, counter, header, plaintext, out, 0);
    return out;
}

/**
 * Seal straight into `out` at `at`: ciphertext then tag. This is what lets a
 * whole encrypted frame — header, ciphertext, tag — be a single allocation
 * instead of a ciphertext that then gets joined to its header. node only.
 */
function sealInto(key, counter, header, plaintext, out, at) {
    const c = nodeCrypto.createCipheriv(key.cipher, key.raw, nonceFor(counter), { authTagLength: TAG_BYTES });
    c.setAAD(header, { plaintextLength: plaintext.length });
    const body = c.update(plaintext);
    out.set(body, at);
    const rest = c.final();
    if (rest.length) out.set(rest, at + body.length);
    out.set(c.getAuthTag(), at + plaintext.length);
    return out;
}

/** Decrypt. Throws if the frame was altered, replayed or arrived out of order. */
function open(key, counter, header, ciphertext) {
    if (key.webKey) {
        return subtle().decrypt(
            { name: "AES-GCM", iv: nonceFor(counter), additionalData: header, tagLength: TAG_BYTES * 8 },
            key.webKey,
            ciphertext
        ).then((out) => new Uint8Array(out));
    }

    if (ciphertext.length < TAG_BYTES) throw new Error("ciphertext shorter than its tag");
    const bodyLength = ciphertext.length - TAG_BYTES;
    const d = nodeCrypto.createDecipheriv(key.cipher, key.raw, nonceFor(counter), { authTagLength: TAG_BYTES });
    d.setAuthTag(ciphertext.subarray(bodyLength));
    d.setAAD(header, { plaintextLength: bodyLength });
    const body = d.update(ciphertext.subarray(0, bodyLength));
    const rest = d.final(); // throws when the tag does not verify
    return rest.length ? Frame.concat([body, rest]) : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
}

/** Whether frames can be sealed in place, synchronously (node). */
const sealsInPlace = (key) => !key.webKey;

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
    sealInto,
    sealsInPlace,
    open,
    supportedCiphers,
    compareBytes,
    _resetSupport
};
