'use strict';
// Filtering local HTTP/CONNECT proxy. The Tauri shell cannot hook every request of a WebView2 page the way Electron's
// session.webRequest.onBeforeRequest does (see electron/browser-view.cjs), so its browser webviews send ALL traffic here and
// this proxy applies the same policy: http(s)/ws(s) only, no credentials in URLs, and no local/private/link-local destinations
// (by name, by literal, or by DNS answer). The host is resolved HERE, every answer is validated with web.cjs rules, and the
// connection goes to the validated IP, so DNS rebinding cannot swap the address after the check. CONNECT tunnels raw bytes
// (TLS stays end to end; nothing is terminated or inspected).
// Listens on 127.0.0.1 only, random port, Basic auth with a random per-run token. The realm is random too: the shell answers
// WebView2's authentication request only when the challenge carries this realm, so a web site asking for Basic auth with a
// realm of its choosing never receives the token. Every reply the proxy makes itself carries X-Lumen-Proxy (blocked | dns |
// gateway | bad-request), so the shell can tell its refusals from a site's own error pages.
const http=require('node:http'),net=require('node:net'),crypto=require('node:crypto');
const {resolveHost,testAllowed}=require('./web.cjs');

const DNS_TIMEOUT=10000,REQUEST_TIMEOUT=300000,CONNECT_TIMEOUT=15000,IDLE_TIMEOUT=120000,MAX_HEADER=16384;
const HOP=['proxy-authorization','proxy-connection','proxy-authenticate','connection','keep-alive','te','trailer','transfer-encoding','upgrade'];

const BLOCKED_PAGE='<!doctype html><html><head><meta charset="utf-8"><title>Blocked</title></head><body style="font-family:system-ui,sans-serif;max-width:34em;margin:4em auto;padding:0 1em">'
 +'<h1>This address is blocked</h1><p>Local and private network addresses cannot be opened from Lumen.</p>'
 +'<h1>Bu adres engellendi</h1><p>Yerel ve özel ağ adresleri Lumen’den açılamaz.</p></body></html>';

// Drops hop-by-hop headers plus any header named in the Connection header.
const without=headers=>{const extra=String(headers.connection||'').toLowerCase().split(',').map(t=>t.trim()).filter(Boolean);const out={};for(const [k,v] of Object.entries(headers))if(!HOP.includes(k)&&!extra.includes(k))out[k]=v;return out;};
const digest=value=>crypto.createHash('sha256').update(String(value)).digest();

