const WSTransport = require("../ws/transport");
class WSS extends WSTransport {
    static scheme() {
        return "ws";
    }
}
module.exports = WSS;