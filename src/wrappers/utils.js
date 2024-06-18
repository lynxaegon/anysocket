if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
    module.exports = require("../browser/utils");
}
else {
    module.exports = require("../libs/utils");
}