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
        RPC_NOTIFY: 4
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
        E2E: 2,
        AES: 3
    },
    MAX_PACKET_SIZE: 4000
};

for(let item in constants) {
    constants[item].toString = ((number) => {
        if(typeof number === 'number') {
            number = parseInt(number);
            for (let key in this) {
                if (typeof this[key] === 'number' && this[key] == number) {
                    return key;
                }
            }
        }

        return number;
    }).bind(item);
}

module.exports = constants;