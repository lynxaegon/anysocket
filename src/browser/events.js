module.exports = class EventEmitter {
    constructor() {
        this.callbacks = {};
        this.callbacks_once = {};
    }

    on(event, cb) {
        if (!this.callbacks[event])
            this.callbacks[event] = [];
        this.callbacks[event].push(cb)
    }

    off(event, cb) {
        if(this.callbacks[event]) {
            this.callbacks[event] = this.callbacks[event].filter(item => item !== cb);
        }
    }

    removeListener(event, cb) {
        this.off(event, cb);
    }

    removeAllListeners(event) {
        if(event === undefined) {
            this.callbacks = {};
        } else {
            delete this.callbacks[event];
        }
    }

    once(event, cb) {
        if (!this.callbacks_once[event])
            this.callbacks_once[event] = [];
        this.callbacks_once[event].push(cb)
    }

    emit(event, ...args) {
        let cbs = this.callbacks[event];
        if (cbs) {
            cbs.forEach(cb => cb(...args));
        }

        cbs = this.callbacks_once[event];
        if (cbs) {
            cbs.forEach(cb => cb(...args));
            delete this.callbacks_once[event];
        }
    }
};