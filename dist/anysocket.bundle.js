var AnySocket;AnySocket=(()=>{var e={147:(e,t,s)=>{const n=window.crypto||window.msCrypto;if(!n)throw new Error("Crypto is not supported in this browser!");const r=s(20),i="P-521";e.exports=new class{randomBytes(e){let t=new Uint8Array(e);for(let s=0;s<e;s+=65536)n.getRandomValues(t.subarray(s,s+Math.min(e-s,65536)));return t}createECDH(){return new Promise((async(e,t)=>{window.crypto.subtle.generateKey({name:"ECDH",namedCurve:i},!1,["deriveKey","deriveBits"]).then((function(t){e({generateKeys:()=>new Promise(((e,s)=>{window.crypto.subtle.exportKey("raw",t.publicKey).then((function(t){t=new Uint8Array(t),e(t)})).catch((function(e){s(e)}))})),computeSecret:e=>new Promise(((s,n)=>{window.crypto.subtle.importKey("raw",e,{name:"ECDH",namedCurve:i},!1,[]).then((function(e){window.crypto.subtle.deriveBits({name:"ECDH",namedCurve:i,public:e},t.privateKey,512).then((e=>{e=new Uint8Array(e),s(r.bufferToHex(e))}))})).catch((function(e){n(e)}))}))})})).catch((function(e){t(e)}))}))}pbkdf2Sync(e,t,s,n,i){let o={sha256:"SHA-256"};if(!o[i])throw new Error("Invalid algorithm "+i);return i=o[i],new Promise((async(o,c)=>{e instanceof CryptoKey||(e=await window.crypto.subtle.importKey("raw",r.utf8Encode(e),{name:"PBKDF2"},!1,["deriveKey","deriveBits"])),window.crypto.subtle.deriveBits({name:"PBKDF2",salt:r.utf8Encode(t),iterations:s,hash:{name:i}},e,8*n).then((function(e){o(new Uint8Array(e))})).catch((function(e){c(e)}))}))}}},954:e=>{e.exports=()=>()=>{}},69:()=>{},267:e=>{e.exports=class{constructor(){this.callbacks={},this.callbacks_once={}}on(e,t){this.callbacks[e]||(this.callbacks[e]=[]),this.callbacks[e].push(t)}once(e,t){this.callbacks_once[e]||(this.callbacks_once[e]=[]),this.callbacks_once[e].push(t)}emit(e,...t){let s=this.callbacks[e];s&&s.forEach((e=>e(...t))),s=this.callbacks_once[e],s&&(s.forEach((e=>e(...t))),delete this.callbacks_once[e])}}},661:(e,t,s)=>{const n=s(510),r=s(20);n.encryptAES=(e,t)=>new Promise(((s,n)=>{window.crypto.subtle.importKey("raw",r.bufferFromHex(e),{name:"AES-CBC",length:256},!1,["encrypt"]).then((e=>{let i=window.crypto.getRandomValues(new Uint8Array(16));window.crypto.subtle.encrypt({name:"AES-CBC",iv:i},e,r.bufferFromString(t)).then((function(e){s(r.bufferToHex(i)+r.bufferToHex(new Uint8Array(e)))})).catch((function(e){n(e)}))})).catch(n)})),n.decryptAES=(e,t)=>new Promise(((s,n)=>{window.crypto.subtle.importKey("raw",r.bufferFromHex(e),{name:"AES-CBC",length:256},!1,["decrypt"]).then((e=>{window.crypto.subtle.decrypt({name:"AES-CBC",iv:r.bufferFromHex(t.substr(0,32))},e,r.bufferFromHex(t.substr(32))).then((function(e){s(r.bufferToString(new Uint8Array(e)))})).catch((e=>{n(e)}))})).catch((e=>{n(e)}))})),e.exports=n},20:e=>{e.exports={utf8Encode(e){let t=[],s=e.length,n=0;for(;n<s;){let s=e.codePointAt(n),r=0,i=0;for(s<=127?(r=0,i=0):s<=2047?(r=6,i=192):s<=65535?(r=12,i=224):s<=2097151&&(r=18,i=240),t.push(i|s>>r),r-=6;r>=0;)t.push(128|s>>r&63),r-=6;n+=s>=65536?2:1}return new Uint8Array(t)},bufferFromString(e){let t=new ArrayBuffer(e.length),s=new Uint8Array(t);for(let t=0,n=e.length;t<n;t++)s[t]=e.charCodeAt(t);return t},bufferToString(e){let t="";if(e){let s=new Uint8Array(e);for(let e=0;e<s.byteLength;e++)t+=String.fromCharCode(s[e])}return t},bufferToHex(e){return e.reduce(((e,t)=>e+this.i2hex(t)),"")},i2hex:e=>("0"+e.toString(16)).slice(-2),bufferFromHex(e){let t=new Uint8Array(e.length/2);for(let s=0;s<e.length;s+=2)t[s/2]=parseInt(e.substring(s,s+2),16);return t},isBuffer:e=>!!(e.buffer instanceof ArrayBuffer&&e.BYTES_PER_ELEMENT)}},966:e=>{e.exports=class{constructor(...e){this.ws=new WebSocket(...e)}on(e,t){switch(e){case"open":this.ws.onopen=t;break;case"error":this.ws.onerror=t;break;case"message":this.ws.onmessage=e=>{t(e.data)};break;case"close":this.ws.onclose=t;break;default:throw new Error("Not implemented in browser! ("+e+")")}}send(...e){this.ws.send(e)}close(){this.ws.close()}}},506:(e,t,s)=>{const n=s(100),r=s(555);n.Transport={LOCAL:s(870),WS:s(866),HTTP:s(69)},n.Packer={pack:r.packBytes.bind(r),unpack:r.unpackBytes.bind(r)},e.exports=n},117:e=>{e.exports=class{constructor(){this.routes={_:[]},this.routesRegexp={_:[]},this._process=this._process.bind(this)}on(e,t,s){return t instanceof RegExp?(this.routesRegexp[e]||(this.routesRegexp[e]=[]),this.routesRegexp[e].push({path:t,cb:s})):(this.routes[e]||(this.routes[e]=[]),this.routes[e][t.toLowerCase()]=s),this}any(e,t){return this.on("_",e,t)}get(e,t){return this.on("get",e,t)}post(e,t){return this.on("post",e,t)}delete(e,t){return this.on("delete",e,t)}error(e){this.onError=e}_process(e){try{if(this.routes._[e.url])return this.routes._[e.url](e),!0;if(this.routes[e.query.method]&&this.routes[e.query.method][e.url])return this.routes[e.query.method][e.url](e),!0;for(let t of this.routesRegexp._)if(t.path.test(e.url))return t.cb(e),!0;if(this.routesRegexp[e.query.method])for(let t of this.routesRegexp[e.query.method])if(t.path.test(this.routesRegexp.url))return t.cb(e),!0}catch(t){return this._finish(e,t)}this._finish(e,new Error("No route for path: '"+e.url+"'"))}_finish(e,t){this.onError&&this.onError(e,t),e.isClosed()||e.status(404).end()}}},555:(e,t,s)=>{const n=s(20);e.exports=new class{packInt16(e){const t=new ArrayBuffer(2);return new DataView(t).setInt16(0,e,!1),String.fromCharCode.apply(String,new Uint8Array(t))}unpackInt16(e){const t=new ArrayBuffer(2),s=new Uint8Array(t);for(let t in e)s[t]=e.charCodeAt(t);return new DataView(t).getInt16(0)}packHex(e){let t="";for(let s=0;s<e.length;s+=2)t+=String.fromCharCode(parseInt(e.substr(s,2),16));return t}unpackHex(e){let t="";for(let s=0;s<e.length;s++){let n=Number(e.charCodeAt(s)).toString(16);t+=1===n.length?"0"+n:n}return t}packBytes(e){if(!(e instanceof ArrayBuffer||e instanceof Uint8Array))throw new Error("packBytes requires ArrayBuffer or UInt8Array");return n.bufferToString(e)}unpackBytes(e){return n.bufferFromString(e)}}},717:(e,t,s)=>{s(954)("AnyPacket");const n=Symbol("send function");e.exports=class{constructor(e,t,s){this.peer=e,this.seq=t.seq,this.msg=t.data,this[n]=s}reply(e){this[n](e,this.seq)}}},155:(e,t,s)=>{const n=s(954)("AnyPeer"),r=s(501),i=s(267),o=s(558),c=s(717),a=s(555),h=Symbol("private protocol"),u=Symbol("packets"),l=Symbol("links"),d=s(20),p=function(e){return!0===e||!1===e||"[object Boolean]"===toString.call(e)};e.exports=class extends i{constructor(e){super(),this[l]={},this[h]=e,this[u]={},this.id=e.peerID,this.connectionID=e.connectionID,this.options=e.options;const t={get:(e,s)=>{const n=e[s];return null!=n?n:(e.path||(e.path=[]),e.path.push(s),new Proxy(e,{get:t.get,apply:(e,t,s)=>{let n=e.path;return e.path=[],new Promise(((e,t)=>{let i=[];for(let e in s)d.isBuffer(s[e])&&(s[e]=a.packBytes(s[e]),i.push(e));const c=o.data({type:r.INTERNAL_PACKET_TYPE.RPC,method:n,params:s||null,bin:i}).setType(r.PACKET_TYPE.INTERNAL);this._send(c,!0).then((s=>{if(s.msg.error)t(s.msg);else{let t=s.msg.result;s.msg.bin&&(t=a.unpackBytes(t)),e(t)}})).catch((e=>{t(c.msg)}))}))}}))}};this.rpc=new Proxy((()=>{}),t),e.on("internal",this.onInternalComs.bind(this)),e.on("message",this.onMessage.bind(this)),e.on("e2e",(()=>{this.onE2E()})),e.on("disconnected",((e,t)=>{this.emit("disconnected",e,t)}))}isProxy(){return this[h].isProxy()}addLink(e){this[l][e.id]=e}removeLink(e){delete this[l][e.id]}getLinks(){return this[l]}e2e(){this[h].e2e()}isE2EEnabled(){return this[h].hasE2EEnabled()}send(e,t,s){const n=o.data(e).setType(r.PACKET_TYPE.LINK);return this._send(n,t,s)}forward(e){this[h].forward(e)}sendInternal(e,t,s){const n=o.data(e).setType(r.PACKET_TYPE.INTERNAL);return this._send(n,t,s)}onMessage(e,t){t.seq<0?this._resolveReply(t)||n("Dropped reply "+t.seq+". Delivered after Timeout"):this.emit("message",new c(this,t,this.send.bind(this)))}onE2E(){this.emit("e2e",this)}onInternalComs(e,t){t.seq<0?this._resolveReply(t)||n("Dropped reply "+t.seq+". Delivered after Timeout"):t.type==r.PACKET_TYPE.INTERNAL?this.emit("internal",new c(this,t,this.sendInternal.bind(this))):n("Dropped internal packet!",t)}disconnect(e){for(let e in this[u])clearTimeout(this[u][e].timeout),this[u][e].reject("Peer disconnected!");this[u]={},this[h].disconnect(e)}_send(e,t,s){return new Promise(((n,r)=>{this[h].isConnected()?(!p(t)&&t&&t>0&&e.setReplyTo(t),this[h].send(e),p(t)&&!0===t&&(this[u][e.seq]={time:(new Date).getTime(),resolve:n,reject:r,timeout:setTimeout((()=>{if(this[u][e.seq]){let t=this[u][e.seq];delete this[u][e.seq],this.disconnect("Missed reply timeout! Packet Type: "+o.TYPE._string(e.type)+" - "+e.seq),t.reject("Timeout!")}}),s||this[h].options.replyTimeout)})):r("Cannot send message. Peer is disconnected")}))}_recvForward(e){this[h].onPacket(this[h].peer,e.msg)}_resolveReply(e){if(e.seq*=-1,this[u][e.seq]){const t=this[u][e.seq];return delete this[u][e.seq],clearTimeout(t.timeout),t.resolve(new c(this,e,(()=>{n("Cannot reply to a reply packet!")}))),!0}return!1}}},288:(e,t,s)=>{const n=s(954)("AnyProtocol"),r=s(267),i=s(373),o=s(558),c=s(661),a=s(555),h=s(501),u=Symbol("secret key"),l=Symbol("private key"),d=Symbol("nonce"),p=Symbol("heartbeat timer"),T=Symbol("heartbeats missed"),E=Symbol("heartbeat ponged");e.exports=class extends r{constructor(e,t,s){super(),this._seq=0,this[u]=null,this[l]=null,this[d]=null,this[p]=0,this[T]=0,this[E]=!0,this.peerID=t.id,this.peer=t,this.options=Object.assign({replyTimeout:3e4,heartbeatInterval:5e3},s),this.connectionID=this.peer.connectionID,this.anysocket=e,this._packetQueue=i(this,this.processPacketQueue.bind(this),1),this._linkPacketQueue=i(this,this.processLinkPacketQueue.bind(this),1),this._recvPacketQueue=i(this,this.processRecvPacketQueue.bind(this),1),this._recvLinkPacketQueue=i(this,this.processRecvLinkPacketQueue.bind(this),1),this._packets={},this.changeState(h.PROTOCOL_STATES.ESTABLISHED),this.ENCRYPTION_STATE=h.PROTOCOL_ENCRYPTION.PLAIN,this.peer.on("message",((e,t)=>{this._recvPacketQueue.push({peer:e,recv:t,state:this.ENCRYPTION_STATE})})),this.peer.isClient()&&!this.peerID&&(this.changeState(h.PROTOCOL_STATES.AUTHING),this.send(o.data({id:this.anysocket.id}).setType(o.TYPE.AUTH))),this.peerID&&this.changeState(h.PROTOCOL_STATES.CONNECTED)}isProxy(){return!!this.peer.isProxy}isConnected(){return this.state!=h.PROTOCOL_STATES.DISCONNECTED}send(e){return 0==e.seq&&e.setSeq(this._getSeq()),e.type!=o.TYPE.HEARTBEAT&&this._heartbeat(),new Promise(((t,s)=>{const n=e=>{this.disconnect(e),s(e)};this.isLINKMessage(e.type)?this._linkPacketQueue.push({packet:e,resolve:t,reject:n}):this._send(e,t,n)}))}_send(e,t,s){n(this.peerID,">>>>",o.TYPE._string(e.type),e.seq),e.serialize(h.MAX_PACKET_SIZE,this._encrypt.bind(this)).then((e=>{for(let n=0;n<e.length;n++){const r={packet:e[n],reject:s};n==e.length-1&&(r.resolve=t),this._packetQueue.push(r)}})).catch(s)}forward(e){return new Promise(((t,s)=>{this._packetQueue.push({packet:this._encodeForwardPacket(e.to,e.from,e.msg),resolve:t,reject:s})}))}hasE2EEnabled(){return!!this[l]}e2e(){c.generateAESKey().then((e=>{this[l]=e.private,this[d]=e.nonce,this.changeState(h.PROTOCOL_STATES.SWITCHING_PROTOCOL),this.send(o.data({type:h.PROTOCOL_ENCRYPTION.E2EE,key:e.public,nonce:e.nonce}).setType(o.TYPE.SWITCH))})).catch((e=>{this.disconnect(e)}))}onPacket(e,t,s){return this._heartbeat(),new Promise(((e,r)=>{let i=!0;if(o.isForwardPacket(t))this.emit("forward",this.peerID,this._decodeForwardPacket(t)),e();else{let r=o.getSeq(t);this._packets[r]||(this._packets[r]=o.buffer());let a=this._packets[r];a.deserialize(t,s,this._decrypt.bind(this)).then((t=>{if(n(this.peerID,"<<<<",o.TYPE._string(a.type),a.seq),t){switch(delete this._packets[r],this.state){case h.PROTOCOL_STATES.ESTABLISHED:if(a.type==o.TYPE.AUTH){if(i=!1,!a.data.id)return this.disconnect("Invalid Auth Packet!");this.peerID=a.data.id,this.send(o.data({id:this.anysocket.id}).setType(o.TYPE.AUTH)).then((()=>{this.changeState(h.PROTOCOL_STATES.CONNECTED),this.emit("ready",this)})),e()}break;case h.PROTOCOL_STATES.AUTHING:if(a.type==o.TYPE.AUTH){if(i=!1,this.changeState(h.PROTOCOL_STATES.CONNECTED),!a.data.id)return this.disconnect("Invalid Auth Packet!");this.peerID=a.data.id,this.emit("ready",this),e()}break;case h.PROTOCOL_STATES.CONNECTED:a.type==o.TYPE.LINK?(i=!1,this.emit("message",this,{seq:a.seq,data:a.data}),e()):a.type==o.TYPE.INTERNAL?(i=!1,this.emit("internal",this,{seq:a.seq,type:a.type,data:a.data}),e()):a.type==o.TYPE.SWITCH?(i=!1,c.generateAESKey().then((t=>(this[l]=t.private,this[d]=a.data.nonce+t.nonce,c.getAESSessionKey(this[d],this.peerID,0).then((s=>(this[d]=s,c.computeAESsecret(this[l],a.data.key).then((s=>{this[u]=s,this.send(o.data({type:h.PROTOCOL_ENCRYPTION.E2EE,key:t.public,nonce:t.nonce}).setType(o.TYPE.SWITCH)).then((()=>{this.ENCRYPTION_STATE=h.PROTOCOL_ENCRYPTION.E2EE,this.changeState(h.PROTOCOL_STATES.CONNECTED),this.emit("e2e",this),e()}))})))))))).catch((e=>{this.disconnect(e)}))):a.type==o.TYPE.HEARTBEAT&&(i=!1,this._heartbeatPong(a.data),e());break;case h.PROTOCOL_STATES.SWITCHING_PROTOCOL:a.type==o.TYPE.SWITCH&&(i=!1,this[d]=this[d]+a.data.nonce,c.getAESSessionKey(this[d],this.anysocket.id,0).then((t=>(this[d]=t,c.computeAESsecret(this[l],a.data.key).then((t=>{this[u]=t,this.ENCRYPTION_STATE=h.PROTOCOL_ENCRYPTION.E2EE,this.changeState(h.PROTOCOL_STATES.CONNECTED),this.emit("e2e",this),e()}))))).catch((e=>{this.disconnect(e)})));break;case h.PROTOCOL_STATES.DISCONNECTED:i=!1,e()}i&&(console.log("Invalid packet received! RECV:",a),e())}else e()}))}}))}changeState(e){switch(this.state=e,this.state){case h.PROTOCOL_STATES.ESTABLISHED:case h.PROTOCOL_STATES.AUTHING:this._linkPacketQueue.pause(),this._recvLinkPacketQueue.pause();break;case h.PROTOCOL_STATES.CONNECTED:this._linkPacketQueue.resume(),this._recvLinkPacketQueue.resume();break;case h.PROTOCOL_STATES.SWITCHING_PROTOCOL:this._linkPacketQueue.pause(),this._recvLinkPacketQueue.pause();break;case h.PROTOCOL_STATES.DISCONNECTED:this._packetQueue.pause(),this._packetQueue.kill(),this._linkPacketQueue.pause(),this._linkPacketQueue.kill(),this._recvPacketQueue.pause(),this._recvPacketQueue.kill(),this._recvLinkPacketQueue.pause(),this._recvLinkPacketQueue.kill()}}disconnect(e){this.changeState(h.PROTOCOL_STATES.DISCONNECTED),this._heartbeat(),this.isProxy()?this.anysocket.unproxy(this.peer.id,this.peer.socket.id,e):this.peer.disconnect(e)}processPacketQueue(e,t){this.peer.send(e.packet).then((()=>{e.resolve&&e.resolve(),t(null,null)})).catch((s=>{e.reject(s),this._packetQueue.kill(),t(null,null)}))}processLinkPacketQueue(e,t){this._send(e.packet,e.resolve,e.reject),t(null,null)}processRecvPacketQueue(e,t){o.isForwardPacket(e.recv)?(this.emit("forward",this.peerID,this._decodeForwardPacket(e.recv)),t(null,null)):this.isLINKMessage(o.getType(e.recv))?(this._recvLinkPacketQueue.push(e),t(null,null)):this.onPacket(e.peer,e.recv,e.state).then((()=>{t(null,null)}))}processRecvLinkPacketQueue(e,t){this.onPacket(e.peer,e.recv,e.state).then((()=>{t(null,null)}))}_encrypt(e,t){return new Promise((s=>{switch(this.ENCRYPTION_STATE){case h.PROTOCOL_ENCRYPTION.PLAIN:s(e);break;case h.PROTOCOL_ENCRYPTION.E2EE:c.getAESSessionKey(this[u],this[d],t).then((t=>c.encryptAES(t,e).then(s))).catch((e=>{this.disconnect(e)}));break;default:throw new Error("Encryption state '"+this.ENCRYPTION_STATE+"' not implemented!")}}))}_decrypt(e,t,s){return new Promise((n=>{switch(e){case h.PROTOCOL_ENCRYPTION.PLAIN:n(t);break;case h.PROTOCOL_ENCRYPTION.E2EE:c.getAESSessionKey(this[u],this[d],s).then((e=>c.decryptAES(e,t).then(n))).catch((e=>{this.disconnect(e)}));break;default:throw new Error("Encryption state '"+this.ENCRYPTION_STATE+"' not implemented!")}}))}_encodeForwardPacket(e,t,s){return o.TYPE.FORWARD+a.packHex(e)+a.packHex(t)+s}_decodeForwardPacket(e){return{to:a.unpackHex(e.substr(1,16)),from:a.unpackHex(e.substr(17,16)),msg:e.substr(33)}}_getSeq(){return this._seq>=32767&&(this._seq=0),this._seq++,this._seq}_heartbeat(){this.isProxy()||(clearTimeout(this[p]),this.state!=h.PROTOCOL_STATES.DISCONNECTED&&(this[p]=setTimeout((()=>{if(!this[E])return this[T]++,this[T]>=2?void this.disconnect("Missed Heartbeats"):void this._heartbeat();this[T]=0,this[E]=!1;const e=o.data(1).setType(o.TYPE.HEARTBEAT);this.send(e).catch((e=>{n("Heartbeat Error:",e),this.disconnect(e)}))}),this.options.heartbeatInterval)))}_heartbeatPong(e){if(1==e){const e=o.data(2).setType(o.TYPE.HEARTBEAT);this.send(e).catch((e=>{n("Heartbeat Error:",e),this.disconnect(e)}))}else this[E]=!0}isLINKMessage(e){return-1!=[o.TYPE.INTERNAL,o.TYPE.LINK].indexOf(e)}}},100:(e,t,s)=>{const n=s(954)("AnySocket"),r=s(69),i=s(267),o=s(661),c=s(20),a=s(501),h=s(69),u=s(117),l=Symbol("peers connected"),d=Symbol("ready peers"),p=Symbol("transports"),T=Symbol("onForward"),E=Symbol("onPeerConnected"),y=Symbol("onPeerReady"),m=Symbol("onPeerDisconnected"),f=Symbol("onPeerInternalMessage"),P=Symbol("findTransport"),w=Symbol("http bundle js"),k=s(155),b=s(288),C=s(366);class S extends i{constructor(){return super(),this.id=o.uuidv4(),this.http=new u,n("AnySocketID:",this.id),this[l]={},this[d]={},this[p]={},"undefined"==typeof window&&(this[w]=r.readFileSync("//../../dist/anysocket.bundle.js")),this}filter(e){}broadcast(e,t){return t=t||!1,new Promise(((s,n)=>{const r=[];for(let i in this[d])i=this[d][i],r.push(i.send(e,t)),Promise.all(r).then(s).catch(n)}))}setRPC(e){this.rpc=e}canProxy(e,t){return!1}proxy(e,t){return new Promise(((s,n)=>{e!=t&&e!=this.id?this[d][t].isProxy()?n("Cannot proxy via a proxy! atm... :)"):this[d][t].sendInternal({type:a.INTERNAL_PACKET_TYPE.PROXY,action:"proxy",id:e},!0).then((r=>{if(r.msg.ok&&!this[d][e]){let n=new b(this,new C(!0,this.id,e,this[d][t]),this[d][t].options);this[y](n),s(this[d][e])}else n("Cannot proxy!")})).catch(n):n("Cannot proxy loopback!")}))}unproxy(e,t,s){s=s||"Proxy Connection Closed",this[d][e]&&this[d][e].isProxy()&&(this[d][t].sendInternal({type:a.INTERNAL_PACKET_TYPE.PROXY,action:"unproxy",id:e}),this[m](this[d][e],s))}hasPeer(e){return!!this[d][e]}hasDirectPeer(e){return!(!this[d][e]||this[d][e].isProxy())}server(e,t){return this.listen(e,t)}listen(e,t){if("number"==typeof t&&(t={port:t}),t.ip=t.ip||"0.0.0.0",!t.port)throw new Error("Invalid port!");let s=this[P](e);return s=new s("server",t),this[p][s.id]=s,s.on("connected",(e=>{this[E](e,s.options)})),s.on("disconnected",((e,t)=>{this[m](e,t)})),s.listen()}connect(e,t,s,r){r=Object.assign(r||{},{ip:t,port:s});let i=this[P](e);return i=new i("client",r),i.on("connected",(e=>{this[p][i.id]=i,this[E](e,i.options),n("Transports Added",i.id,Object.keys(this[p]).length)})),i.on("disconnected",((e,t)=>{this[p][i.id].stop(),delete this[p][i.id],this[m](e,t),n("Transports left",i.id,Object.keys(this[p]).length)})),i.connect()}stop(){return new Promise(((e,t)=>{const s=[];for(let e in this[p])s.push(this[p][e].stop());Promise.all(s).then((()=>{this[l]={},this[d]={},this[p]={},e()})).catch((e=>{throw e}))}))}[P](e){for(let t in S.Transport)if(S.Transport.hasOwnProperty(t)&&S.Transport[t].scheme()==e)return S.Transport[t];throw new Error("Invalid scheme '"+e+"'")}[E](e,t){if(n("Peer connected"),"http"==e.type)return void e.on("message",((e,t)=>{let s=new h(e,t);if("/@anysocket"==s.url)return s.body(this[w]),void s.end();e.body=[],e.on("error",(e=>{console.log("Err",e)})).on("data",(t=>{e.body.push(t)})).on("end",(()=>{e.body=Buffer.concat(e.body).toString(),s.header("ANYSOCKET-ID",this.id),this.http._process(s),this.emit("http",s,e,t)}))}));const s=new b(this,e,t);this[l][e.connectionID]=s,s.on("forward",this[T].bind(this)),s.once("ready",(e=>{this[y](e)}))}[T](e,t){if(this.id==t.to){if(!this[d][t.from])return void this[d][e].disconnect("Invalid forward packet! Client doesn't exist!");this[d][t.from]._recvForward(t)}else this.hasDirectPeer(t.to)?this[d][t.to].forward(t):console.error("FORWARD ERROR! We do not have the peer",t.to)}[y](e){n("Peer ready");const t=new k(e);this[d][e.peerID]=t,t.on("message",(e=>{this.emit("message",e)})),t.on("e2e",(e=>{this.emit("e2e",e)})),t.on("internal",this[f].bind(this)),this.emit("connected",t)}[m](e,t){n("Peer disconnected",t,e.id);let s=null;if(this[l][e.connectionID]&&(s=this[l][e.connectionID].peerID,delete this[l][e.connectionID]),this[d][e.id]&&(s=e.id),s){const e=this[d][s];delete this[d][s];const n=e.getLinks();for(let t in n)n[t].sendInternal({type:a.INTERNAL_PACKET_TYPE.NETWORK,action:"disconnected",id:e.id}).catch((()=>{})),e.removeLink(n[t]),this[d][t]&&this[d][t].removeLink(e);e.disconnect(),this.emit("disconnected",e,t)}}[f](e){if(e.msg.type==a.INTERNAL_PACKET_TYPE.NETWORK){if("connected"==e.msg.action){if(!this[d][e.msg.id]){let t=new b(this,new C(!1,this.id,e.msg.id,this[d][e.peer.id]));this[y](t)}}else if("disconnected"==e.msg.action){if(!this[d][e.msg.id])return void e.peer.disconnect("Invalid proxy request!");this[m](this[d][e.msg.id],"Proxy Connection Closed")}}else if(e.msg.type==a.INTERNAL_PACKET_TYPE.PROXY){if("proxy"==e.msg.action){if(!this.canProxy(e.peer.id,e.msg.id)||!this[d][e.msg.id])return void e.peer.disconnect("Invalid proxy request!");if(this[d][e.msg.id].isProxy())return void e.reply({ok:!1});this[d][e.msg.id].addLink(this[d][e.peer.id]),this[d][e.peer.id].addLink(this[d][e.msg.id]),this[d][e.msg.id].sendInternal({type:a.INTERNAL_PACKET_TYPE.NETWORK,action:"connected",id:e.peer.id}),e.reply({ok:!0})}else if("unproxy"==e.msg.action){if(!this.canProxy(e.peer.id,e.msg.id)||!this[d][e.msg.id])return void e.peer.disconnect("Invalid proxy request!");this[d][e.msg.id].removeLink(this[d][e.peer.id]),this[d][e.peer.id].removeLink(this[d][e.msg.id]),this[d][e.msg.id].sendInternal({type:a.INTERNAL_PACKET_TYPE.NETWORK,action:"disconnected",id:e.peer.id})}}else if(e.msg.type==a.INTERNAL_PACKET_TYPE.RPC){let t=!1,s=this.rpc;for(let n in e.msg.method)if(t=s,s=s[e.msg.method[n]],!s)break;if(t&&s&&"function"==typeof s)try{for(let t of e.msg.bin)e.msg.params[t]=S.Packer.unpack(e.msg.params[t]);Promise.resolve(s.apply(t,e.msg.params)).then((t=>{let s=!1;c.isBuffer(t)&&(t=S.Packer.pack(t),s=!0),e.reply({result:t,bin:s})})).catch((t=>{e.reply({error:t,code:500})}))}catch(t){e.reply({error:t.message,code:500})}else e.reply({error:"Method not found",code:404})}else e.msg.type==a.INTERNAL_PACKET_TYPE.RPC_NOTIFY?console.log("RPC_NOTIFY",e.msg):e.peer.disconnect("Invalid internal message")}}e.exports=S},558:(e,t,s)=>{const n=s(555),r=s(501),i=e=>n.unpackInt16(e.substr(2,2)),o=e=>parseInt(e.substr(1,1)),c={};class a{constructor(e){this.seq=0,this.type=0,this.buffer=[],this.data=null,e&&(this.data=e)}setType(e){return this.type=e,this}setSeq(e){return this.seq=e,this}setReplyTo(e){return e&&(this.seq=-e),this}async serialize(e,t){e=e||Number.MAX_SAFE_INTEGER;let s=[JSON.stringify(this.data)];s[0].length>e&&(c[e]=c[e]||new RegExp("(.{1,"+e+"})","g"),s=s[0].match(c[e]));for(let e=0;e<s.length;e++)s[e]=(e==s.length-1?r.PACKET_LENGTH.FULL:r.PACKET_LENGTH.PARTIAL).toString()+this.type.toString()+n.packInt16(this.seq)+await t(s[e],Math.abs(this.seq));return s}async deserialize(e,t,s){s=s||(e=>Promise.resolve(e));const n=e.substr(0,1)==r.PACKET_LENGTH.FULL;if(this.type=o(e),this.seq=i(e),this.buffer.push(await s(t,e.substr(4),Math.abs(this.seq))),n){try{this.buffer=this.buffer.join("");let e=JSON.parse(this.buffer);this.buffer=[],this.data=e}catch(e){this.data=null}return!0}return!1}}e.exports={data:e=>new a(e=e||{}),buffer:()=>new a,getSeq:e=>i(e),getType:e=>o(e),isForwardPacket:e=>e.substr(0,1)==r.PACKET_TYPE.FORWARD,TYPE:r.PACKET_TYPE}},366:(e,t,s)=>{const n=s(586),r=s(162);e.exports=class extends n{constructor(e,t,s,n){super(n),this.id=s,this.anysocketID=t,this.type=e?r.TYPE.CLIENT:r.TYPE.SERVER,this.isProxy=!0,this.init()}onConnect(){}send(e){return new Promise(((t,s)=>{try{this.socket.forward({to:this.id,from:this.anysocketID,msg:e}),t()}catch(e){s(e)}}))}onDisconnect(){}}},501:e=>{const t={PACKET_TYPE:{AUTH:1,INTERNAL:2,LINK:3,SWITCH:4,HEARTBEAT:5,FORWARD:6},PACKET_LENGTH:{FULL:1,PARTIAL:2},INTERNAL_PACKET_TYPE:{NETWORK:1,PROXY:2,RPC:3,RPC_NOTIFY:4},PROTOCOL_STATES:{ESTABLISHED:0,AUTHING:1,CONNECTED:2,SWITCHING_PROTOCOL:3,DISCONNECTED:4},PROTOCOL_ENCRYPTION:{PLAIN:1,E2EE:2},MAX_PACKET_SIZE:524288};for(let e in t)t[e]._string=s=>{for(let n in t[e])if(t[e][n]==s)return n;return s};e.exports=t},510:(e,t,s)=>{const n=s(147),r=s(20);e.exports=new class{uuidv4(){return"xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g,(function(e){const t=16*Math.random()|0;return("x"==e?t:3&t|8).toString(16)}))}generateAESKey(){return new Promise((async(e,t)=>{let s=await n.createECDH("secp521r1"),i=await s.generateKeys();e({private:s,public:r.bufferToString(i),nonce:r.bufferToHex(n.randomBytes(32))})}))}computeAESsecret(e,t){return new Promise((async(s,n)=>{let i=await e.computeSecret(r.bufferFromString(t),null,"hex");i=i.substr(0,128),s(i)}))}getAESSessionKey(e,t,s){return new Promise((async(i,o)=>{t=t+"_"+s,e=await n.pbkdf2Sync(e,t,1,32,"sha256"),i(e=r.bufferToHex(e))}))}encryptAES(e,t){return new Promise(((s,i)=>{try{let i=n.randomBytes(16),o=n.createCipheriv("aes-256-cbc",r.bufferFromHex(e),i),c=o.update(t);c=Buffer.concat([c,o.final()]);let a=i.toString("hex")+c.toString("hex");this.decryptAES(e,a),s(a)}catch(e){i(e)}}))}decryptAES(e,t){return new Promise(((s,i)=>{try{let i=Buffer.from(t.substr(0,32),"hex"),o=Buffer.from(t.substr(32),"hex"),c=n.createDecipheriv("aes-256-cbc",r.bufferFromHex(e),i),a=c.update(o);a=Buffer.concat([a,c.final()]),s(a.toString())}catch(e){i(e)}}))}}},586:(e,t,s)=>{const n=s(267),r=s(661),i=s(162);e.exports=class extends n{constructor(e){super(),this.connectionID=r.uuidv4(),this.connected=!0,this.socket=e,this.type=i.TYPE.NONE,this.inited=!1}init(){this.inited||(this.inited=!0,this.onConnect(),this.emit("connected",this))}isClient(){if(this.type==i.TYPE.NONE)throw new Error("Invalid transport type!!!");return this.type==i.TYPE.CLIENT}disconnect(e){this.connected&&(this.connected=!1,this.onDisconnect(),this.emit("disconnected",this,e))}send(e){throw new Error("send() must be implemented")}onConnect(){throw new Error("onConnect() must be implemented")}onDisconnect(){throw new Error("onDisconnect() must be implemented")}}},162:(e,t,s)=>{const n=s(267),r=s(661);class i extends n{constructor(e,t){super(),this.id=r.uuidv4(),this.options=Object.assign({},t),this.type=e,this.peers=new Map,this.started=!1}listen(){return new Promise(((e,t)=>{this.started?e():this.onListen().then((()=>{this.started=!0,e()})).catch((e=>{t(e)}))}))}connect(){return new Promise(((e,t)=>{this.started?e():this.onConnect().then((()=>{this.started=!0,e()})).catch((e=>{t(e)}))}))}stop(){return new Promise(((e,t)=>{if(this.started){this.started=!1;for(const e of this.peers.values())e.disconnect("Local Connection Closed");this.onStop().then((()=>{e()})).catch((e=>{t(e)}))}else e()}))}addPeer(e){e.type=this.type,e.on("connected",(()=>{this.peers.set(e.connectionID,e),this.emit("connected",e)})),e.on("disconnected",((e,t)=>{this.peers.delete(e.connectionID),this.emit("disconnected",e,t)})),e.init()}onConnect(){throw new Error("onConnect() must be implemented")}onListen(){throw new Error("onListen() must be implemented")}onStop(){throw new Error("onStop() must be implemented")}}var o,c,a;a=()=>{throw new Error("static scheme() must be implemented")},(c="scheme")in(o=i)?Object.defineProperty(o,c,{value:a,enumerable:!0,configurable:!0,writable:!0}):o[c]=a,e.exports=i,i.TYPE={CLIENT:"client",SERVER:"server",HTTP:"http"}},818:(e,t,s)=>{const n=s(586);e.exports=class extends n{constructor(){super(),this.isLocal=!0}onConnect(){}send(e){return new Promise(((t,s)=>{try{setImmediate((()=>{this.emit("message",this,e)})),t()}catch(e){s(e)}}))}onDisconnect(){}}},870:(e,t,s)=>{const n=s(162),r=s(818);e.exports=class extends n{constructor(e,t){super(e,t)}static scheme(){return"local"}onListen(){return new Promise(((e,t)=>{this.addPeer(new r),e()}))}onConnect(){return new Promise(((e,t)=>{t("Only listening is supported!")}))}onStop(){return new Promise(((e,t)=>{e()}))}}},683:(e,t,s)=>{const n=s(586);e.exports=class extends n{onConnect(){this.socket.on("close",(()=>{this.disconnect("Remote Connection Closed")})),this.socket.on("error",(e=>{this.emit("error",this,e)})),this.socket.on("message",(e=>{this.emit("message",this,e)}))}send(e){return new Promise(((t,s)=>{try{this.socket.send(e),t()}catch(e){s(e)}}))}onDisconnect(){this.socket&&(this.socket.close(),this.socket=null)}}},866:(e,t,s)=>{const n=s(162),r=s(683),i=s(966);e.exports=class extends n{constructor(e,t){super(e,t)}static scheme(){return"ws"}onListen(){return new Promise(((e,t)=>{this.ws=new i.Server({port:this.options.port,host:this.options.ip}),this.ws.on("connection",(e=>{this.addPeer(new r(e))})),this.ws.on("error",(e=>{t(e)})),this.ws.on("listening",(()=>{e()}))}))}onConnect(){return new Promise(((e,t)=>{let s=new i("ws://"+this.options.ip+":"+this.options.port+"/");s.on("open",(t=>{this.addPeer(new r(s)),e()})),s.on("error",(e=>{t(e)}))}))}onStop(){return new Promise(((e,t)=>{this.ws&&(this.ws.close(),this.ws=null),e()}))}}},373:(e,t,s)=>{"use strict";var n=s(650);function r(e,t,s){if("function"==typeof e&&(s=t,t=e,e=null),s<1)throw new Error("fastqueue concurrency must be greater than 1");var r=n(o),c=null,a=null,h=0,u=null,l={push:function(s,n){var o=r.get();o.context=e,o.release=d,o.value=s,o.callback=n||i,o.errorHandler=u,h===l.concurrency||l.paused?a?(a.next=o,a=o):(c=o,a=o,l.saturated()):(h++,t.call(e,o.value,o.worked))},drain:i,saturated:i,pause:function(){l.paused=!0},paused:!1,concurrency:s,running:function(){return h},resume:function(){if(l.paused){l.paused=!1;for(var e=0;e<l.concurrency;e++)h++,d()}},idle:function(){return 0===h&&0===l.length()},length:function(){for(var e=c,t=0;e;)e=e.next,t++;return t},getQueue:function(){for(var e=c,t=[];e;)t.push(e.value),e=e.next;return t},unshift:function(s,n){var o=r.get();o.context=e,o.release=d,o.value=s,o.callback=n||i,h===l.concurrency||l.paused?c?(o.next=c,c=o):(c=o,a=o,l.saturated()):(h++,t.call(e,o.value,o.worked))},empty:i,kill:function(){c=null,a=null,l.drain=i},killAndDrain:function(){c=null,a=null,l.drain(),l.drain=i},error:function(e){u=e}};return l;function d(s){s&&r.release(s);var n=c;n?l.paused?h--:(a===c&&(a=null),c=n.next,n.next=null,t.call(e,n.value,n.worked),null===a&&l.empty()):0==--h&&l.drain()}}function i(){}function o(){this.value=null,this.callback=i,this.next=null,this.release=i,this.context=null,this.errorHandler=null;var e=this;this.worked=function(t,s){var n=e.callback,r=e.errorHandler,o=e.value;e.value=null,e.callback=i,e.errorHandler&&r(t,o),n.call(e.context,t,s),e.release(e)}}e.exports=r,e.exports.promise=function(e,t,s){"function"==typeof e&&(s=t,t=e,e=null);var n=r(e,(function(e,s){t.call(this,e).then((function(e){s(null,e)}),s)}),s),i=n.push,o=n.unshift;return n.push=function(e){return new Promise((function(t,s){i(e,(function(e,n){e?s(e):t(n)}))}))},n.unshift=function(e){return new Promise((function(t,s){o(e,(function(e,n){e?s(e):t(n)}))}))},n}},650:e=>{"use strict";e.exports=function(e){var t=new e,s=t;return{get:function(){var n=t;return n.next?t=n.next:(t=new e,s=t),n.next=null,n},release:function(e){s.next=e,s=e}}}}},t={};return function s(n){if(t[n])return t[n].exports;var r=t[n]={exports:{}};return e[n](r,r.exports,s),r.exports}(506)})();