if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
    module.exports = require("../browser/utils_buffer");
}
else {
    module.exports = require("../libs/utils_buffer");
}