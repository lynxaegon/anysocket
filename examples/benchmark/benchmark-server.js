const AnySocket = require("../../src");
const BENCHMARK_DURATION = 5;

const server = new AnySocket();
server.listen("ws", 3000);
server.on("connected", (peer) => {
    console.log("[SERVER][" + peer.id + "] Connected");

    console.time("Running PLAIN TEXT benchmark");
    runBenchmark(peer, BENCHMARK_DURATION).then((latency) => {
        console.timeEnd("Running PLAIN TEXT benchmark");
        console.log("Latency:", latency.toFixed(2), "ms");
    });
});

server.on("message", (packet) => {
    console.log("[SERVER][" + packet.peer.id + "]", packet.msg);
});

server.on("e2e", (peer) => {
    console.time("Running E2EE benchmark");
    runBenchmark(peer, BENCHMARK_DURATION).then((latency) => {
        console.timeEnd("Running E2EE benchmark");
        console.log("Latency:", latency.toFixed(2), "ms");
        setTimeout(() => {
            server.stop();
        }, 1000);

    });
});

server.on("disconnected", (peer, reason) => {
    console.log("[SERVER][" + peer.id + "] Disconnected. Reason:", reason);
});

let benchmarkStop = false;
let benchmarkLatency = [];
function runBenchmark(peer, time) {
    return new Promise((resolve) => {
        benchmarkStop = false;
        benchmarkServer(peer);
        setTimeout(() => {
            benchmarkStop = true;
            resolve(benchmarkLatency.reduce((avg, value, _, { length }) => {
                return avg + value / length;
            }, 0));
        }, time * 1000);
    });
}

function benchmarkServer(peer) {
    if(benchmarkStop) {
        return;
    }
    peer.heartbeat(true).then(peer => {
        benchmarkLatency.push(peer.lag);
        setTimeout(() => {
            benchmarkServer(peer);
        }, 1);
    }).catch(e => {
        // ignored
    });
}