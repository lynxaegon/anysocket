// tcp and ipc need sockets a browser does not have; ws is the transport there.
// Kept as real classes so asking for one fails with a reason rather than a
// TypeError from deep inside the transport lookup.
class Unavailable {
    constructor() {
        throw new Error(this.constructor.scheme() + " is not available in the browser — use ws");
    }
}

class TCP extends Unavailable {
    static scheme() {
        return "tcp";
    }
}

class IPC extends Unavailable {
    static scheme() {
        return "ipc";
    }
}

module.exports = { TCP, IPC };
