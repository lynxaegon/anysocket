module.exports = (COMMAND) => {
    const NETWORK_COMMAND = COMMAND;
    return {
        init() {
            this.rpc = {};
        },
        setRPC(rpc) {
            this.rpc = rpc;
        }
    }
}