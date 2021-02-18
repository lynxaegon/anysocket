var AnySocket;AnySocket=(()=>{var e={147:(e,t,s)=>{const n=window.crypto||window.msCrypto;if(!n)throw new Error("Crypto is not supported in this browser!");const i=s(20);e.exports=new class{constructor(){this.constants={RSA_PKCS1_OAEP_PADDING:1}}randomBytes(e){let t=new Uint8Array(e);for(let s=0;s<e;s+=65536)n.getRandomValues(t.subarray(s,s+Math.min(e-s,65536)));return t}generateKeyPairSync(e,t){return n.subtle.generateKey({name:"RSA-OAEP",modulusLength:t.modulusLength||4096,publicExponent:new Uint8Array([1,0,1]),hash:{name:"SHA-256"}},!0,["encrypt","decrypt"])}publicEncrypt(e,t){return new Promise((s=>{n.subtle.encrypt("RSA-OAEP",e.key,t).then((e=>{s(i.bufferToBase64(e))}))}))}privateDecrypt(e,t){return new Promise((s=>{n.subtle.decrypt("RSA-OAEP",e.key,t).then((e=>{s(i.bufferToString(e))}))}))}}},954:e=>{e.exports=()=>()=>{}},267:e=>{e.exports=class{constructor(){this.callbacks={},this.callbacks_once={}}on(e,t){this.callbacks[e]||(this.callbacks[e]=[]),this.callbacks[e].push(t)}once(e,t){this.callbacks_once[e]||(this.callbacks_once[e]=[]),this.callbacks_once[e].push(t)}emit(e,...t){let s=this.callbacks[e];s&&s.forEach((e=>e(...t))),s=this.callbacks_once[e],s&&(s.forEach((e=>e(...t))),delete this.callbacks_once[e])}}},20:e=>{e.exports={bufferFromString(e){let t=new ArrayBuffer(e.length),s=new Uint8Array(t);for(let t=0,n=e.length;t<n;t++)s[t]=e.charCodeAt(t);return t},bufferFromBase64:e=>Uint8Array.from(window.atob(e),(e=>e.charCodeAt(0))),bufferToString(e){let t="";if(e){let s=new Uint8Array(e);for(let e=0;e<s.byteLength;e++)t+=String.fromCharCode(s[e])}return t},bufferToBase64(e){let t="",s=new Uint8Array(e),n=s.byteLength;for(let e=0;e<n;e++)t+=String.fromCharCode(s[e]);return window.btoa(t)}}},966:e=>{e.exports=class{constructor(...e){this.ws=new WebSocket(...e)}on(e,t){switch(e){case"open":this.ws.onopen=t;break;case"error":this.ws.onerror=t;break;case"message":this.ws.onmessage=e=>{t(e.data)};break;case"close":this.ws.onclose=t;break;default:throw new Error("Not implemented in browser! ("+e+")")}}send(...e){this.ws.send(e)}close(){this.ws.close()}}},506:(e,t,s)=>{e.exports=s(100)},555:e=>{e.exports=new class{packInt(e){const t=new ArrayBuffer(2);return new DataView(t).setInt16(0,e,!1),String.fromCharCode.apply(String,new Uint8Array(t))}unpackInt(e){const t=new ArrayBuffer(2),s=new Uint8Array(t);for(let t in e)s[t]=e.charCodeAt(t);return new DataView(t).getInt16(0)}packHex(e){let t=[];for(let s=0,n=e.length;s<n;s+=2)t.push(parseInt(e.substr(s,2),16));return String.fromCharCode.apply(null,new Uint8Array(t))}unpackHex(e){e=this._strToUint8(e);let t="";for(let s=0;s<e.length;s++){let n=(255&e[s]).toString(16);n=1===n.length?"0"+n:n,t+=n}return t}_strToUint8(e){let t=new ArrayBuffer(1*e.length),s=new Uint8Array(t);return s.forEach(((t,n)=>{s[n]=e.charCodeAt(n)})),s}}},717:(e,t,s)=>{s(954)("AnyPacket");const n=Symbol("send function");e.exports=class{constructor(e,t,s){this.peer=e,this.seq=t.seq,this.msg=t.data,this[n]=s}reply(e){this[n](e,this.seq)}}},155:(e,t,s)=>{const n=s(954)("AnyPeer"),i=s(501),r=s(267),o=s(558),a=s(717),c=Symbol("private protocol"),h=Symbol("packets"),l=Symbol("links"),d=Symbol("heartbeat raw"),p=function(e){return!0===e||!1===e||"[object Boolean]"===toString.call(e)};e.exports=class extends r{constructor(e){super(),this[l]={},this[c]=e,this[h]={},this.id=e.peerID,this.lag=-1,this.connectionID=e.connectionID,this._heartbeat=!1,this.options=e.options;const t={get:(e,s)=>{const n=e[s];return null!=n?n:(e.path||(e.path=[]),e.path.push(s),new Proxy(e,{get:t.get,apply:(e,t,s)=>{let n=e.path;return e.path=[],new Promise(((e,t)=>{const r=o.data({type:i.INTERNAL_PACKET_TYPE.RPC,method:n,params:s||null}).setType(i.PACKET_TYPE.INTERNAL);this._send(r,!0).then((t=>{e(t.msg)})).catch((e=>{t(r.msg)}))}))}}))}};this.rpc=new Proxy((()=>{}),t),e.on("internal",this.onInternalComs.bind(this)),e.on("message",this.onMessage.bind(this)),e.on("e2e",(()=>{this.onE2E(),this.heartbeat()})),e.on("disconnected",((e,t)=>{this.emit("disconnected",e,t)}))}isProxy(){return this[c].isProxy()}heartbeat(e){if(!(this.options.heartbeatInterval<=0||this.options.heartbeatTimeout<=0))return e?new Promise(((e,t)=>{this[d]().then((()=>{e(this)})).catch((e=>{t(this,e)}))})):void(this.isProxy()||(this._heartbeat&&clearTimeout(this._heartbeat),this._heartbeat=setTimeout((()=>{this[d]().then((()=>{this.heartbeat()})).catch((()=>{}))}),this[c].options.heartbeatInterval)))}[d](){return new Promise(((e,t)=>{const s=(new Date).getTime(),r=o.data().setType(i.PACKET_TYPE.HEARTBEAT);this._send(r,!0,this[c].options.heartbeatTimeout).then((()=>{this.lag=(new Date).getTime()-s,e(),this.emit("heartbeat",this)})).catch((e=>{n("Heartbeat Error:",e),this.disconnect(e),t(e)}))}))}addLink(e){this[l][e.id]=e}removeLink(e){delete this[l][e.id]}getLinks(){return this[l]}e2e(){clearTimeout(this._heartbeat),this[c].e2e()}isE2EEnabled(){return this[c].peer.hasE2EEnabled()}send(e,t,s){const n=o.data(e).setType(i.PACKET_TYPE.LINK);return this._send(n,t,s)}forward(e){this[c].forward(e)}sendInternal(e,t,s){const n=o.data(e).setType(i.PACKET_TYPE.INTERNAL);return this._send(n,t,s)}onMessage(e,t){this.heartbeat(),t.seq<0?this._resolveReply(t)||n("Dropped reply "+t.seq+". Delivered after Timeout"):this.emit("message",new a(this,t,this.send.bind(this)))}onE2E(){this.emit("e2e",this)}onInternalComs(e,t){if(t.seq<0)this._resolveReply(t)||n("Dropped reply "+t.seq+". Delivered after Timeout");else if(t.type==i.PACKET_TYPE.HEARTBEAT){const e=o.data().setType(i.PACKET_TYPE.HEARTBEAT);this._send(e,t.seq)}else t.type==i.PACKET_TYPE.INTERNAL?(this.heartbeat(),this.emit("internal",new a(this,t,this.sendInternal.bind(this)))):n("Dropped internal packet!",t)}disconnect(e){for(let e in this[h])clearTimeout(this[h][e].timeout),this[h][e].reject("Peer disconnected!");this[h]={},clearTimeout(this._heartbeat),this[c].disconnect(e)}_send(e,t,s){return new Promise(((n,r)=>{this[c].isConnected()?(!p(t)&&t&&t>0&&e.setReplyTo(t),this[c].send(e),p(t)&&!0===t&&(this[h][e.seq]={time:(new Date).getTime(),resolve:n,reject:r,timeout:setTimeout((()=>{if(this[h][e.seq]){let t=this[h][e.seq];delete this[h][e.seq],this.disconnect("Missed reply timeout! Packet Type: "+o.TYPE.toString(e.type)),t.reject("Timeout!")}}),s||this[c].options.replyTimeout)}),e.type!=i.PACKET_TYPE.HEARTBEAT&&this.heartbeat()):r("Cannot send message. Peer is disconnected")}))}_recvForward(e){this[c].onPacket(this[c].peer,e.msg)}_resolveReply(e){if(e.seq*=-1,this[h][e.seq]){const t=this[h][e.seq];return delete this[h][e.seq],clearTimeout(t.timeout),t.resolve(new a(this,e,(()=>{n("Cannot reply to a reply packet!")}))),!0}return!1}}},288:(e,t,s)=>{const n=s(954)("AnyProtocol"),i=s(267),r=s(373),o=s(558),a=s(510),c=s(555),h=s(501);e.exports=class extends i{constructor(e,t,s){super(),this._seq=0,this.peerID=t.id,this.peer=t,this.options=Object.assign({replyTimeout:3e4,heartbeatTimeout:5e3,heartbeatInterval:5e3},s),this.connectionID=this.peer.connectionID,this.anysocket=e,this._packetQueue=r(this,this.processPacketQueue.bind(this),1),this._linkPacketQueue=r(this,this.processLinkPacketQueue.bind(this),1),this._recvPacketQueue=r(this,this.processRecvPacketQueue.bind(this),1),this._packets={},this.changeState(h.PROTOCOL_STATES.ESTABLISHED),this.ENCRYPTION_STATE=h.PROTOCOL_ENCRYPTION.PLAIN,this.peer.on("message",((e,t)=>{this._recvPacketQueue.push([e,t])})),this.peer.isClient()&&!this.peerID&&(this.changeState(h.PROTOCOL_STATES.AUTHING),this.send(o.data({id:this.anysocket.id}).setType(o.TYPE.AUTH))),this.peerID&&this.changeState(h.PROTOCOL_STATES.CONNECTED)}isProxy(){return!!this.peer.isProxy}isConnected(){return this.state!=h.PROTOCOL_STATES.DISCONNECTED}send(e){return 0==e.seq&&e.setSeq(this._getSeq()),new Promise(((t,s)=>{const n=e=>{this.disconnect(e),s(e)};-1!=[o.TYPE.INTERNAL,o.TYPE.LINK,o.TYPE.HEARTBEAT,o.TYPE.FORWARD].indexOf(e.type)&&this.state!=h.PROTOCOL_STATES.CONNECTED?this._linkPacketQueue.push({packet:e,resolve:t,reject:n}):this._send(e,t,n)}))}_send(e,t,s){n(this.peerID,">>>>",o.TYPE.toString(e.type),e.seq),e.serialize(h.MAX_PACKET_SIZE,this._encrypt.bind(this)).then((e=>{for(let n=0;n<e.length;n++){const i={packet:e[n],reject:s};n==e.length-1&&(i.resolve=t),this._packetQueue.push(i)}})).catch(s)}forward(e){return new Promise(((t,s)=>{this._packetQueue.push({packet:this._encodeForwardPacket(e.to,e.from,e.msg),resolve:t,reject:s})}))}e2e(){this.peer.hasE2EEnabled()||this.peer.generateKeys().then((()=>{this.changeState(h.PROTOCOL_STATES.SWITCHING_PROTOCOL),this.send(o.data({type:h.PROTOCOL_ENCRYPTION.E2E,key:this.peer.getPublicKey()}).setType(o.TYPE.SWITCH))}))}onPacket(e,t){return new Promise(((e,s)=>{let i=!0;if(o.isForwardPacket(t))this.emit("forward",this.peerID,this._decodeForwardPacket(t)),e();else{let s=o.getSeq(t);this._packets[s]||(this._packets[s]=o.buffer());let r=this._packets[s];r.deserialize(t,this._decrypt.bind(this)).then((t=>{if(n(this.peerID,"<<<<",o.TYPE.toString(r.type),r.seq),t){switch(delete this._packets[s],this.state){case h.PROTOCOL_STATES.ESTABLISHED:if(r.type==o.TYPE.AUTH){if(i=!1,!r.data.id)return this.disconnect("Invalid Auth Packet!");this.peerID=r.data.id,this.send(o.data({id:this.anysocket.id}).setType(o.TYPE.AUTH)).then((()=>{this.changeState(h.PROTOCOL_STATES.CONNECTED),this.emit("ready",this)})),e()}break;case h.PROTOCOL_STATES.AUTHING:if(r.type==o.TYPE.AUTH){if(i=!1,this.changeState(h.PROTOCOL_STATES.CONNECTED),!r.data.id)return this.disconnect("Invalid Auth Packet!");this.peerID=r.data.id,this.emit("ready",this),e()}break;case h.PROTOCOL_STATES.CONNECTED:r.type==o.TYPE.LINK?(i=!1,this.emit("message",this,{seq:r.seq,data:r.data}),e()):r.type==o.TYPE.INTERNAL?(i=!1,this.emit("internal",this,{seq:r.seq,type:r.type,data:r.data}),e()):r.type==o.TYPE.SWITCH?(i=!1,this.peer.generateKeys().then((()=>{let t=this.peer.getPublicKey();this.peer.setPublicKey(r.data.key).then((()=>{this.send(o.data({type:h.PROTOCOL_ENCRYPTION.E2E,key:t}).setType(o.TYPE.SWITCH)).then((()=>{this.ENCRYPTION_STATE=h.PROTOCOL_ENCRYPTION.E2E,this.changeState(h.PROTOCOL_STATES.CONNECTED),this.emit("e2e",this)})),this.changeState(h.PROTOCOL_STATES.SWITCHING_PROTOCOL),e()}))}))):r.type==o.TYPE.HEARTBEAT&&(i=!1,this.emit("internal",this,{seq:r.seq,type:r.type,data:r.data}),e());break;case h.PROTOCOL_STATES.SWITCHING_PROTOCOL:r.type==o.TYPE.SWITCH&&(i=!1,this.peer.setPublicKey(r.data.key).then((()=>{this.ENCRYPTION_STATE=h.PROTOCOL_ENCRYPTION.E2E,this.changeState(h.PROTOCOL_STATES.CONNECTED),this.emit("e2e",this),e()})));break;case h.PROTOCOL_STATES.DISCONNECTED:i=!1,e()}i&&n("Invalid packet received! RECV:",r)}else e()}))}}))}changeState(e){switch(this.state=e,this.state){case h.PROTOCOL_STATES.ESTABLISHED:case h.PROTOCOL_STATES.AUTHING:this._linkPacketQueue.pause();break;case h.PROTOCOL_STATES.CONNECTED:this._linkPacketQueue.resume();break;case h.PROTOCOL_STATES.SWITCHING_PROTOCOL:this._linkPacketQueue.pause();break;case h.PROTOCOL_STATES.DISCONNECTED:this._packetQueue.pause(),this._packetQueue.kill(),this._linkPacketQueue.pause(),this._linkPacketQueue.kill()}}disconnect(e){this.changeState(h.PROTOCOL_STATES.DISCONNECTED),this.isProxy()?this.anysocket.unproxy(this.peer.id,this.peer.socket.id,e):this.peer.disconnect(e)}processPacketQueue(e,t){this.peer.send(e.packet).then((()=>{e.resolve&&e.resolve(),t(null,null)})).catch((s=>{e.reject(s),this._packetQueue.kill(),t(null,null)}))}processLinkPacketQueue(e,t){this._send(e.packet,e.resolve,e.reject),t(null,null)}processRecvPacketQueue(e,t){this.onPacket(...e).then((()=>{t(null,null)}))}_encrypt(e){return new Promise((t=>{switch(this.ENCRYPTION_STATE){case h.PROTOCOL_ENCRYPTION.PLAIN:case h.PROTOCOL_ENCRYPTION.AES:t(e);break;case h.PROTOCOL_ENCRYPTION.E2E:a.encryptRSA(this.peer.getPublicKey(),e).then(t).catch((e=>{this.disconnect(e)}))}}))}_decrypt(e){return new Promise((t=>{switch(this.ENCRYPTION_STATE){case h.PROTOCOL_ENCRYPTION.PLAIN:case h.PROTOCOL_ENCRYPTION.AES:t(e);break;case h.PROTOCOL_ENCRYPTION.E2E:a.decryptRSA(this.peer.getPrivateKey(),e).then(t).catch((e=>{this.disconnect(e)}))}}))}_encodeForwardPacket(e,t,s){return o.TYPE.FORWARD+c.packHex(e)+c.packHex(t)+s}_decodeForwardPacket(e){return{to:c.unpackHex(e.substr(1,16)),from:c.unpackHex(e.substr(17,16)),msg:e.substr(33)}}_getSeq(){return this._seq>=32767&&(this._seq=0),this._seq++,this._seq}}},100:(e,t,s)=>{const n=s(954)("AnySocket"),i=s(267),r=s(510),o=s(501),a=Symbol("peers connected"),c=Symbol("ready peers"),h=Symbol("transports"),l=Symbol("onForward"),d=Symbol("onPeerConnected"),p=Symbol("onPeerReady"),u=Symbol("onPeerDisconnected"),T=Symbol("onPeerInternalMessage"),E=Symbol("findTransport"),P=s(155),y=s(288),m=s(366);class C extends i{constructor(){return super(),this.id=r.uuidv4(),n("AnySocketID:",this.id),this[a]={},this[c]={},this[h]={},this}filter(e){}send(e,t){return t=t||!1,new Promise(((s,n)=>{const i=[];for(let r in this[c])r=this[c][r],i.push(r.send(e,t)),Promise.all(i).then(s).catch(n)}))}setRPC(e){this.rpc=e}canProxy(e,t){return!1}proxy(e,t){return new Promise(((s,n)=>{e!=t&&e!=this.id?this[c][t].isProxy()?n("Cannot proxy via a proxy! atm... :)"):this[c][t].sendInternal({type:o.INTERNAL_PACKET_TYPE.PROXY,action:"proxy",id:e},!0).then((i=>{if(i.msg.ok&&!this[c][e]){let n=new y(this,new m(!0,this.id,e,this[c][t]),this[c][t].options);this[p](n),s(this[c][e])}else n("Cannot proxy!")})).catch(n):n("Cannot proxy loopback!")}))}unproxy(e,t,s){s=s||"Proxy Connection Closed",this[c][e]&&this[c][e].isProxy()&&(this[c][t].sendInternal({type:o.INTERNAL_PACKET_TYPE.PROXY,action:"unproxy",id:e}),this[u](this[c][e],s))}hasPeer(e){return!!this[c][e]}hasDirectPeer(e){return!(!this[c][e]||this[c][e].isProxy())}server(e,t){return this.listen(e,t)}listen(e,t){if("number"==typeof t&&(t={port:t}),t.ip=t.ip||"0.0.0.0",!t.port)throw new Error("Invalid port!");let s=this[E](e);return s=new s("server",t),this[h][s.id]=s,s.on("connected",(e=>{this[d](e,s.options)})),s.on("disconnected",((e,t)=>{this[u](e,t)})),s.listen()}connect(e,t,s,i){i=Object.assign(i||{},{ip:t,port:s});let r=this[E](e);return r=new r("client",i),r.on("connected",(e=>{this[h][r.id]=r,this[d](e,r.options),n("Transports Added",r.id,Object.keys(this[h]).length)})),r.on("disconnected",((e,t)=>{this[h][r.id].stop(),delete this[h][r.id],this[u](e,t),n("Transports left",r.id,Object.keys(this[h]).length)})),r.connect()}stop(){return new Promise(((e,t)=>{const s=[];for(let e in this[h])s.push(this[h][e].stop());Promise.all(s).then((()=>{this[a]={},this[c]={},this[h]={},e()})).catch((e=>{throw e}))}))}[E](e){for(let t in C.Transport)if(C.Transport.hasOwnProperty(t)&&C.Transport[t].scheme()==e)return C.Transport[t];throw new Error("Invalid scheme '"+e+"'")}[d](e,t){n("Peer connected");const s=new y(this,e,t);this[a][e.connectionID]=s,s.on("forward",this[l].bind(this)),s.once("ready",(e=>{this[p](e)}))}[l](e,t){if(this.id==t.to){if(!this[c][t.from])return void this[c][e].disconnect("Invalid forward packet! Client doesn't exist!");this[c][t.from]._recvForward(t)}else this.hasDirectPeer(t.to)?this[c][t.to].forward(t):console.error("FORWARD ERROR! We do not have the peer",t.to)}[p](e){n("Peer ready");const t=new P(e);this[c][e.peerID]=t,t.heartbeat(),t.on("message",(e=>{this.emit("message",e)})),t.on("e2e",(e=>{this.emit("e2e",e)})),t.on("heartbeat",(e=>{this.emit("heartbeat",e)})),t.on("internal",this[T].bind(this)),this.emit("connected",t)}[u](e,t){n("Peer disconnected",t,e.id);let s=null;if(this[a][e.connectionID]&&(s=this[a][e.connectionID].peerID,delete this[a][e.connectionID]),this[c][e.id]&&(s=e.id),s){const e=this[c][s];delete this[c][s];const n=e.getLinks();for(let t in n)n[t].sendInternal({type:o.INTERNAL_PACKET_TYPE.NETWORK,action:"disconnected",id:e.id}).catch((()=>{})),e.removeLink(n[t]),this[c][t]&&this[c][t].removeLink(e);e.disconnect(),this.emit("disconnected",e,t)}}[T](e){if(e.msg.type==o.INTERNAL_PACKET_TYPE.NETWORK){if("connected"==e.msg.action){if(!this[c][e.msg.id]){let t=new y(this,new m(!1,this.id,e.msg.id,this[c][e.peer.id]));this[p](t)}}else if("disconnected"==e.msg.action){if(!this[c][e.msg.id])return void e.peer.disconnect("Invalid proxy request!");this[u](this[c][e.msg.id],"Proxy Connection Closed")}}else if(e.msg.type==o.INTERNAL_PACKET_TYPE.PROXY){if("proxy"==e.msg.action){if(!this.canProxy(e.peer.id,e.msg.id)||!this[c][e.msg.id])return void e.peer.disconnect("Invalid proxy request!");if(this[c][e.msg.id].isProxy())return void e.reply({ok:!1});this[c][e.msg.id].addLink(this[c][e.peer.id]),this[c][e.peer.id].addLink(this[c][e.msg.id]),this[c][e.msg.id].sendInternal({type:o.INTERNAL_PACKET_TYPE.NETWORK,action:"connected",id:e.peer.id}),e.reply({ok:!0})}else if("unproxy"==e.msg.action){if(!this.canProxy(e.peer.id,e.msg.id)||!this[c][e.msg.id])return void e.peer.disconnect("Invalid proxy request!");this[c][e.msg.id].removeLink(this[c][e.peer.id]),this[c][e.peer.id].removeLink(this[c][e.msg.id]),this[c][e.msg.id].sendInternal({type:o.INTERNAL_PACKET_TYPE.NETWORK,action:"disconnected",id:e.peer.id})}}else if(e.msg.type==o.INTERNAL_PACKET_TYPE.RPC){let t=!1,s=this.rpc;for(let n in e.msg.method)if(t=s,s=s[e.msg.method[n]],!s)break;if(t&&s&&"function"==typeof s)try{Promise.resolve(s.apply(t,e.msg.params)).then((t=>{e.reply(t)})).catch((t=>{e.reply({error:t,code:500})}))}catch(t){e.reply({error:t.message,code:500})}else e.reply({error:"Method not found",code:404})}else e.msg.type==o.INTERNAL_PACKET_TYPE.RPC_NOTIFY?console.log("RPC_NOTIFY",e.msg):e.peer.disconnect("Invalid internal message")}}C.Transport={LOCAL:s(870),WS:s(866)},C.Utils=s(510),e.exports=C},558:(e,t,s)=>{const n=s(555),i=s(501),r=(Symbol("buffer"),e=>n.unpackInt(e.substr(2,2))),o={};class a{constructor(e){this.seq=0,this.type=0,this.buffer=[],this.data=null,e&&(this.data=e)}setType(e){return this.type=e,this}setSeq(e){return this.seq=e,this}setReplyTo(e){return e&&(this.seq=-e),this}async serialize(e,t){e=e||Number.MAX_SAFE_INTEGER;let s=[JSON.stringify(this.data)];s[0].length>e&&(o[e]=o[e]||new RegExp("(.{1,"+e+"})","g"),s=s[0].match(o[e]));for(let e=0;e<s.length;e++)s[e]=(e==s.length-1?i.PACKET_LENGTH.FULL:i.PACKET_LENGTH.PARTIAL).toString()+this.type.toString()+n.packInt(this.seq)+await t(s[e]);return s}async deserialize(e,t){t=t||(e=>Promise.resolve(e));const s=e.substr(0,1)==i.PACKET_LENGTH.FULL;if(this.type=e.substr(1,1),this.seq=r(e),this.buffer.push(await t(e.substr(4))),s){try{this.buffer=this.buffer.join("");let e=JSON.parse(this.buffer);this.buffer=[],this.data=e}catch(e){this.data=null}return!0}return!1}}e.exports={data:e=>new a(e=e||{}),buffer:()=>new a,getSeq:e=>r(e),isForwardPacket:e=>e.substr(0,1)==i.PACKET_TYPE.FORWARD,TYPE:i.PACKET_TYPE}},366:(e,t,s)=>{const n=s(586),i=s(162);e.exports=class extends n{constructor(e,t,s,n){super(n),this.id=s,this.anysocketID=t,this.type=e?i.TYPE.CLIENT:i.TYPE.SERVER,this.isProxy=!0,this.init()}onConnect(){}send(e){return new Promise(((t,s)=>{try{this.socket.forward({to:this.id,from:this.anysocketID,msg:e}),t()}catch(e){s(e)}}))}onDisconnect(){}}},501:function(e){const t={PACKET_TYPE:{AUTH:1,INTERNAL:2,LINK:3,SWITCH:4,HEARTBEAT:5,FORWARD:6},PACKET_LENGTH:{FULL:1,PARTIAL:2},INTERNAL_PACKET_TYPE:{NETWORK:1,PROXY:2,RPC:3,RPC_NOTIFY:4},PROTOCOL_STATES:{ESTABLISHED:0,AUTHING:1,CONNECTED:2,SWITCHING_PROTOCOL:3,DISCONNECTED:4},PROTOCOL_ENCRYPTION:{PLAIN:1,E2E:2,AES:3},MAX_PACKET_SIZE:4e3};for(let e in t)t[e].toString=(e=>{if("number"==typeof e){e=parseInt(e);for(let t in this)if("number"==typeof this[t]&&this[t]==e)return t}return e}).bind(e);e.exports=t},510:(e,t,s)=>{const n=s(147),i=s(20);e.exports=new class{uuidv4(){return"xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g,(function(e){const t=16*Math.random()|0;return("x"==e?t:3&t|8).toString(16)}))}certificates(e){return new Promise((t=>{Promise.resolve(n.generateKeyPairSync("rsa",{modulusLength:e,publicKeyEncoding:{type:"spki",format:"pem"},privateKeyEncoding:{type:"pkcs8",format:"pem"}})).then((e=>{"undefined"!=typeof window?window.crypto.subtle.exportKey("spki",e.publicKey).then((s=>{let n=window.btoa(String.fromCharCode(...new Uint8Array(s)));n=n.match(/.{1,64}/g).join("\n"),n="-----BEGIN PUBLIC KEY-----\n"+n+"\n-----END PUBLIC KEY-----",t({public:n,private:e.privateKey})})):t({public:e.publicKey,private:e.privateKey})}))}))}convertPemToBinary(e){let t=e.replace(/\n/g,"").replace("-----BEGIN PUBLIC KEY-----","").replace("-----END PUBLIC KEY-----","");return i.bufferFromBase64(t)}importKey(e){return new Promise((t=>{"undefined"!=typeof window?window.crypto.subtle.importKey("spki",this.convertPemToBinary(e),{name:"RSA-OAEP",hash:{name:"SHA-256"}},!1,["encrypt"]).then(t):t(e)}))}encryptRSA(e,t){return new Promise(((s,r)=>{Promise.resolve(n.publicEncrypt({key:e,padding:n.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:"sha256"},i.bufferFromString(t))).then((e=>{s(e.toString("base64"))})).catch(r)}))}decryptRSA(e,t){return new Promise(((s,r)=>{Promise.resolve(n.privateDecrypt({key:e,padding:n.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:"sha256"},i.bufferFromBase64(t))).then((e=>{s(e.toString())})).catch(r)}))}}},586:(e,t,s)=>{const n=s(267),i=s(510),r=s(162);e.exports=class extends n{constructor(e){super(),this.connectionID=i.uuidv4(),this.connected=!0,this.socket=e,this.type=r.TYPE.NONE,this.keys={public:null,private:null,generating:!1},this.inited=!1}init(){this.inited||(this.inited=!0,this.onConnect(),this.emit("connected",this))}isClient(){if(this.type==r.TYPE.NONE)throw new Error("Invalid transport type!!!");return this.type==r.TYPE.CLIENT}hasE2EEnabled(){return this.keys.generating||null!=this.keys.public&&null!=this.keys.private}generateKeys(){return new Promise((e=>{this.generateKeys=()=>{throw new Error("Already generated keys!")},i.certificates(4096).then((t=>{this.keys=t,e()}))}))}setPublicKey(e){return this.setPublicKey=null,i.importKey(e).then((e=>{this.keys.public=e}))}getPublicKey(){return this.keys.public}getPrivateKey(){return this.keys.private}disconnect(e){this.connected&&(this.connected=!1,this.onDisconnect(),this.emit("disconnected",this,e))}send(e){throw new Error("send() must be implemented")}onConnect(){throw new Error("onConnect() must be implemented")}onDisconnect(){throw new Error("onDisconnect() must be implemented")}}},162:(e,t,s)=>{const n=s(267),i=s(510);class r extends n{constructor(e,t){super(),this.id=i.uuidv4(),this.options=Object.assign({},t),this.type=e,this.peers=new Map,this.started=!1}listen(){return new Promise(((e,t)=>{this.started?e():this.onListen().then((()=>{this.started=!0,e()})).catch((e=>{t(e)}))}))}connect(){return new Promise(((e,t)=>{this.started?e():this.onConnect().then((()=>{this.started=!0,e()})).catch((e=>{t(e)}))}))}stop(){return new Promise(((e,t)=>{if(this.started){this.started=!1;for(const e of this.peers.values())e.disconnect("Local Connection Closed");this.onStop().then((()=>{e()})).catch((e=>{t(e)}))}else e()}))}addPeer(e){e.type=this.type,e.on("connected",(()=>{this.peers.set(e.connectionID,e),this.emit("connected",e)})),e.on("disconnected",((e,t)=>{this.peers.delete(e.connectionID),this.emit("disconnected",e,t)})),e.init()}onConnect(){throw new Error("onConnect() must be implemented")}onListen(){throw new Error("onListen() must be implemented")}onStop(){throw new Error("onStop() must be implemented")}}var o,a,c;c=()=>{throw new Error("static scheme() must be implemented")},(a="scheme")in(o=r)?Object.defineProperty(o,a,{value:c,enumerable:!0,configurable:!0,writable:!0}):o[a]=c,e.exports=r,r.TYPE={CLIENT:"client",SERVER:"server"}},818:(e,t,s)=>{const n=s(586);e.exports=class extends n{constructor(){super(),this.isLocal=!0}onConnect(){}send(e){return new Promise(((t,s)=>{try{setImmediate((()=>{this.emit("message",this,e)})),t()}catch(e){s(e)}}))}onDisconnect(){}}},870:(e,t,s)=>{const n=s(162),i=s(818);e.exports=class extends n{constructor(e,t){super(e,t)}static scheme(){return"local"}onListen(){return new Promise(((e,t)=>{this.addPeer(new i),e()}))}onConnect(){return new Promise(((e,t)=>{t("Only listening is supported!")}))}onStop(){return new Promise(((e,t)=>{e()}))}}},683:(e,t,s)=>{const n=s(586);e.exports=class extends n{onConnect(){this.socket.on("close",(()=>{this.disconnect("Remote Connection Closed")})),this.socket.on("error",(e=>{this.emit("error",this,e)})),this.socket.on("message",(e=>{this.emit("message",this,e)}))}send(e){return new Promise(((t,s)=>{try{this.socket.send(e),t()}catch(e){s(e)}}))}onDisconnect(){this.socket&&(this.socket.close(),this.socket=null)}}},866:(e,t,s)=>{const n=s(162),i=s(683),r=s(966);e.exports=class extends n{constructor(e,t){super(e,t)}static scheme(){return"ws"}onListen(){return new Promise(((e,t)=>{this.ws=new r.Server({port:this.options.port,host:this.options.ip}),this.ws.on("connection",(e=>{this.addPeer(new i(e))})),this.ws.on("error",(e=>{t(e)})),this.ws.on("listening",(()=>{e()}))}))}onConnect(){return new Promise(((e,t)=>{let s=new r("ws://"+this.options.ip+":"+this.options.port+"/");s.on("open",(t=>{this.addPeer(new i(s)),e()})),s.on("error",(e=>{t(e)}))}))}onStop(){return new Promise(((e,t)=>{this.ws&&(this.ws.close(),this.ws=null),e()}))}}},373:(e,t,s)=>{"use strict";var n=s(650);function i(){}function r(){this.value=null,this.callback=i,this.next=null,this.release=i,this.context=null,this.errorHandler=null;var e=this;this.worked=function(t,s){var n=e.callback,r=e.errorHandler,o=e.value;e.value=null,e.callback=i,e.errorHandler&&r(t,o),n.call(e.context,t,s),e.release(e)}}e.exports=function(e,t,s){if("function"==typeof e&&(s=t,t=e,e=null),s<1)throw new Error("fastqueue concurrency must be greater than 1");var o=n(r),a=null,c=null,h=0,l=null,d={push:function(s,n){var r=o.get();r.context=e,r.release=p,r.value=s,r.callback=n||i,r.errorHandler=l,h===d.concurrency||d.paused?c?(c.next=r,c=r):(a=r,c=r,d.saturated()):(h++,t.call(e,r.value,r.worked))},drain:i,saturated:i,pause:function(){d.paused=!0},paused:!1,concurrency:s,running:function(){return h},resume:function(){if(d.paused){d.paused=!1;for(var e=0;e<d.concurrency;e++)h++,p()}},idle:function(){return 0===h&&0===d.length()},length:function(){for(var e=a,t=0;e;)e=e.next,t++;return t},getQueue:function(){for(var e=a,t=[];e;)t.push(e.value),e=e.next;return t},unshift:function(s,n){var r=o.get();r.context=e,r.release=p,r.value=s,r.callback=n||i,h===d.concurrency||d.paused?a?(r.next=a,a=r):(a=r,c=r,d.saturated()):(h++,t.call(e,r.value,r.worked))},empty:i,kill:function(){a=null,c=null,d.drain=i},killAndDrain:function(){a=null,c=null,d.drain(),d.drain=i},error:function(e){l=e}};return d;function p(s){s&&o.release(s);var n=a;n?d.paused?h--:(c===a&&(c=null),a=n.next,n.next=null,t.call(e,n.value,n.worked),null===c&&d.empty()):0==--h&&d.drain()}}},650:e=>{"use strict";e.exports=function(e){var t=new e,s=t;return{get:function(){var n=t;return n.next?t=n.next:(t=new e,s=t),n.next=null,n},release:function(e){s.next=e,s=e}}}}},t={};return function s(n){if(t[n])return t[n].exports;var i=t[n]={exports:{}};return e[n].call(i.exports,i,i.exports,s),i.exports}(506)})();