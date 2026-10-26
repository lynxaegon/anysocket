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
    ABORTED: "EABORTED",
    // Refused by policy, e.g. a relayed link the relay or the far end will not carry.
    REFUSED: "EREFUSED",
    // A connection that closed before it was established; `reason` says why.
    CONNECTION_FAILED: "ECONNFAILED",
    // An RPC the peer has no method for.
    RPC_NOT_FOUND: "ENOMETHOD",
    // An RPC the peer's rpcGuard refused.
    RPC_FORBIDDEN: "EFORBIDDEN",
    // An RPC whose method threw on the peer.
    RPC_FAILED: "ERPC"
};

const errors = {
    notConnected: () => new AnySocketError(CODES.NOT_CONNECTED, "Cannot send message. Peer is disconnected"),
    timeout: (detail) => new AnySocketError(CODES.TIMEOUT, "Timeout!", detail),
    disconnected: () => new AnySocketError(CODES.DISCONNECTED, "Peer disconnected!"),
    superseded: () => new AnySocketError(CODES.SUPERSEDED, "Superseded by the agreed connection"),
    aborted: (reason) => new AnySocketError(CODES.ABORTED, "Aborted", { reason: reason }),
    refused: (message) => new AnySocketError(CODES.REFUSED, message),
    connectionFailed: (reason) => new AnySocketError(CODES.CONNECTION_FAILED,
        "Connection failed: " + reasonText(reason), { reason: reasonText(reason) })
};

/** A disconnect reason as the text it is documented to be. */
function reasonText(reason) {
    if (reason instanceof Error) return reason.message;
    return reason == null ? "" : String(reason);
}

/**
 * An RPC failure as the peer reported it: { error, details, code } on the wire, with
 * an HTTP-style code. Raised as an
 * AnySocketError, keeping `error` and `details`, with the wire code as `status`.
 */
function rpcError(msg) {
    const code = msg.code == 404 ? CODES.RPC_NOT_FOUND
        : msg.code == 403 ? CODES.RPC_FORBIDDEN
        : CODES.RPC_FAILED;
    return new AnySocketError(code, String(msg.error), {
        error: msg.error,
        details: msg.details,
        status: msg.code
    });
}

module.exports = { AnySocketError, CODES, errors, reasonText, rpcError };
