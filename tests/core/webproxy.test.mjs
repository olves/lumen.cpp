import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {startProxy}=require('../../app/webproxy.cjs');
const {checkHost}=require('../../app/web.cjs');

const PUBLIC='93.184.216.34';
const cred=url=>{const u=new URL(url);return {port:Number(u.port),auth:'Basic '+Buffer.from(decodeURIComponent(u.username)+':'+decodeURIComponent(u.password)).toString('base64')};};

// Sends raw bytes to the proxy and collects the response until the proxy closes (or `until` matches).
function raw(port,text,{until}={}){
 return new Promise((resolve,reject)=>{
  const s=net.connect(port,'127.0.0.1');let data='';
  const timer=setTimeout(()=>{s.destroy();resolve(data);},3000);
  s.on('data',d=>{data+=d;if(until&&until.test(data)){clearTimeout(timer);s.destroy();resolve(data);}});
  s.on('close',()=>{clearTimeout(timer);resolve(data);});s.on('error',reject);
  s.write(text);
 });
}
const connectReq=(target,auth)=>'CONNECT '+target+' HTTP/1.1\r\nHost: '+target+'\r\n'+(auth?'Proxy-Authorization: '+auth+'\r\n':'')+'\r\n';
const getReq=(url,auth)=>'GET '+url+' HTTP/1.1\r\nHost: '+new URL(url).host+'\r\n'+(auth?'Proxy-Authorization: '+auth+'\r\n':'')+'Connection: close\r\n\r\n';

async function withProxy(options,fn){
 const proxy=await startProxy(options);
 try{await fn(proxy,cred(proxy.url));}finally{await proxy.stop();}
}
const publicDns=map=>async host=>map[host]||[PUBLIC];

test('checkHost rejects private literals and names, allows public',async()=>{
 for(const h of ['127.0.0.1','192.168.1.1','10.1.2.3','::1','fc00::1','fe80::1','169.254.169.254','0.0.0.0','100.64.0.1','::ffff:127.0.0.1','localhost','foo.local','x.internal'])
  await assert.rejects(checkHost(h),h);
 await checkHost(PUBLIC);
 await assert.rejects(checkHost('rebind.test',{resolver:async()=>[PUBLIC,'10.0.0.5']}));
 await checkHost('ok.test',{resolver:async()=>[{address:PUBLIC}]});
});

test('binds only loopback with a random port and credentials in the url',async()=>{
 await withProxy({},async(proxy,{port})=>{
  const u=new URL(proxy.url);
  assert.equal(u.hostname,'127.0.0.1');assert.ok(port>0);assert.ok(u.username&&u.password.length>=32);
 });
});

test('requires auth: missing and wrong credentials get 407',async()=>{
 await withProxy({resolver:publicDns({})},async(proxy,{port,auth})=>{
  for(const req of [getReq('http://example.test/'),getReq('http://example.test/','Basic '+Buffer.from('lumen:wrong').toString('base64')),connectReq('example.test:443'),connectReq('example.test:443','Basic '+Buffer.from('x:y').toString('base64'))]){
   const r=await raw(port,req);
   assert.match(r,/^HTTP\/1\.1 407 /);assert.match(r,/Proxy-Authenticate: Basic/i);
  }
 });
});

test('rejects 127.0.0.1, 192.168.1.1, 10.x, ::1, fc00:: over HTTP with a 403 page',async()=>{
 await withProxy({},async(proxy,{port,auth})=>{
  for(const host of ['127.0.0.1','192.168.1.1','10.0.0.1','[::1]','[fc00::1]','169.254.169.254','localhost']){
   const r=await raw(port,getReq('http://'+host+':8080/x',auth));
   assert.match(r,/^HTTP\/1\.1 403 /,host);assert.match(r,/This address is blocked/);assert.match(r,/Bu adres engellendi/);
  }
 });
});

test('rejects the same targets over CONNECT',async()=>{
 await withProxy({},async(proxy,{port,auth})=>{
  for(const host of ['127.0.0.1:443','192.168.1.1:443','10.0.0.1:443','[::1]:443','[fc00::1]:443','localhost:443'])
   assert.match(await raw(port,connectReq(host,auth)),/^HTTP\/1\.1 403 Forbidden/,host);
 });
});

