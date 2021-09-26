# AnySocket
An abstract networking layer over multiple transports, agnostic of client/server with support for E2EE (with forward secrecy)

[![Dependency Status](https://david-dm.org/lynxaegon/anysocket.svg)](https://david-dm.org/lynxaegon/anysocket)
[![devDependency Status](https://david-dm.org/lynxaegon/anysocket/dev-status.svg)](https://david-dm.org/lynxaegon/anysocket/?type=dev)
[![NPM version](https://badge.fury.io/js/anysocket.svg)](https://www.npmjs.com/package/anysocket)
![Downloads](https://img.shields.io/npm/dm/anysocket.svg?style=flat)
[![HitCount](http://hits.dwyl.com/lynxaegon/anysocket.svg)](http://hits.dwyl.com/lynxaegon/anysocket)

* <a href="#features">Features</a>
* <a href="#benchmark">Benchmark</a>
* <a href="#installation">Installation</a>
* <a href="#usage">Usage</a>
* <a href="#api">API</a>
* <a href="#future">Upcoming Features</a>
* <a href="#license">License</a>

#### Important

This is a work in progress and API is subject to change.

_WIP Documentation_

<a name="features"></a>
## Features
* Client / Server agnostic
* Support for request/reply
* Custom AUTH method
* E2EE between peers with forward secrecy
* RPC support
* P2P using a proxy server (with support for direct E2EE between peers)
* Binary support (_see: <a href="#AnySocket.Packer.pack"><code><b>AnySocket.Packer</b></code></a>_)
* **Browser support** - 31kb footprint (_see: ```/dist/anysocket.bundle.js```_)
* Multiple transports *(implemented atm: **ws/wss**, **http/https**)
* All peers have a UUIDv4 associated
* Disconnect detection using a heartbeat
* **Not Battle Tested** ...yet


** _http_ transport is experimental

_Info: Binary RPC arguments and responses are auto packed/unpacked (<a href="#AnySocket.Packer.pack"><code><b>AnySocket.Packer.pack</b></code></a>/<a href="#AnySocket.Packer.unpack"><code><b>AnySocket.Packer.unpack</b></code></a>)._ 


<a name="benchmark"></a>
## Benchmark
#### nodejs - browser
```
Running PLAIN TEXT benchmark: 5518.838ms  (test duration)
Latency: 0.86 ms
Running E2EE benchmark: 5986.633ms        (test duration)
Latency: 1.06 ms
```

#### nodejs - nodejs
```
Running PLAIN TEXT benchmark: 5010.484ms  (test duration)
Latency: 0.67 ms
Running E2EE benchmark: 5003.755ms        (test duration)
Latency: 0.92 ms
```
_You can run the benchmarks from: ```/examples/benchmark```_

<a name="installation"></a>
## Installation

```javascript
npm install --save anysocket
```
or
```html
<script src="/dist/anysocket.bundle.js"></script>
```
or _(if using AnySocketHTTP)_
```html
<script src="@anysocket"></script>
```


<a name="usage"></a>
## How to use
The following example starts a websocket server on port 3000.
```javascript
const AnySocket = require("anysocket");
const server = new AnySocket();
const PORT = 3000;
server.listen("ws", PORT)
    .then(() => {
        console.log("Listening on port:", PORT);
    })
    .catch((err) => {
        console.error("Failed to start server:", err);
    });
server.on("connected", (peer) => {
    console.log("Connected", peer.id);    
    peer.send({
        hello: "world"
    });
});
server.on("message", (packet) => {
    console.log("From:", packet.peer.id, "Message:", packet.msg);
});
server.on("disconnected", (peer, reason) => {
    console.log("Disconnected", peer.id, "Reason:", reason);
});
```

The following example connects to a websocket on port 3000
```javascript
const AnySocket = require("anysocket");
const client = new AnySocket();
const PORT = 3000;
client.connect("ws", "127.0.0.1", PORT)
    .then(() => {
        // note: you cannot send messages from here, you need to wait for the "connected" event
        console.log("Connected to server");
    })
    .catch((err) => {
        console.error("Failed to connect to server:", err);
    });

// after negotiating the AUTH packet, it will trigger the connect event
client.on("connected", (peer) => {
    console.log("Connected", peer.id);    
    peer.send({
        hello: "world"
    });
});
client.on("message", (packet) => {
    console.log("From:", packet.peer.id, "Message:", packet.msg);
});
client.on("disconnected", (peer, reason) => {
    console.log("Disconnected", peer.id, "Reason:", reason);
});
```
More in the `examples` folder.

<a name="api"></a>
## Api
* <a href="#AnySocket.constructor"><code><b>AnySocket()</b></code></a>
    * <a href="#AnySocket.id"><code><b>id</b></code></a>
    * <a href="#AnySocket.http"><code><b>http</b></code></a>
    * <a href="#AnySocket.server"><code><b>server()</b></code></a>
    * <a href="#AnySocket.listen"><code><b>listen()</b></code></a>
    * <a href="#AnySocket.connect"><code><b>connect()</b></code></a>
    * <a href="#AnySocket.stop"><code><b>stop()</b></code></a>
    * <a href="#AnySocket.onAuth"><code><b>onAuth()</b></code></a>
    * <a href="#AnySocket.authPacket"><code><b>authPacket()</b></code></a>
    * <a href="#AnySocket.broadcast"><code><b>broadcast()</b></code></a>
    * <a href="#AnySocket.setRPC"><code><b>setRPC()</b></code></a>
    * <a href="#AnySocket.canProxy"><code><b>canProxy()</b></code></a>
    * <a href="#AnySocket.proxy"><code><b>proxy()</b></code></a>
    * <a href="#AnySocket.hasPeer"><code><b>hasPeer()</b></code></a>
    * <a href="#AnySocket.hasDirectPeer"><code><b>hasDirectPeer()</b></code></a>
    * <a href="#AnySocket.on.connected"><code><b>event: _connected_</b></code></a>
    * <a href="#AnySocket.on.message"><code><b>event: _message_</b></code></a>
    * <a href="#AnySocket.on.e2e"><code><b>event: _e2e_</b></code></a>
    * <a href="#AnySocket.on.disconnected"><code><b>event: _disconnected_</b></code></a>
* <a href="#AnyPacket.constructor"><code><b>AnyPacket()</b></code></a>
    * <a href="#AnyPacket.seq"><code><b>seq</b></code></a>
    * <a href="#AnyPacket.peer"><code><b>peer</b></code></a>
    * <a href="#AnyPacket.msg"><code><b>msg</b></code></a>
    * <a href="#AnyPacket.reply"><code><b>reply()</b></code></a>
* <a href="#AnySocket.Packer.pack"><code><b>AnySocket.Packer</b></code></a>
    * <a href="#AnySocket.Packer.pack"><code><b>pack()</b></code></a>
    * <a href="#AnySocket.Packer.unpack"><code><b>unpack()</b></code></a>
* <a href="#AnyPeer.constructor"><code><b>AnyPeer()</b></code></a>
    * <a href="#AnyPeer.id"><code><b>id</b></code></a>
    * <a href="#AnyPeer.connectionID"><code><b>connectionID</b></code></a>
    * <a href="#AnyPeer.rpc"><code><b>rpc</b></code></a>
    * <a href="#AnyPeer.e2e"><code><b>e2e()</b></code></a>
    * <a href="#AnyPeer.send"><code><b>send()</b></code></a>
    * <a href="#AnyPeer.disconnect"><code><b>disconnect()</b></code></a>
    * <a href="#AnyPeer.isProxy"><code><b>isProxy()</b></code></a>
    * <a href="#AnyPeer.isE2EEnabled"><code><b>isE2EEnabled()</b></code></a>
    * <a href="#AnyPeer.on.message"><code><b>event: _message_</b></code></a>
    * <a href="#AnyPeer.on.e2e"><code><b>event: _e2e_</b></code></a>
    * <a href="#AnyPeer.on.disconnected"><code><b>event: _disconnected_</b></code></a>
* <a href="#AnyHTTPRouter.constructor"><code><b>AnyHTTPRouter()</b></code></a>
    * <a href="#AnyHTTPRouter.on"><code><b>on()</b></code></a>
    * <a href="#AnyHTTPRouter.any"><code><b>any()</b></code></a>
    * <a href="#AnyHTTPRouter.get"><code><b>get()</b></code></a>
    * <a href="#AnyHTTPRouter.post"><code><b>post()</b></code></a>
    * <a href="#AnyHTTPRouter.delete"><code><b>delete()</b></code></a>
    * <a href="#AnyHTTPRouter.error"><code><b>error()</b></code></a>
* <a href="#AnyHTTPPeer.constructor"><code><b>AnyHTTPPeer()</b></code></a>
    * <a href="#AnyHTTPPeer.url"><code><b>url</b></code></a>
    * <a href="#AnyHTTPPeer.query"><code><b>query</b></code></a>
    * <a href="#AnyHTTPPeer.cookies"><code><b>cookies</b></code></a>
    * <a href="#AnyHTTPPeer.status"><code><b>status()</b></code></a>
    * <a href="#AnyHTTPPeer.header"><code><b>header()</b></code></a>
    * <a href="#AnyHTTPPeer.body"><code><b>body()</b></code></a>
    * <a href="#AnyHTTPPeer.setCookie"><code><b>setCookie()</b></code></a>
    * <a href="#AnyHTTPPeer.deleteCookie"><code><b>deleteCookie()</b></code></a>
    * <a href="#AnyHTTPPeer.end"><code><b>end()</b></code></a>
    * <a href="#AnyHTTPPeer.isClosed"><code><b>isClosed()</b></code></a>
    
## Documentation
<a name="AnySocket.constructor"></a>
### AnySocket()

Creates a new AnySocket instance

-------------------------------------------------------
<a name="AnySocket.id"></a>
### AnySocket.id

Unique identifier (UUIDv4) that will be used for all connections originating this instance (client/server)

-------------------------------------------------------
<a name="AnySocket.http"></a>
### AnySocket.http

See: <a href="#AnyHTTPRouter">AnyHTTPRouter</a>

-------------------------------------------------------
<a name="AnySocket.server"></a>
### AnySocket.server(scheme, options)

Alias for <a href="#AnySocket.listen">AnySocket.listen()</a>

-------------------------------------------------------
<a name="AnySocket.listen"></a>
### AnySocket.listen(scheme, options)

Attaches a new server transport based on the selected **scheme*

**Arguments:**
* `scheme` - one of the implemented transports
* `options` - one of the options below
    * `port` - port number
    * `json` 
```
{
    ip: "0.0.0.0", // listening ip
    port: 3000, // listening port
    authTimeout: 5 * 1000, // auth timeout
    replyTimeout: 30 * 1000, // reply timeout
    heartbeatInterval: 5 * 1000 // heartbeat interval
}
```

**Returns** a Promise that resolves/rejects when the server has started listening or when it throws an error

-------------------------------------------------------
<a name="AnySocket.connect"></a>
### AnySocket.connect(scheme, ip, port, [options])

Connects to AnySocket Server

**Arguments:**
* `scheme` - one of the implemented transports
* `ip` - server ip
* `port` - server port
* `options` - options json
```
{
    authTimeout: 5 * 1000, // auth timeout
    replyTimeout: 30 * 1000, // reply timeout
    heartbeatInterval: 5 * 1000 // heartbeat interval
}
```

**Returns** a Promise that resolves/rejects when a connection has been established
_note: you cannot take actions (ex: send) until the `connected` event has been triggered_

-------------------------------------------------------
<a name="AnySocket.stop"></a>
### AnySocket.stop()

Stops all servers and disconnects all peers

**Returns** a Promise that resolves/rejects when finished

-------------------------------------------------------
<a name="AnySocket.onAuth"></a>
### AnySocket.onAuth(packet)

You can overwrite this function to implement a custom auth validation.
**Arguments:**
* `packet` - A JSON containing the Peer <a href="#AnySocket.id">AnySocket.id</a> and the custom <a href="#AnySocket.authPacket">AnySocket.authPacket</a>

**Returns** _true/false_ if validation passed or not

_note: onAuth must be implemented in both server & client_

-------------------------------------------------------
<a name="AnySocket.authPacket"></a>
### AnySocket.authPacket()

You can overwrite this function to implement a custom auth packet.

**Returns** a JSON containing the AUTH packet that will be validated in <a href="#AnySocket.onAuth">AnySocket.onAuth()</a>

_note: auth packet must be implemented in both server & client_

-------------------------------------------------------
<a name="AnySocket.broadcast"></a>
### AnySocket.broadcast(message, [awaitReply])

Broadcasts a message to all connected peers

**Arguments:**
* `message` - a JSON stringifiable object
* `awaitReply` - set to true if a reply is expected (optional) - default: false

**Returns** a Promise that resolves with a <a href="#AnyPacket">AnyPacket</a> if waiting for a reply or rejects on error

_note: it doesn't resolve if awaitReply is not set_ 

-------------------------------------------------------
<a name="AnySocket.setRPC"></a>
### AnySocket.setRPC(rpc)

This sets the RPC functions on the AnySocket object so they can be called using <a href="#AnyPeer.rpc">AnyPeer.rpc</a>
RPC object can be nested indefinitely, but the "this" object will always be the called method's parent

Each RPC function can return a value, object, Buffer/TypedArray or a Promise (awaits the promise to be resolved)

Binary info:
* If a RPC receives an argument as a Buffer/TypedArray it will be auto unpacked
* If a RPC returns a Buffer/TypedArray it will be auto packed

**Arguments:**
* `rpc` - object or class with RPC functions

Any  throwed error / reject will be sent back to the client in the form: 
```javascript
{
    error: "error message",
    code: 500
}
```

-------------------------------------------------------

<a name="AnySocket.canProxy"></a>
### AnySocket.canProxy(peerID, otherPeerID)

Checks if peerID can be proxied through otherPeerID. Defaults to: false

_note: You need to override this function in order to allow proxying_

**Returns** ```true/false```

-------------------------------------------------------
<a name="AnySocket.hasPeer"></a>
### AnySocket.hasPeer(id)

_note: returns true for proxies_

**Returns** ```true/false``` if <a href="#AnySocket">AnySocket</a> has a peer with the ```id```

-------------------------------------------------------
<a name="AnySocket.hasDirectPeer"></a>
### AnySocket.hasDirectPeer(id)

_note: returns false for proxies_

**Returns** ```true/false``` if <a href="#AnySocket">AnySocket</a> has a direct peer (no proxy) with the ```id```

-------------------------------------------------------
<a name="AnySocket.proxy"></a>
### AnySocket.proxy(peerID, throughPeerID)

Send a proxy request for peerID via throughPeerID as relay

_note: A proxied peer uses the same flow as a new connection_

**Returns** a Promise that resolves with a <a href="#AnyPeer">AnyPeer</a> or rejects if proxy fails


-------------------------------------------------------
<a name="AnySocket.on.connected"></a>
### AnySocket event `connected`

Emitted when the link has been established and it's ready for sending/receiving messages

**Arguments:**
* `peer` - <a href="#AnyPeer">AnyPeer</a> instance

-------------------------------------------------------
<a name="AnySocket.on.message"></a>
### AnySocket event `message`

Emitted when a message is received

**Arguments:**
* `packet` - <a href="#AnyPacket">AnyPacket</a> instance

-------------------------------------------------------
<a name="AnySocket.on.e2e"></a>
### AnySocket event `e2e`

Emitted when the link has been end-to-end encrypted and it's ready to be used

**Arguments:**
* `peer` - <a href="#AnyPeer">AnyPeer</a> instance

-------------------------------------------------------
<a name="AnySocket.on.disconnected"></a>
### AnySocket event `disconnected`

Emitted when a peer has disconnected

**Arguments:**
* `peer` - <a href="#AnyPeer">AnyPeer</a> instance
* `reason` - a string detailing the disconnect reason

-------------------------------------------------------
<a name="AnyPacket.constructor"></a>
### AnyPacket()

Constructor should not be used directly

-------------------------------------------------------
<a name="AnyPacket.seq"></a>
### AnyPacket.seq

An incremental unique identifier per packet per peer (used internally)

-------------------------------------------------------
<a name="AnyPacket.peer"></a>
### AnyPacket.peer

An <a href="#AnyPeer.constructor">AnyPeer</a> instance

-------------------------------------------------------
<a name="AnyPacket.msg"></a>
### AnyPacket.msg

An object that contains data sent/received from a peer

-------------------------------------------------------
<a name="AnyPacket.reply"></a>
### AnyPacket.reply(message)

Sends a reply to the current packet

**Arguments:**
* `message` - a JSON stringifiable object

_note: you can only reply to a normal message, you **cannot** reply to a **reply packet**. It fails silently_ 

-------------------------------------------------------
<a name="AnySocket.Packer.pack"></a>
### AnySocket.Packer.pack(bytes)

Packs the bytes

**Arguments:**
* `bytes` - Buffer/TypedArray

**Returns** a string representation of the bytes

-------------------------------------------------------
<a name="AnySocket.Packer.unpack"></a>
### AnySocket.Packer.unpack(bytes)

Unpacks the bytes

**Arguments:**
* `bytes` - String representation of a Buffer/TypedArray

**Returns** a Buffer/TypedArray

-------------------------------------------------------
<a name="AnyPeer.constructor"></a>
### AnyPeer()

Constructor should not be used directly

-------------------------------------------------------
<a name="AnyPeer.id"></a>
### AnyPeer.id

Unique peer identifier (UUIDv4) - Peer <a href="#AnySocket.id">AnySocket.id</a>

-------------------------------------------------------
<a name="AnyPeer.connectionID"></a>
### AnyPeer.connectionID

Unique connection identifier (UUIDv4), used internally before getting a <a href="#AnyPeer.id">AnyPeer.id</a>

-------------------------------------------------------
<a name="AnyPeer.rpc"></a>
### AnyPeer.rpc(...args)

This is a special Proxy Object that can indefinitely nested and have any number of arguments

Example: `peer.rpc.hello.world.user("LynxAegon")`
* This will try to run a RPC on the peer and the RPC object should look like this:
```javascript
AnySocket.setRPC({
    hello: {
        world: {
            user: (name) => {
                return new Promise((resolve, reject) => {
                    resolve("Hello World, " + name);
                });
            }
        }
    }
})
```

**Returns** a Promise that will resolve if success or reject in case of error 

-------------------------------------------------------
<a name="AnyPeer.e2e"></a>
### AnyPeer.e2e()

Enables E2E encryption using ECDH for exchange and then switches to AES-256-CBC with forward secrecy. 

Each message is encrypted with a different key derrived from the master key

-------------------------------------------------------
<a name="AnyPeer.send"></a>
### AnyPeer.send(message, [awaitReply, [timeout]])

Sends a message to the peer

**Arguments:**
* `message` - a JSON stringifiable object
* `awaitReply` - set to true if a reply is expected (optional) - default: false
* `timeout` - set a custom reply packet timeout in milliseconds (optional)

**Returns** a Promise that resolves with a <a href="#AnyPacket">AnyPacket</a> if waiting for a reply or rejects on error

_note: it doesn't resolve if awaitReply is not set_ 

_note: you can only reply to a normal message, you **cannot** reply to a **reply packet**. It fails silently_ 

-------------------------------------------------------
<a name="AnyPeer.disconnect"></a>
### AnyPeer.disconnect(reason)

Disconnects the peer

**Arguments:**
* `reason` - a string that explains why the peer was disconnected

-------------------------------------------------------
<a name="AnyPeer.isProxy"></a>
### AnyPeer.isProxy()

**Returns** ```true``` if the <a href="#AnyPeer">AnyPeer</a> instance is a proxy (see: <a href="#AnySocket.proxy">AnySocket.proxy</a>)

-------------------------------------------------------
<a name="AnyPeer.isE2EEnabled"></a>
### AnyPeer.isE2EEnabled()

**Returns** ```true``` if the connection has been end-to-end encrypted (see: <a href="#AnyPeer.e2e">AnyPeer.e2e</a>)


-------------------------------------------------------
<a name="AnyPeer.on.message"></a>
### AnyPeer event `message`

Emitted when a message is received

**Arguments:**
* `packet` - <a href="#AnyPacket">AnyPacket</a> instance

-------------------------------------------------------
<a name="AnyPeer.on.e2e"></a>
### AnyPeer event `e2e`

Emitted when the link has been end-to-end encrypted and it's ready to be used

**Arguments:**
* `peer` - <a href="#AnyPeer">AnyPeer</a> instance

-------------------------------------------------------
<a name="AnyPeer.on.disconnected"></a>
### AnyPeer event `disconnected`

Emitted when the peer has disconnected

**Arguments:**
* `peer` - <a href="#AnyPeer">AnyPeer</a> instance
* `reason` - a string detailing the disconnect reason

-------------------------------------------------------
<a name="AnyHTTPRouter.constructor"></a>
### AnyHTTPRouter()

Constructor should not be used directly

-------------------------------------------------------
<a name="AnyHTTPRouter.on"></a>
### AnyHTTPRouter.on(method, path, callback)

Raw method to link to a HTTP query.

Example:
```javascript
AnySocket.on("GET", "/index", (peer) => {
    peer
        .status(200)
        .body("hello world")
        .end();
});
```

**Arguments:**
* `method` - GET/POST/DELETE/Any Custom Method. _Use "\_" for any method_
* `path` - HTTP path, can be a string or RegExp instance
* `callback` - executed when the path matches a HTTP Path (arguments: <a href="#AnyHTTPPeer.constructor">AnyHTTPPeer</a>)

-------------------------------------------------------
<a name="AnyHTTPRouter.any"></a>
### AnyHTTPRouter.any(path, callback)

Matches a path with any method

Example:
```javascript
AnySocket.any("/index", (peer) => {
    peer
        .status(200)
        .body("hello world")
        .end();
});
```

**Arguments:**
* `path` - HTTP path, can be a string or RegExp instance
* `callback` - executed when the path matches a HTTP Path (arguments: <a href="#AnyHTTPPeer.constructor">AnyHTTPPeer</a>)

-------------------------------------------------------
<a name="AnyHTTPRouter.get"></a>
### AnyHTTPRouter.get(path, callback)

Matches a path with GET method

Example:
```javascript
AnySocket.get("/index", (peer) => {
    peer
        .status(200)
        .body("hello world")
        .end();
});
```

**Arguments:**
* `path` - HTTP path, can be a string or RegExp instance
* `callback` - executed when the path matches a HTTP Path (arguments: <a href="#AnyHTTPPeer.constructor">AnyHTTPPeer</a>)

-------------------------------------------------------
<a name="AnyHTTPRouter.post"></a>
### AnyHTTPRouter.post(path, callback)

Matches a path with POST method

Example:
```javascript
AnySocket.post("/index", (peer) => {
    peer
        .status(200)
        .body("hello world")
        .end();
});
```

**Arguments:**
* `path` - HTTP path, can be a string or RegExp instance
* `callback` - executed when the path matches a HTTP Path (arguments: <a href="#AnyHTTPPeer.constructor">AnyHTTPPeer</a>)

-------------------------------------------------------
<a name="AnyHTTPRouter.delete"></a>
### AnyHTTPRouter.delete(path, callback)

Matches a path with DELETE method

Example:
```javascript
AnySocket.delete("/index", (peer) => {
    peer
        .status(200)
        .body("hello world")
        .end();
});
```

**Arguments:**
* `path` - HTTP path, can be a string or RegExp instance
* `callback` - executed when the path matches a HTTP Path (arguments: <a href="#AnyHTTPPeer.constructor">AnyHTTPPeer</a>)

-------------------------------------------------------
<a name="AnyHTTPRouter.error"></a>
### AnyHTTPRouter.error(callback)

Executes when a HTTP error is catched.

**Arguments:**
* `callback` - an error callback (arguments: <a href="#AnyHTTPPeer.constructor">AnyHTTPPeer</a>, error)

-------------------------------------------------------
<a name="AnyHTTPPeer.constructor"></a>
### AnyHTTPPeer()

Constructor should not be used directly

-------------------------------------------------------
<a name="AnyHTTPPeer.url"></a>
### AnyHTTPPeer.url

**Returns** the HTTP Path without query string

-------------------------------------------------------
<a name="AnyHTTPPeer.query"></a>
### AnyHTTPPeer.query

**Returns** an object like 
```javascript 
{
    headers: req.headers, // headers
    cookies: req.headers.cookie, // cookies
    method: req.method.toLowerCase(), // method lowercased
    body: req.body, // post body
    qs: qs.query // query string
}
```


-------------------------------------------------------
<a name="AnyHTTPPeer.cookies"></a>
### AnyHTTPPeer.cookies

**Returns** the HTTP Cookies

-------------------------------------------------------
<a name="AnyHTTPPeer.status"></a>
### AnyHTTPPeer.status(code)

Sets the return status code

**Arguments:**
* `code` - HTTP Status code (int)


**Returns** <a name="AnyHTTPPeer.constructor">AnyHTTPPeer</a> for chaining

-------------------------------------------------------
<a name="AnyHTTPPeer.header"></a>
### AnyHTTPPeer.header(name, value)

Sets a header

**Arguments:**
* `name` - header name (string)
* `value` - header value (string)

**Returns** <a name="AnyHTTPPeer.constructor">AnyHTTPPeer</a> for chaining

-------------------------------------------------------
<a name="AnyHTTPPeer.body"></a>
### AnyHTTPPeer.body(chunk)

Appends a chunk(part) of the return body 

**Arguments:**
* `chunk` - HTTP Body (string)

**Returns** <a name="AnyHTTPPeer.constructor">AnyHTTPPeer</a> for chaining

-------------------------------------------------------
<a name="AnyHTTPPeer.setCookie"></a>
### AnyHTTPPeer.setCookie(key, value, [expires])

Sets a cookie with key, value and expires.

Cookies are set on the same domain and path "/"

**Arguments:**
* `key` - cookie name (string)
* `value` - cookie value (string)
* `expires` - cookie expire time (UnixTimestamp in millis). If not set, expires = 1

**Returns** <a name="AnyHTTPPeer.constructor">AnyHTTPPeer</a> for chaining

-------------------------------------------------------
<a name="AnyHTTPPeer.deleteCookie"></a>
### AnyHTTPPeer.deleteCookie(key)

Sets a cookie with key and expires = 1

**Arguments:**
* `key` - cookie name (string)

**Returns** <a name="AnyHTTPPeer.constructor">AnyHTTPPeer</a> for chaining

-------------------------------------------------------
<a name="AnyHTTPPeer.end"></a>
### AnyHTTPPeer.end()

Flush data and close the connection

-------------------------------------------------------
<a name="AnyHTTPPeer.isClosed"></a>
### AnyHTTPPeer.isClosed()

Check if the connection has already been ended / closed.

-------------------------------------------------------


<a name="future"></a>
## Upcoming Features
* Mesh Network
* Multiple transports: **tcp**, **udp***, **ipc**
* Client reconnection

_* this will require a change in the protocol, as the protocol assumes the packets are sent using a reliable, ordered connection_

<a name="license"></a>
## License

MIT
