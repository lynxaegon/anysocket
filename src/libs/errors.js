/**
 * Errors the library raises itself, each with a stable `code`.
 *
 * They used to be bare strings, so a caller could only tell them apart by
 * matching text. The messages are unchanged — anything matching on them keeps
 * working — and `code` is the thing to test from now on.
 */
class AnySocketError extends Error {
    constructor(code, message, extra) {
        super(message);
        this.name = "AnySocketError";
        this.code = code;
        if (extra) Object.assign(this, extra);
    }
}

const CODES = {
    // send() or a call on a peer that has already gone.
    NOT_CONNECTED: "ENOTCONNECTED",
    // A call that was never answered in time.
    TIMEOUT: "ETIMEOUT",
    // The peer went away while a call was waiting.
    DISCONNECTED: "EDISCONNECTED",
    // The connection was retired in favour of another one to the same peer.
    SUPERSEDED: "ESUPERSEDED",
    // The caller gave up on a call through its AbortSignal.
    ABORTED: "EABORTED"
};

const errors = {
    notConnected: () => new AnySocketError(CODES.NOT_CONNECTED, "Cannot send message. Peer is disconnected"),
    timeout: (detail) => new AnySocketError(CODES.TIMEOUT, "Timeout!", detail),
    disconnected: () => new AnySocketError(CODES.DISCONNECTED, "Peer disconnected!"),
    superseded: () => new AnySocketError(CODES.SUPERSEDED, "Superseded by the agreed connection"),
    aborted: (reason) => new AnySocketError(CODES.ABORTED, "Aborted", { reason: reason })
};

module.exports = { AnySocketError, CODES, errors };
