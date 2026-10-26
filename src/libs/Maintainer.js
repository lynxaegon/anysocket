const debug = require('debug')('Maintainer');
const EventEmitter = require("../wrappers/events-wrapper");

/**
 * Keeps one peer connected: dials it, and when the link drops, dials it again
 * with backoff.
 *
 * Every long-lived application ends up writing this — a retry timer, an address
 * that has already been dialled, a backoff that does not reset forever — and it
 * is easy to get subtly wrong. A few things this does that a hand-rolled loop
 * usually does not:
 *
 * - It remembers which peer the target turned out to be, so a connection to that
 *   peer from either direction satisfies it. A peer that dialled *us* is not
 *   dialled back, and an address given as a hostname is not re-dialled merely
 *   because the connection we hold came in from its IP.
 * - When two peers keep each other connected, they dial each other and the
 *   duplicate rule retires one of the two connections. The handle adopts the one
 *   that survives rather than reading the retirement as a drop and dialling
 *   again, which would loop.
 * - Backoff resets only once a connection has stayed up for a while. A link
 *   that dies the moment it connects keeps backing off instead of being redialled
 *   at full speed forever.
 *
 *   const link = anysocket.maintain("tcp", "10.0.0.2", 3000, options, policy);
 *   link.on("connected", (peer) => ...);
 *   link.on("disconnected", (peer, reason) => ...);
 *   link.on("retry", ({ attempt, delay, error }) => ...);
 *   link.on("abandoned", (error) => ...);
 *   link.stop();
 */
const DEFAULT_CONNECT_TIMEOUT = 10 * 1000;

class Maintainer extends EventEmitter {
    constructor(anysocket, target, policy) {
        super();

        this.anysocket = anysocket;
        this.target = target;
        this.policy = Object.assign({
            // First retry after this long; each failure multiplies it by factor.
            minDelay: 500,
            maxDelay: 30 * 1000,
            factor: 2,
            // +/- this fraction of each delay, so a fleet that lost a peer at the
            // same moment does not all redial it at the same moment.
            jitter: 0.2,
            // Stop trying after this long without a connection. Infinity: never.
            giveUpAfter: Infinity,
            // A connection that lasts this long counts as healthy and resets the
            // backoff; one that drops sooner does not.
            stableAfter: 10 * 1000
        }, policy);

        this.peer = null;
        this.peerID = null;
        this.attempt = 0;
        this.active = true;

        this._timer = null;
        this._stable = null;
        this._failingSince = null;
        this._dialing = false;

        this._onConnected = (peer) => {
            if (!this.active || !this.peerID || peer.id !== this.peerID || peer === this.peer) return;
            // That peer is connected — inbound, or the connection the duplicate
            // rule kept. Either way the target is satisfied.
            this._adopt(peer);
        };
        this._onDisconnected = (peer, reason) => {
            if (!this.active || peer !== this.peer) return;
            this._lost(peer, reason);
        };

        anysocket.on("connected", this._onConnected);
        anysocket.on("disconnected", this._onDisconnected);

        this._dial();
    }

    /**
     * The application decided this connection is no good — a handshake of its
     * own failed, say. Drop it and back off, instead of it being redialled and
     * failing again at once.
     */
    fail(reason) {
        if (!this.active) return;
        this._clearStable();
        if (this.peer) {
            const peer = this.peer;
            peer.disconnect(reason || "Rejected by the application");
        } else {
            this._schedule(reason);
        }
    }

    /** Stop keeping the peer connected. The current connection is left alone. */
    stop() {
        if (!this.active) return;
        this.active = false;
        clearTimeout(this._timer);
        this._clearStable();
        this.anysocket.removeListener("connected", this._onConnected);
        this.anysocket.removeListener("disconnected", this._onDisconnected);
        this.anysocket._forgetMaintainer(this);
    }

    _dial() {
        this._timer = null;
        if (!this.active || this._dialing) return;

        // Already connected to it from the other direction: nothing to dial.
        if (this.peerID && this.anysocket.hasPeer(this.peerID)) {
            this._adopt(this.anysocket.getPeer(this.peerID));
            return;
        }

        this._dialing = true;
        const t = this.target;
        // A dial that never answers (a ws upgrade nobody replies to) must fail, or the
        // handle waits on it forever instead of retrying: give it a timeout unless one is set.
        this.anysocket.connect(t.scheme, t.ip, t.port, Object.assign({ connectTimeout: DEFAULT_CONNECT_TIMEOUT }, t.options))
            .then((peer) => {
                this._dialing = false;
                if (!this.active) return;
                this._adopt(peer);
            })
            .catch((error) => {
                this._dialing = false;
                if (!this.active) return;
                // The dial lost a race to the same peer dialling us; that
                // connection is the one to keep.
                if (this.peerID && this.anysocket.hasPeer(this.peerID)) {
                    this._adopt(this.anysocket.getPeer(this.peerID));
                    return;
                }
                this._schedule(error);
            });
    }

    _adopt(peer) {
        // Only a peer that is actually connected right now: anything else is a
        // connection that has already gone.
        if (!peer || this.anysocket.getPeer(peer.id) !== peer) return;
        clearTimeout(this._timer);
        this._timer = null;

        this.peer = peer;
        this.peerID = peer.id;
        this._failingSince = null;

        this._clearStable();
        this._stable = setTimeout(() => {
            this._stable = null;
            this.attempt = 0;
        }, this.policy.stableAfter);

        debug("connected to", peer.id);
        this.emit("connected", peer);
    }

    _lost(peer, reason) {
        this.peer = null;
        this._clearStable();
        this.emit("disconnected", peer, reason);
        this._schedule(reason);
    }

    _schedule(error) {
        if (!this.active || this._timer) return;

        if (this._failingSince == null) this._failingSince = Date.now();
        if (Date.now() - this._failingSince >= this.policy.giveUpAfter) {
            this.emit("abandoned", error);
            this.stop();
            return;
        }

        const p = this.policy;
        const base = Math.min(p.maxDelay, p.minDelay * Math.pow(p.factor, this.attempt));
        const spread = base * p.jitter;
        const delay = Math.max(0, Math.round(base - spread + Math.random() * spread * 2));
        this.attempt++;

        this.emit("retry", { attempt: this.attempt, delay: delay, error: error });
        this._timer = setTimeout(() => this._dial(), delay);
    }

    _clearStable() {
        clearTimeout(this._stable);
        this._stable = null;
    }
}

module.exports = Maintainer;
