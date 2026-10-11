'use strict';
// Model downloader used instead of the native backend's single-stream download.
// Contract with the backend (verified from its bridge): a model is installed when
//   <data>/models/<LocalFile || File> exists and its length equals Bytes; the backend itself only checks size,
// so this module verifies SHA-256 before the file is moved into place. The partial file uses the backend's
// "<path>.partial" name; "<path>.partial.json" records which 8 MiB chunks are complete and the remote identity.
// Parallel ranges are only added while they measurably increase throughput (max 4).
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),https=require('node:https'),http=require('node:http'),{Worker}=require('node:worker_threads');

const CHUNK=8*1048576,MAX_CONNECTIONS=4,STALL_MS=30000,MAX_ATTEMPTS=6,PROGRESS_MS=250;
const hashWorkerSource=`const {parentPort,workerData}=require('node:worker_threads');const fs=require('node:fs');const crypto=require('node:crypto');
const hash=crypto.createHash('sha256');const fd=fs.openSync(workerData.file,'r');const buffer=Buffer.allocUnsafe(4*1048576);let position=0;
parentPort.on('message',message=>{if(message.type==='upto'){while(position<message.end){const n=fs.readSync(fd,buffer,0,Math.min(buffer.length,message.end-position),position);if(n<=0)break;hash.update(buffer.subarray(0,n));position+=n;}parentPort.postMessage({type:'position',position});}else if(message.type==='digest'){fs.closeSync(fd);parentPort.postMessage({type:'digest',hex:hash.digest('hex'),position});}});`;

function downloadError(code,message){return Object.assign(new Error(message),{code});}
function validModel(m){
 if(!m||typeof m!=='object')return false;
 return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(m.Repo||'')&&/^[a-f0-9]{64}$/.test(m.Sha||'')&&Number.isSafeInteger(m.Bytes)&&m.Bytes>0&&typeof m.File==='string'&&m.File.length>0&&!m.File.includes('..')&&!m.File.includes('\\')&&!m.File.startsWith('/')&&(!m.LocalFile||(typeof m.LocalFile==='string'&&!/[\\/]|\.\./.test(m.LocalFile)));
}
function retryAfter(value){if(!value)return null;const seconds=Number(value);if(Number.isFinite(seconds))return Math.max(0,seconds*1000);const date=Date.parse(value);return Number.isNaN(date)?null:Math.max(0,date-Date.now());}

// Minimal request helper with manual redirects; returns the response stream (not buffered).
function open(url,{headers={},signal,redirects=6,onRedirect}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(downloadError('aborted','Cancelled'));
  const target=new URL(url);if(!['https:','http:'].includes(target.protocol))return reject(downloadError('network','Unsupported download address.'));
  const client=target.protocol==='https:'?https:http;
  const request=client.get(target,{headers:{'user-agent':'LumenBeta/0.0 (model downloader)',...headers}},response=>{
   const status=response.statusCode||0;
   if(status>=300&&status<400&&response.headers.location){response.resume();if(redirects<=0)return reject(downloadError('network','Too many redirects.'));onRedirect?.(response);return resolve(open(new URL(response.headers.location,target).href,{headers,signal,redirects:redirects-1,onRedirect}));}
   response.finalUrl=target.href;resolve(response);
  });
  const abort=()=>{request.destroy(downloadError('aborted','Cancelled'));};
  signal?.addEventListener('abort',abort,{once:true});request.on('close',()=>signal?.removeEventListener('abort',abort));
  request.on('error',error=>reject(error.code==='aborted'?error:downloadError('network',error.message)));
 });
}

