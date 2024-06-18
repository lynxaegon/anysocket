let WebSocket;
if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
    module.exports = require("../browser/events");
}
else {
    module.exports = require("events");
}