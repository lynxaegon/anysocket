## Benchmarks:

* ### HTTP Server (_[link](http/)_)
  * __http__: _120k req/s_
  * __anysocket__: _100k req/s_
  * __express__: _63k req/s_

* ### WS Server (_[link](ws/)_)
    * __ws__: _61K req/s_
    * __socket.io__: _28K req/s_ (high latency) 
    * __anysocket__: _24k req/s_

## Benchmark Hardware:
* __Server__
    * OS: Windows 10
    * CPU: i7-12700K @ 3.6GHz
    * RAM: 32 GB
    * DISK: Samsung 970 EVO 1TB (m2)
* __Client__ (_Odyssey Blue J4125_)
    * OS: Debian 11
    * CPU: Intel(R) Celeron(R) J4125 CPU @ 2.00GHz
    * RAM: 8 GB
    * DISK: M2 SSD 128GB