test('rejects DNS that resolves to private (any answer) via HTTP and CONNECT',async()=>{
 const resolver=async host=>host==='mixed.test'?[PUBLIC,'10.0.0.9']:['192.168.0.4'];
 await withProxy({resolver},async(proxy,{port,auth})=>{
  for(const h of ['intranet.test','mixed.test']){
   assert.match(await raw(port,getReq('http://'+h+'/',auth)),/^HTTP\/1\.1 403 /);
   assert.match(await raw(port,connectReq(h+':443',auth)),/^HTTP\/1\.1 403 Forbidden/);
  }
 });
});

test('rejects DNS rebinding: connects to the validated IP and never resolves again',async()=>{
 let calls=0;const dialed=[];
 const resolver=async()=>{calls++;return calls===1?[PUBLIC]:['127.0.0.1'];};
 const echo=net.createServer(s=>s.pipe(s));await new Promise(r=>echo.listen(0,'127.0.0.1',r));
 const __testDial=(ip,port)=>{dialed.push(ip);return {host:'127.0.0.1',port:echo.address().port};};
 try{
  await withProxy({resolver,__testDial},async(proxy,{port,auth})=>{
   const r=await raw(port,connectReq('rebind.test:443',auth),{until:/\r\n\r\n/});
   assert.match(r,/^HTTP\/1\.1 200 /);
   assert.equal(calls,1);assert.deepEqual(dialed,[PUBLIC]);
   // a later request sees the private answer and is refused
   assert.match(await raw(port,connectReq('rebind.test:443',auth)),/^HTTP\/1\.1 403 /);
   assert.deepEqual(dialed,[PUBLIC]);
  });
 }finally{echo.close();}
});

test('allows public via CONNECT and tunnels raw bytes end to end',async()=>{
 const echo=net.createServer(s=>s.on('data',d=>s.write(Buffer.concat([Buffer.from('echo:'),d]))));
 await new Promise(r=>echo.listen(0,'127.0.0.1',r));
 const __testDial=(ip,port)=>{assert.equal(ip,PUBLIC);assert.equal(port,443);return {host:'127.0.0.1',port:echo.address().port};};
 try{
  await withProxy({resolver:publicDns({}),__testDial},async(proxy,{port,auth})=>{
   await new Promise((resolve,reject)=>{
    const s=net.connect(port,'127.0.0.1');let buf='';let tunneled=false;
    s.setTimeout(3000,()=>{s.destroy();reject(new Error('timeout'));});
    s.on('data',d=>{buf+=d;if(!tunneled&&buf.includes('\r\n\r\n')){tunneled=true;assert.match(buf,/^HTTP\/1\.1 200 /);buf='';s.write('hello');}
     else if(tunneled&&buf==='echo:hello'){s.destroy();resolve();}});
    s.on('error',reject);s.write(connectReq('example.test:443',auth));
   });
  });
 }finally{echo.close();}
});

test('forwards absolute-form HTTP to a public host, preserving Host and dropping proxy headers',async()=>{
 let seen;
 const origin=http.createServer((req,res)=>{seen={host:req.headers.host,url:req.url,pa:req.headers['proxy-authorization']};res.setHeader('content-type','text/plain');res.end('hi from origin');});
 await new Promise(r=>origin.listen(0,'127.0.0.1',r));
 const __testDial=()=>({host:'127.0.0.1',port:origin.address().port});
 try{
  await withProxy({resolver:publicDns({}),__testDial},async(proxy,{port,auth})=>{
   const r=await raw(port,getReq('http://example.test/path?q=1',auth));
   assert.match(r,/^HTTP\/1\.1 200 /);assert.match(r,/hi from origin$/);
   assert.deepEqual(seen,{host:'example.test',url:'/path?q=1',pa:undefined});
  });
 }finally{origin.close();}
});

test('rejects non-http(s) schemes, embedded credentials, bad ports and malformed requests',async()=>{
 await withProxy({resolver:publicDns({})},async(proxy,{port,auth})=>{
  const bad=async(req,re)=>assert.match(await raw(port,req),re,req);
  await bad('GET ftp://example.test/ HTTP/1.1\r\nHost: example.test\r\nProxy-Authorization: '+auth+'\r\n\r\n',/^HTTP\/1\.1 (400|403) /);
  await bad(getReq('http://user:pw@example.test/',auth),/^HTTP\/1\.1 403 /);
  await bad(getReq('https://example.test/',auth),/^HTTP\/1\.1 (400|403) /);
  await bad('GET /relative HTTP/1.1\r\nHost: example.test\r\nProxy-Authorization: '+auth+'\r\n\r\n',/^HTTP\/1\.1 (400|403) /);
  await bad(connectReq('example.test:0',auth),/^HTTP\/1\.1 (400|403) /);
  await bad(connectReq('example.test',auth),/^HTTP\/1\.1 (400|403) /);
 });
});

