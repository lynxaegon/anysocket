#### HTTP
```
root@anubis:~# wrk -t16 -c500 -d10s http://10.10.0.17:8080
Running 10s test @ http://10.10.0.17:8080
  16 threads and 500 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency     4.02ms    2.17ms  93.76ms   97.23%
    Req/Sec     7.64k     1.28k   27.31k    90.00%
  1212457 requests in 10.09s, 165.35MB read
  Socket errors: connect 0, read 0, write 50, timeout 0
Requests/sec: 120114.47
Transfer/sec:     16.38MB
```

#### ANYSOCKET
```
root@anubis:~# wrk -t16 -c500 -d10s http://10.10.0.17:8080
Running 10s test @ http://10.10.0.17:8080
  16 threads and 500 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency     4.78ms    2.48ms 108.00ms   97.26%
    Req/Sec     6.48k     1.15k   18.70k    88.67%
  1021442 requests in 10.05s, 172.42MB read
  Socket errors: connect 0, read 0, write 50, timeout 0
Requests/sec: 101617.28
Transfer/sec:     17.15MB
```

#### EXPRESS
```
root@anubis:~# wrk -t16 -c500 -d10s http://10.10.0.17:8080
Running 10s test @ http://10.10.0.17:8080
  16 threads and 500 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency     7.80ms    3.71ms 146.48ms   96.95%
    Req/Sec     3.98k   762.40     7.87k    88.27%
  635413 requests in 10.07s, 130.29MB read
  Socket errors: connect 0, read 0, write 50, timeout 0
Requests/sec:  63093.76
Transfer/sec:     12.94MB
```