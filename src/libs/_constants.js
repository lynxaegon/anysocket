const constants = {
    PACKET_TYPE: {
        AUTH: 1,
        INTERNAL: 2,
        LINK: 3,
        SWITCH: 4,
        HEARTBEAT: 5,
        FORWARD: 6
    },
    PACKET_LENGTH: {
        FULL: 1,
        PARTIAL: 2
    },
    INTERNAL_PACKET_TYPE: {
        NETWORK: 1,
        PROXY: 2,
        RPC: 3,
        RPC_NOTIFY: 4,
        SYNCED_TIME: 5
    },
    PROTOCOL_STATES: {
        ESTABLISHED: 0,
        AUTHING: 1,
        CONNECTED: 2,
        SWITCHING_PROTOCOL: 3,
        DISCONNECTED: 4
    },
    PROTOCOL_ENCRYPTION: {
        PLAIN: 1,
        E2EE: 2
    },
    // The frame format and handshake this build speaks. Both sides announce it
    // in their AUTH packet and the lower of the two wins, so a 1.0 peer and a
    // 0.4.x peer still talk: 0.4.x never sends the field, reads as 0, and the
    // connection stays on the legacy text format. Needed for a rolling upgrade,
    // where old and new nodes share a cluster for the length of the roll.
    PROTOCOL_VERSION: 1,
    PROTOCOL_VERSION_LEGACY: 0,
    // Optional features, announced by both sides and intersected. Names are
    // permanent once released; a peer that does not list one must never be sent
    // it. Populated as 1.0 lands each feature.
    CAPABILITIES: [],
    MAX_PACKET_SIZE: 1024 * 1024,
    HTTP_CONTENT_TYPES: {
        txt: "text/plain;charset=utf-8",
        html: "text/html;charset=utf-8",
        htm: "text/html;charset=utf-8",
        css: "text/css;charset=utf-8",
        js: "text/javascript;charset=utf-8",
        md: "text/markdown;charset=utf-8",
        sh: "application/x-shellscript;charset=utf-8",
        svg: "image/svg+xml;charset=utf-8",
        xml: "text/xml;charset=utf-8",

        png: "image/png",
        jpeg: "image/jpeg",
        jpg: "image/jpeg",
        jpe: "image/jpeg",
        gif: "image/gif",

        ttf: "font/ttf",
        woff: "font/woff",
        woff2: "font/woff2",
        eot: "application/vnd.ms-fontobject",

        gz: "application/gzip",
        bz: "application/x-bzip",
        bz2: "application/x-bzip2",
        xz: "application/x-xz",
        zst: "application/zst",
    }
};

for(let item in constants) {
    constants[item]._string = ((number) => {
        for (let key in constants[item]) {
            if (constants[item][key] == number) {
                return key;
            }
        }

        return number;
    });
}

module.exports = constants;