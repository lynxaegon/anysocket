/**
 * A queue that hands its items to a worker one at a time, in order.
 *
 * What a connection needs from fastq — concurrency 1, push, pause, resume, kill —
 * with the methods on a prototype. fastq builds some twenty closures per queue and
 * a connection holds four, which was most of what an idle connection cost.
 *
 * The worker is called as worker.call(context, item, done) and calls done() once
 * the item is handled, synchronously or later. A paused queue keeps what is pushed
 * and lets the item in hand finish; kill() drops everything not yet handed out.
 */
class SerialQueue {
    constructor(context, worker) {
        this.context = context;
        this.worker = worker;
        this.items = [];
        this.head = 0;
        this.paused = false;
        this.running = false;
    }

    push(item) {
        this.items.push(item);
        if (!this.running && !this.paused) this._run();
    }

    pause() {
        this.paused = true;
    }

    resume() {
        if (!this.paused) return;
        this.paused = false;
        if (!this.running) this._run();
    }

    kill() {
        this.items = [];
        this.head = 0;
    }

    /** The items not yet handed to the worker. */
    getQueue() {
        return this.items.slice(this.head);
    }

    length() {
        return this.items.length - this.head;
    }

    _run() {
        // A loop rather than recursion: a worker that finishes synchronously would
        // otherwise grow the stack by one frame per item.
        while (!this.paused && this.head < this.items.length) {
            const item = this.items[this.head];
            this.items[this.head++] = undefined;
            // Drop the handed-out prefix now and then, so a busy queue does not grow forever.
            if (this.head > 1024 && this.head * 2 > this.items.length) {
                this.items = this.items.slice(this.head);
                this.head = 0;
            }

            this.running = true;
            let sync = true;
            let finishedSync = false;
            let finished = false;
            this.worker.call(this.context, item, () => {
                if (finished) return;
                finished = true;
                if (sync) {
                    finishedSync = true;
                    return;
                }
                this.running = false;
                this._run();
            });
            sync = false;
            if (!finishedSync) return;
            this.running = false;
        }
        if (this.head >= this.items.length) {
            this.items.length = 0;
            this.head = 0;
        }
    }
}

module.exports = SerialQueue;