function createDownloader({dataDir,emit=()=>{},resolveUrl=m=>`https://huggingface.co/${m.Repo}/resolve/main/${m.File.split('/').map(encodeURIComponent).join('/')}`,maxConnections=MAX_CONNECTIONS,chunkSize=CHUNK,stallMs=STALL_MS,backoffMs=1000,adaptMs=4000}={}){
 const jobs=new Map();
 const modelsDir=path.join(dataDir,'models');
 function destination(model){const file=path.resolve(modelsDir,model.LocalFile||model.File);if(!file.startsWith(path.resolve(modelsDir)+path.sep))throw downloadError('invalid','Invalid model file.');return file;}
 function publicState(job){return {id:job.id,name:job.model.Name,file:path.basename(job.dest),phase:job.phase,bytes:job.bytes,total:job.total,speed:job.phase==='downloading'?Math.round(job.speed):0,eta:job.phase==='downloading'&&job.speed>1024?Math.round((job.total-job.bytes)/job.speed):null,connections:job.phase==='downloading'?job.active:0,error:job.error||null,resumable:job.phase==='paused'||job.phase==='failed'};}
 function report(job,force=false){const now=Date.now();if(!force&&now-job.reported<PROGRESS_MS)return;job.reported=now;emit(publicState(job));}

 async function readMeta(job){
  try{const meta=JSON.parse(await fsp.readFile(job.metaPath,'utf8'));if(meta.version===1&&meta.sha===job.model.Sha&&meta.size===job.total&&meta.chunk===chunkSize&&Array.isArray(meta.done))return meta;}catch{}
  return null;
 }
 async function writeMeta(job){const meta={version:1,sha:job.model.Sha,size:job.total,chunk:chunkSize,etag:job.remote?.etag||null,lastModified:job.remote?.lastModified||null,done:[...job.done].sort((a,b)=>a-b)};const temp=job.metaPath+'.tmp';await fsp.writeFile(temp,JSON.stringify(meta));await fsp.rename(temp,job.metaPath);}

 // Resolve the CDN address once (and again if a signed address expires) and confirm the remote file is the expected one.
 async function resolveRemote(job,signal){
  let linked={};
  const response=await open(resolveUrl(job.model),{headers:{range:'bytes=0-0'},signal,onRedirect:r=>{if(r.headers['x-linked-size'])linked.size=Number(r.headers['x-linked-size']);if(r.headers['x-linked-etag'])linked.etag=String(r.headers['x-linked-etag']).replace(/^W\//,'').replace(/"/g,'');}});
  response.resume();
  const status=response.statusCode;
  if(status===429||status===503)throw Object.assign(downloadError('retry','The server is busy ('+status+').'),{wait:retryAfter(response.headers['retry-after'])});
  if(status===401||status===403)throw downloadError('denied','This model file requires access on Hugging Face.');
  if(status===404)throw downloadError('missing','The model file was not found on Hugging Face.');
  if(status!==206&&status!==200)throw downloadError('retry','Unexpected response ('+status+').');
  const total=status===206?Number(/\/(\d+)$/.exec(response.headers['content-range']||'')?.[1]):Number(response.headers['content-length']);
  if(linked.size&&linked.size!==job.total||total&&total!==job.total)throw downloadError('changed','The file on Hugging Face no longer matches this model entry. Search for the model again.');
  if(linked.etag&&/^[a-f0-9]{64}$/.test(linked.etag)&&linked.etag!==job.model.Sha)throw downloadError('changed','The file on Hugging Face has changed. Search for the model again.');
  job.remote={verified:linked.etag===job.model.Sha&&linked.size===job.total,url:response.finalUrl,ranges:status===206,etag:response.headers.etag||null,lastModified:response.headers['last-modified']||null};
 }

 function startHasher(job){
  job.hasher?.terminate();const worker=new Worker(hashWorkerSource,{eval:true,workerData:{file:job.partial}});job.hasher=worker;job.hashed=0;job.hashBusy=false;
  worker.on('message',message=>{if(message.type==='position'){job.hashed=message.position;job.hashBusy=false;feedHasher(job);}else if(message.type==='digest')job.onDigest?.(message);});
  worker.on('error',()=>{job.hasher=null;});
 }
 function contiguous(job){let i=Math.floor(job.hashed/chunkSize);while(job.done.has(i))i++;return Math.min(job.total,i*chunkSize);}
 function feedHasher(job){if(!job.hasher||job.hashBusy)return;const end=contiguous(job);if(end>job.hashed){job.hashBusy=true;job.hasher.postMessage({type:'upto',end});}}

 async function fetchChunk(job,index,signal){
  const start=index*chunkSize,end=Math.min(job.total,start+chunkSize)-1;
  for(let attempt=1;;attempt++){
   let received=0;
   try{
    if(!job.remote)await resolveRemote(job,signal);
    const response=await open(job.remote.url,{headers:{range:`bytes=${start}-${end}`},signal});
    const status=response.statusCode;
    if(status===200){response.destroy();throw downloadError('no-range','The server ignored the range request.');}
    if(status===403||status===410){response.resume();job.remote=null;throw downloadError('retry','The download address expired.');}
    if(status===429||status===503){response.resume();throw Object.assign(downloadError('retry','The server is busy ('+status+').'),{wait:retryAfter(response.headers['retry-after'])});}
    if(status!==206){response.resume();throw downloadError(status>=500?'retry':'http','Unexpected response ('+status+').');}
    const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers['content-range']||'');
    if(!range||Number(range[1])!==start||Number(range[2])!==end||Number(range[3])!==job.total){response.destroy();throw downloadError('retry','The server returned the wrong byte range.');}
    let stall=setTimeout(()=>response.destroy(downloadError('stalled','The connection stalled.')),stallMs);const parts=[];let pending=0,position=start;
    try{
     for await (const piece of response){
      clearTimeout(stall);stall=setTimeout(()=>response.destroy(downloadError('stalled','The connection stalled.')),stallMs);
      received+=piece.length;if(received>end-start+1)throw downloadError('retry','The server sent more data than requested.');
      parts.push(piece);pending+=piece.length;job.bytes+=piece.length;job.window+=piece.length;
      if(pending>=1048576){const buffer=Buffer.concat(parts);parts.length=0;pending=0;await job.handle.write(buffer,0,buffer.length,position);position+=buffer.length;}
      report(job);
     }
     if(pending){const buffer=Buffer.concat(parts);await job.handle.write(buffer,0,buffer.length,position);position+=buffer.length;}
    }finally{clearTimeout(stall);}
    if(received!==end-start+1)throw downloadError('retry','The connection closed early.');
    job.done.add(index);feedHasher(job);return;
   }catch(error){
    job.bytes-=received;
    if(signal.aborted)throw downloadError('aborted','Cancelled');
    if(['ENOSPC','EACCES','EPERM','EROFS','EIO'].includes(error.code))throw downloadError('disk',error.code==='ENOSPC'?'The disk is full.':'The model file could not be written ('+error.code+').');
    if(['no-range','denied','missing','changed','http'].includes(error.code)||attempt>=MAX_ATTEMPTS)throw error;
    const wait=Math.min(120000,error.wait??Math.min(30000,backoffMs*2**(attempt-1))+Math.random()*250);
    job.retries++;await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,wait);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(downloadError('aborted','Cancelled'));},{once:true});});
   }
  }
 }

 // Single-stream fallback when the server does not honour ranges: rewrite from byte 0, still verified.
 async function sequential(job,signal){
  job.done.clear();job.bytes=0;await job.handle.truncate(0);startHasher(job);
  const response=await open(job.remote?.url||resolveUrl(job.model),{signal});
  if(response.statusCode!==200){response.resume();throw downloadError('http','Unexpected response ('+response.statusCode+').');}
  let position=0,stall=setTimeout(()=>response.destroy(downloadError('stalled','The connection stalled.')),stallMs);
  try{for await (const piece of response){clearTimeout(stall);stall=setTimeout(()=>response.destroy(downloadError('stalled','The connection stalled.')),stallMs);if(position+piece.length>job.total)throw downloadError('retry','The server sent more data than expected.');await job.handle.write(piece,0,piece.length,position);position+=piece.length;job.bytes=position;job.window+=piece.length;while((job.done.size+1)*chunkSize<=position)job.done.add(job.done.size);feedHasher(job);report(job);}}finally{clearTimeout(stall);}
  if(position!==job.total)throw downloadError('retry','The connection closed early.');
  for(let i=0;i*chunkSize<job.total;i++)job.done.add(i);feedHasher(job);
 }

 async function run(job){
  const controller=new AbortController();job.controller=controller;const signal=controller.signal;job.phase='downloading';job.error=null;job.speed=0;job.window=0;report(job,true);
  let meter=null;
  try{
   await fsp.mkdir(path.dirname(job.dest),{recursive:true});
   const stats=await fsp.statfs?.(path.dirname(job.dest)).catch(()=>null);
   const existing=fs.existsSync(job.partial)?fs.statSync(job.partial).size:0;
   if(stats&&stats.bavail*stats.bsize<job.total-existing+536870912)throw downloadError('disk','There is not enough free disk space for this model.');
   const meta=await readMeta(job);job.done=new Set();
   if(meta)meta.done.forEach(i=>job.done.add(i));
   else if(fs.existsSync(job.metaPath)){await fsp.rm(job.partial,{force:true});await fsp.rm(job.metaPath,{force:true});} // progress for another file version: start over
   else if(existing>0&&existing<=job.total)for(let i=0;(i+1)*chunkSize<=existing;i++)job.done.add(i); // backend-style sequential partial
   job.handle=await fsp.open(job.partial,fs.existsSync(job.partial)?'r+':'w+');
   job.bytes=[...job.done].reduce((sum,i)=>sum+Math.min(chunkSize,job.total-i*chunkSize),0);
   startHasher(job);feedHasher(job);
   for(let attempt=1;;attempt++){try{await resolveRemote(job,signal);break;}catch(error){if(signal.aborted||!['retry','network'].includes(error.code)||attempt>=MAX_ATTEMPTS)throw error;await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,Math.min(120000,error.wait??backoffMs*2**(attempt-1)));signal.addEventListener('abort',()=>{clearTimeout(timer);reject(downloadError('aborted','Cancelled'));},{once:true});});}}
   // HF proves identity with the linked SHA-256 and size; CDN ETags differ between edges. Other servers fall back to ETag.
   if(meta&&!job.remote.verified&&meta.etag&&job.remote.etag&&meta.etag!==job.remote.etag){job.done.clear();job.bytes=0;startHasher(job);}
   await writeMeta(job);
   const chunks=Math.ceil(job.total/chunkSize),queue=[];for(let i=0;i<chunks;i++)if(!job.done.has(i))queue.push(i);
   let target=1,best=0,lastWindow=Date.now();job.active=0;
   meter=setInterval(()=>{const now=Date.now(),seconds=(now-lastWindow)/1000;const rate=job.window/seconds;job.window=0;lastWindow=now;job.speed=job.speed?job.speed*0.6+rate*0.4:rate;writeMeta(job).catch(()=>{});
    // Add a connection only while it raises throughput by at least 12%; otherwise keep the current number.
    if(job.remote?.ranges&&now-job.adaptedAt>=adaptMs&&target<maxConnections&&queue.length>target){if(job.speed>best*1.12){best=job.speed;target++;job.adaptedAt=now;spawn();}else job.adaptedAt=Infinity;}
    report(job,true);},1000);
   job.adaptedAt=Date.now();
   const workers=new Set();let failure=null;
   function spawn(){
    if(failure||!queue.length)return;
    const worker=(async()=>{job.active++;try{while(queue.length&&!failure&&workers.size<=target){const index=queue.shift();try{await fetchChunk(job,index,signal);}catch(error){queue.unshift(index);throw error;}}}finally{job.active--;}})();
    workers.add(worker);worker.catch(error=>{failure=failure||error;if(error.code!=='no-range')controller.abort();}).finally(()=>workers.delete(worker));
   }
   spawn();
   while(workers.size){await Promise.allSettled([...workers]);}
   if(failure?.code==='no-range'&&!signal.aborted)await sequential(job,signal);
   else if(failure)throw failure;
   clearInterval(meter);meter=null;
   job.phase='verifying';job.speed=0;report(job,true);
   await job.handle.sync();await job.handle.close();job.handle=null;
   feedHasher(job);
   const digest=await new Promise((resolve,reject)=>{const check=()=>{if(!job.hasher)return reject(downloadError('verify','Verification could not start.'));if(job.hashed>=job.total&&!job.hashBusy){job.onDigest=message=>resolve(message);job.hasher.postMessage({type:'digest'});}else setTimeout(check,50);};signal.addEventListener('abort',()=>reject(downloadError('aborted','Cancelled')),{once:true});check();});
   await job.hasher.terminate();job.hasher=null;
   if(digest.position!==job.total||digest.hex!==job.model.Sha){await fsp.rm(job.partial,{force:true});await fsp.rm(job.metaPath,{force:true});throw downloadError('verify','The downloaded file failed SHA-256 verification and was removed. Try again.');}
   if(fs.statSync(job.partial).size!==job.total)throw downloadError('verify','The downloaded file has the wrong size.');
   await fsp.rm(job.dest,{force:true});await fsp.rename(job.partial,job.dest);await fsp.rm(job.metaPath,{force:true});
   job.phase='completed';job.bytes=job.total;report(job,true);
  }catch(error){
   if(meter)clearInterval(meter);
   if(job.handle){try{await job.handle.close();}catch{}job.handle=null;}
   if(job.hasher){await job.hasher.terminate().catch(()=>{});job.hasher=null;}
   if(job.phase==='downloading'||job.phase==='verifying'){try{if(job.done?.size&&job.cancelRequested!==true)await writeMeta(job);}catch{}}
   if(job.cancelRequested){await fsp.rm(job.partial,{force:true});await fsp.rm(job.metaPath,{force:true});job.phase='cancelled';job.bytes=0;}
   else if(job.pauseRequested){job.phase='paused';}
   else{job.phase='failed';if(['ENOSPC','EACCES','EPERM','EROFS','EIO','EBUSY'].includes(error.code))error=downloadError('disk',error.code==='ENOSPC'?'The disk is full.':'The model file could not be written ('+error.code+'). Check that the folder is writable and not in use.');job.error=error.code==='aborted'?'Cancelled':error.message;}
   job.speed=0;report(job,true);
   if(job.phase==='failed')throw error;
  }finally{job.controller=null;job.cancelRequested=false;job.pauseRequested=false;}
 }

 function launch(job){job.promise=run(job).then(()=>publicState(job),error=>{throw error;}).finally(()=>{if(['completed','cancelled'].includes(job.phase))jobs.delete(job.id);});job.promise.catch(()=>{});return job.promise;}
 return {
  start(model){
   if(!validModel(model))throw downloadError('invalid','Invalid model.');
   const dest=destination(model),id=dest.toLowerCase();
   if(fs.existsSync(dest)&&fs.statSync(dest).size===model.Bytes)return Promise.resolve({id,name:model.Name,phase:'completed',bytes:model.Bytes,total:model.Bytes});
   const current=jobs.get(id);if(current&&['downloading','verifying'].includes(current.phase))throw downloadError('busy','This model is already downloading.');
   if([...jobs.values()].some(j=>j.id!==id&&['downloading','verifying'].includes(j.phase)))throw downloadError('busy','Another model is downloading. Wait for it to finish or pause it.');
   const job=current||{id,model,dest,partial:dest+'.partial',metaPath:dest+'.partial.json',total:model.Bytes,bytes:0,speed:0,window:0,active:0,retries:0,reported:0,done:new Set()};
   jobs.set(id,job);return launch(job);
  },
  pause(id){const job=jobs.get(id);if(!job||job.phase!=='downloading')return false;job.pauseRequested=true;job.controller?.abort();return true;},
  resume(id){const job=jobs.get(id);if(!job||!['paused','failed'].includes(job.phase))throw downloadError('invalid','Nothing to resume.');if([...jobs.values()].some(j=>j.id!==id&&['downloading','verifying'].includes(j.phase)))throw downloadError('busy','Another model is downloading.');return launch(job);},
  async cancel(id){const job=jobs.get(id);if(!job)return false;if(job.controller){job.cancelRequested=true;job.controller.abort();await job.promise.catch(()=>{});}else{await fsp.rm(job.partial,{force:true});await fsp.rm(job.metaPath,{force:true});job.phase='cancelled';report(job,true);jobs.delete(id);}return true;},
  list(){return [...jobs.values()].map(publicState);},
  async cancelAll(){await Promise.all([...jobs.keys()].map(id=>this.pause(id)));}
 };
}

module.exports={createDownloader,validModel};