function startProxy({resolver,__testDial}={}){
 // __testDial(ip, port) -> {host, port}: TEST ONLY (underscore-prefixed on purpose; no product code passes it). Lets tests redirect an already-validated public IP to a local server.
 // Product code never passes it; without it the proxy dials exactly the validated IP.
 const user='lumen',token=crypto.randomBytes(24).toString('hex'),realm='lumen-'+crypto.randomBytes(16).toString('hex');
 const expected=digest('Basic '+Buffer.from(user+':'+token).toString('base64'));
 const sockets=new Set();
 const track=socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>socket.destroy());return socket;};

 const authorized=req=>{const header=req.headers['proxy-authorization'];return typeof header==='string'&&crypto.timingSafeEqual(digest(header.trim()),expected);};

 // Resolve + validate, then connect to the first reachable validated address.
 async function open(hostname,port){
  let timer;
  // The UI tests' local server (web.cjs allowTestHost, test mode only) is dialled as is; nothing else skips the checks.
  const addresses=testAllowed(hostname,port)?['127.0.0.1']:await Promise.race([resolveHost(hostname,{resolver}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('DNS timeout'),{code:'dns'})),DNS_TIMEOUT);})]).finally(()=>clearTimeout(timer));
  let last;
  for(const ip of addresses){
   try{
    const target=__testDial?__testDial(ip,port):{host:ip,port};
    return await new Promise((resolve,reject)=>{
     const socket=net.connect({host:target.host,port:target.port});track(socket);
     const timer=setTimeout(()=>{socket.destroy();reject(Object.assign(new Error('timeout'),{code:'timeout'}));},CONNECT_TIMEOUT);
     socket.once('connect',()=>{clearTimeout(timer);socket.setNoDelay(true);socket.setTimeout(IDLE_TIMEOUT,()=>socket.destroy());resolve(socket);});
     socket.once('error',error=>{clearTimeout(timer);reject(error);});
    });
   }catch(error){last=error;}
  }
  throw last||new Error('unreachable');
 }

 const refusal=error=>error&&error.code==='blocked';
 const parseHostPort=text=>{
  const m=/^(\[[^\]]+\]|[^:\[\]@\/?#]+):(\d{1,5})$/.exec(String(text));if(!m)return null;
  const port=Number(m[2]),host=m[1].replace(/^\[|\]$/g,'');
  return host&&port>=1&&port<=65535?{host,port}:null;
 };

 function rawReply(socket,status,reason,headers={},body=''){
  if(socket.destroyed||!socket.writable)return;
  const lines=['HTTP/1.1 '+status+' '+reason,'Connection: close','Content-Length: '+Buffer.byteLength(body),...Object.entries(headers).map(([k,v])=>k+': '+v)];
  socket.end(lines.join('\r\n')+'\r\n\r\n'+body);
 }
 function reply(res,status,headers,body){
  if(res.headersSent||res.writableEnded){res.destroy();return;}
  res.writeHead(status,{'Content-Length':Buffer.byteLength(body),'Connection':'close',...headers});res.end(body);
 }
 const htmlHeaders={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Lumen-Proxy':'blocked'};
 const textHeaders=kind=>({'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Lumen-Proxy':kind});
 const challenge='Basic realm="'+realm+'"';
 const authHeaders={'Proxy-Authenticate':challenge,'Content-Type':'text/plain; charset=utf-8'};

 const server=http.createServer({maxHeaderSize:MAX_HEADER,requestTimeout:REQUEST_TIMEOUT,headersTimeout:15000,keepAlive:false},async(req,res)=>{
  try{
   if(!authorized(req))return reply(res,407,authHeaders,'Proxy authentication required');
   let url;try{url=new URL(req.url);}catch{return reply(res,400,textHeaders('bad-request'),'Bad request');}
   if(url.protocol!=='http:')return url.protocol==='https:'?reply(res,400,textHeaders('bad-request'),'Unsupported scheme'):reply(res,403,htmlHeaders,BLOCKED_PAGE);
   if(url.username||url.password)return reply(res,403,htmlHeaders,BLOCKED_PAGE);
   const port=url.port?Number(url.port):80,host=url.hostname.replace(/^\[|\]$/g,'');
   let upstream;
   try{upstream=await open(host,port);}catch(error){return refusal(error)?reply(res,403,htmlHeaders,BLOCKED_PAGE):error.code==='dns'?reply(res,502,textHeaders('dns'),'Could not resolve host'):reply(res,502,textHeaders('gateway'),'Bad gateway');}
   const headers=without(req.headers);headers.host=url.host;headers.connection='close';
   const agent=new http.Agent({keepAlive:false});agent.createConnection=()=>upstream; // the validated socket; Node never resolves the name
   const out=http.request({method:req.method,path:url.pathname+url.search,headers,agent});
   const fail=()=>{upstream.destroy();if(!res.headersSent)reply(res,502,textHeaders('gateway'),'Bad gateway');else res.destroy();};
   out.on('error',fail);
   out.on('response',up=>{
    // X-Lumen-Proxy belongs to the proxy's own replies: a site cannot claim it.
    const h=without(up.headers);delete h['x-lumen-proxy'];h.connection='close';
    res.writeHead(up.statusCode,up.statusMessage,h);up.pipe(res);up.on('error',fail);
   });
   res.on('close',()=>{out.destroy();upstream.destroy();});
   req.on('error',fail);req.pipe(out);
  }catch{try{res.destroy();}catch{}}
 });
 server.on('connection',track);
 server.setTimeout(IDLE_TIMEOUT);
 server.on('clientError',(error,socket)=>{
  if(socket.writable)rawReply(socket,error&&error.code==='HPE_HEADER_OVERFLOW'?431:400,error&&error.code==='HPE_HEADER_OVERFLOW'?'Request Header Fields Too Large':'Bad Request');else socket.destroy();
 });
 server.on('upgrade',(req,socket)=>rawReply(socket,501,'Not Implemented'));
 server.on('connect',async(req,client,head)=>{
  client.on('error',()=>client.destroy());
  try{
   if(!authorized(req))return rawReply(client,407,'Proxy Authentication Required',{'Proxy-Authenticate':challenge});
   const target=parseHostPort(req.url);
   if(!target)return rawReply(client,400,'Bad Request');
   let upstream;
   try{upstream=await open(target.host,target.port);}catch(error){return rawReply(client,refusal(error)?403:502,refusal(error)?'Forbidden':'Bad Gateway',{'X-Lumen-Proxy':refusal(error)?'blocked':error.code==='dns'?'dns':'gateway'});}
   if(client.destroyed){upstream.destroy();return;}
   client.setTimeout(IDLE_TIMEOUT,()=>client.destroy());
   client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
   if(head&&head.length)upstream.write(head);
   upstream.pipe(client);client.pipe(upstream);
   const closeBoth=()=>{upstream.destroy();client.destroy();};
   upstream.on('close',closeBoth);client.on('close',closeBoth);
  }catch{client.destroy();}
 });
 server.on('error',()=>{});

 return new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{
   server.off('error',reject);
   const port=server.address().port;
   resolve({
    url:'http://'+user+':'+token+'@127.0.0.1:'+port,
    // The realm of the proxy's Basic challenge (random per run): the shell answers only this challenge with the token.
    realm,
    stop(){return new Promise(done=>{for(const s of sockets)s.destroy();server.close(()=>done());server.closeAllConnections?.();});}
   });
  });
 });
}

module.exports={startProxy};
