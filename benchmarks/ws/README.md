_Used benchmark tool: [lynxaegon/anybenchmark](https://github.com/lynxaegon/anybenchmark)_
#### WS
```
root@anubis:~# node index.js -A 500 -M 1000 10.10.0.17:8080

Online               185 milliseconds
Time taken           8151 milliseconds
Connected            500
Disconnected         0
Failed               0
Message Count        500000
RPS                  61342.17
Total transferred    492.21MB
Total received       3.4MB

Durations (ms):

                     min     mean     stddev  median max
Handshaking          13      31           12      28 82
Latency              0       8             2       7 23

Percentile (ms):

                      50%     66%     75%     80%     90%     95%     98%     98%    100%
Handshaking          28      33      39      44      49      53      56      70      82
Latency              7       8       8       9       11      12      13      14      23
```

#### SOCKET.IO
```
root@anubis:~# node index.js -A 500 -M 1000 -P ./protocols/socketio.js 10.10.0.17:8080

Online               1918 milliseconds
Time taken           17996 milliseconds
Connected            500
Disconnected         0
Failed               0
Message Count        500000
RPS                  27783.95
Total transferred    0B
Total received       0B

Durations (ms):

                     min     mean     stddev  median max
Handshaking          70      677         587     642 1765
Latency              0       17           15      17 1563

Percentile (ms):

                      50%     66%     75%     80%     90%     95%     98%     98%    100%
Handshaking          642     1105    1185    1217    1634    1693    1710    1746    1765
Latency              17      17      18      18      19      20      21      22      1563
```

#### ANYSOCKET
```
root@anubis:~# node index.js -A 500 -M 1000 -P ./protocols/anysocket.js 10.10.0.17:8080

Online               869 milliseconds
Time taken           20947 milliseconds
Connected            500
Disconnected         0
Failed               0
Message Count        500000
RPS                  23869.77
Total transferred    0B
Total received       0B

Durations (ms):

                     min     mean     stddev  median max
Handshaking          45      289         249     169 749
Latency              0       20            3      20 44

Percentile (ms):

                      50%     66%     75%     80%     90%     95%     98%     98%    100%
Handshaking          169     184     648     663     690     701     708     718     749
Latency              20      21      22      22      23      24      26      27      44
```