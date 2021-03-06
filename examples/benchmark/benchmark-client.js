const AnySocket = require("../../src");
const BENCHMARK_DURATION = 5;

let FINISHED_BENCHMARK = 0;
const anysocket = new AnySocket();
console.log("AnySocket.ID", anysocket.id);

anysocket.connect("ws", "127.0.0.1",3000);
anysocket.on("connected", (peer) => {
    console.log("[CLIENT][" + peer.id + "] Connected");
    console.time("Running PLAIN TEXT benchmark");
    runBenchmark(peer, BENCHMARK_DURATION).then((latency) => {
        console.timeEnd("Running PLAIN TEXT benchmark");
        console.log("Latency:", latency.toFixed(2), "ms");
        peer.e2e();
    });
});
anysocket.on("e2e", (peer) => {
    console.time("Running E2EE benchmark");
    runBenchmark(peer, BENCHMARK_DURATION).then((latency) => {
        console.timeEnd("Running E2EE benchmark");
        console.log("Latency:", latency.toFixed(2), "ms");
        finishBenchmark(peer);
    });
});
anysocket.on("message", (packet) => {
    if(packet.msg.type == "finish" && benchmarkStop) {
        finishBenchmark();
    } else {
        // echo the message back
        packet.reply(packet.msg);
    }
});

anysocket.on("disconnected", (peer, reason) => {
    console.log("[CLIENT][" + peer.id + "] Disconnected. Reason:", reason);
});


let benchmarkStop = false;
let benchmarkLatency = [];
function runBenchmark(peer, time) {
    return new Promise((resolve) => {
        benchmarkStop = false;
        benchmark(peer);
        setTimeout(() => {
            benchmarkStop = true;
            resolve(benchmarkLatency.reduce((avg, value, _, { length }) => {
                return avg + value / length;
            }, 0));
        }, time * 1000);
    });
}

function benchmark(peer) {
    if(benchmarkStop) {
        return;
    }

    peer.send({
        time: (new Date()).getTime()
    }, true).then((packet) => {
        let elapsed = (new Date()).getTime() - packet.msg.time;
        benchmarkLatency.push(elapsed);
        setTimeout(() => {
            benchmark(peer);
        }, 1);
    }).catch(e => {
        // ignored
    });
}

function finishBenchmark(peer) {
    FINISHED_BENCHMARK++;
    if(peer) {
        peer.send({
            type: "finish"
        });
    }

    if(FINISHED_BENCHMARK == 2) {
        anysocket.stop();
    }
}