test('limits header size and survives abrupt client disconnects; stop closes the port',async()=>{
 const proxy=await startProxy({resolver:publicDns({})});const {port,auth}=cred(proxy.url);
 const big=await raw(port,'GET http://example.test/ HTTP/1.1\r\nHost: example.test\r\nProxy-Authorization: '+auth+'\r\nX-Big: '+'a'.repeat(70000)+'\r\n\r\n');
 assert.match(big,/^HTTP\/1\.1 431 |^HTTP\/1\.1 400 |^$/);
 const s=net.connect(port,'127.0.0.1');s.write('CONNECT example.test:443 HT');s.destroy();
 await new Promise(r=>setTimeout(r,100));
 assert.match(await raw(port,getReq('http://127.0.0.1/',auth)),/^HTTP\/1\.1 403 /); // still serving
 await proxy.stop();
 await assert.rejects(raw(port,'x'));
});

const {privateAddress}=require('../../app/web.cjs');
const V6_PRIVATE=['[::ffff:7f00:1]','[::ffff:127.0.0.1]','[::7f00:1]','[::ffff:a00:1]','[::ffff:c0a8:101]','[64:ff9b::7f00:1]','[2001:0:4136:e378:8000:63bf:3fff:fdd2]','[::ffff:0:7f00:1]'];

test('privateAddress/checkHost classify embedded IPv4 in every IPv6 form (URL-normalized too)',async()=>{
 for(const h of V6_PRIVATE){
  const host=new URL('http://'+h+'/').hostname; // WHATWG-normalized form
  assert.ok(privateAddress(host.replace(/^\[|\]$/g,'')),host);
  await assert.rejects(checkHost(host),host);
  await assert.rejects(checkHost(h),h);
 }
 assert.equal(privateAddress('::ffff:8.8.8.8'),false);
 assert.equal(privateAddress('::ffff:808:808'),false);
 await checkHost('[::ffff:8.8.8.8]');
 await checkHost(new URL('http://[::ffff:8.8.8.8]/').hostname);
 assert.equal(privateAddress('2606:4700:4700::1111'),false);
});

test('rejects IPv4-in-IPv6 private forms over HTTP and CONNECT',async()=>{
 await withProxy({},async(proxy,{port,auth})=>{
  for(const h of V6_PRIVATE){
   assert.match(await raw(port,getReq('http://'+h+':8080/',auth)),/^HTTP\/1\.1 403 /,h);
   assert.match(await raw(port,connectReq(h+':443',auth)),/^HTTP\/1\.1 403 Forbidden/,h);
  }
 });
});

test('CONNECT host:80 is accepted (ws://) and a mapped public IPv6 is not over-blocked',async()=>{
 const echo=net.createServer(s=>s.pipe(s));await new Promise(r=>echo.listen(0,'127.0.0.1',r));
 const dialed=[];const __testDial=(ip,p)=>{dialed.push([ip,p]);return {host:'127.0.0.1',port:echo.address().port};};
 try{
  await withProxy({resolver:publicDns({}),__testDial},async(proxy,{port,auth})=>{
   assert.match(await raw(port,connectReq('example.test:80',auth),{until:/\r\n\r\n/}),/^HTTP\/1\.1 200 /);
   assert.match(await raw(port,connectReq('[::ffff:8.8.8.8]:443',auth),{until:/\r\n\r\n/}),/^HTTP\/1\.1 200 /);
   assert.deepEqual(dialed[0],[PUBLIC,80]);
  });
 }finally{echo.close();}
});

