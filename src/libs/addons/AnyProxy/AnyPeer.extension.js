module.exports = (COMMAND) => {
    const NETWORK_COMMAND = COMMAND;
    return {
        init() {
            this.links = {};
        },
        addLink(peer) {
            this.links[peer.id] = peer;
        },
        removeLink(peer) {
            delete this.links[peer.id];
        },
        getLinks() {
            return this.links;
        }
    }
}