test('HTTP/1.0 without Host gets the checked host; Connection-listed headers are stripped',async()=>{
 let seen;const origin=http.createServer((req,res)=>{seen=req.headers;res.setHeader('x-hop','1');res.setHeader('connection','close, x-hop');res.end('ok');});
 await new Promise(r=>origin.listen(0,'127.0.0.1',r));
 try{
  await withProxy({resolver:publicDns({}),__testDial:()=>({host:'127.0.0.1',port:origin.address().port})},async(proxy,{port,auth})=>{
   const r=await raw(port,'GET http://example.test:8081/a HTTP/1.0\r\nProxy-Authorization: '+auth+'\r\nConnection: close, X-Secret\r\nX-Secret: s\r\n\r\n');
   assert.match(r,/^HTTP\/1\.[01] 200 /);assert.doesNotMatch(r,/x-hop/i);
   assert.equal(seen.host,'example.test:8081');assert.equal(seen['x-secret'],undefined);
  });
 }finally{origin.close();}
});

test('the challenge carries a random realm; the proxy marks its own replies with X-Lumen-Proxy',async()=>{
 const a=await startProxy({}),b=await startProxy({});
 try{
  assert.match(a.realm,/^lumen-[0-9a-f]{32}$/);assert.notEqual(a.realm,b.realm);
  const {port,auth}=cred(a.url);
  const challenge=await raw(port,getReq('http://example.test/'));
  assert.match(challenge,new RegExp('Proxy-Authenticate: Basic realm="'+a.realm+'"','i'));
  const blocked=await raw(port,getReq('http://127.0.0.1:9/x',auth));
  assert.match(blocked,/^HTTP\/1\.1 403 /);assert.match(blocked,/X-Lumen-Proxy: blocked/i);
  const ftp=await raw(port,getReq('ftp://example.test/x',auth));
  assert.match(ftp,/X-Lumen-Proxy: blocked/i);
  const tunnel=await raw(port,connectReq('127.0.0.1:443',auth));
  assert.match(tunnel,/^HTTP\/1\.1 403 /);assert.match(tunnel,/X-Lumen-Proxy: blocked/i);
 }finally{await a.stop();await b.stop();}
});

test('LUMEN_TEST_ALLOW_HOST seam: nothing local passes unless allowTestHost names exactly that loopback host and port',async()=>{
 const web=require('../../app/web.cjs');
 const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/plain'});res.end('local '+req.url);});
 const other=http.createServer((req,res)=>{res.end('other');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));await new Promise(r=>other.listen(0,'127.0.0.1',r));
 const p=server.address().port,q=other.address().port;
 try{
  assert.equal(web.allowedTestHost(),null,'nothing is allowed by default');
  await withProxy({},async(proxy,{port,auth})=>{
   assert.match(await raw(port,getReq('http://127.0.0.1:'+p+'/x',auth)),/^HTTP\/1\.1 403 /,'loopback blocked by default');
   assert.throws(()=>web.checkUrl('http://127.0.0.1:'+p+'/'),/blocked/);
   for(const bad of ['localhost:'+p,'10.0.0.1:'+p,'127.0.0.1','127.0.0.1:0','127.0.0.1:99999','x127.0.0.1:'+p,'']){assert.equal(web.allowTestHost(bad),null,bad);}
   assert.equal(web.allowTestHost('127.0.0.1:'+p),'127.0.0.1:'+p);
   const ok=await raw(port,getReq('http://127.0.0.1:'+p+'/x',auth));
   assert.match(ok,/^HTTP\/1\.1 200 /);assert.match(ok,/local \/x/);
   assert.equal(web.checkUrl('http://127.0.0.1:'+p+'/a').href,'http://127.0.0.1:'+p+'/a');
   // Only that port: another local server, other loopback forms and names stay blocked.
   assert.match(await raw(port,getReq('http://127.0.0.1:'+q+'/x',auth)),/^HTTP\/1\.1 403 /);
   assert.match(await raw(port,connectReq('127.0.0.1:'+q,auth)),/^HTTP\/1\.1 403 /);
   assert.match(await raw(port,getReq('http://localhost:'+p+'/x',auth)),/^HTTP\/1\.1 403 /);
   assert.match(await raw(port,getReq('http://[::ffff:127.0.0.1]:'+p+'/x',auth)),/^HTTP\/1\.1 403 /);
   for(const u of ['http://127.0.0.1:'+q+'/','http://localhost:'+p+'/','http://127.0.0.1/','https://127.0.0.2:'+p+'/'])assert.throws(()=>web.checkUrl(u),/blocked/,u);
  });
 }finally{web.allowTestHost(null);server.close();other.close();}
 assert.equal(web.allowedTestHost(),null);
});
