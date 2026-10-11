'use strict';
// MTP draft models per model, in <data>/drafts.json. A draft (multi-token prediction head) lets llama-server propose several
// tokens that the main model checks in one step. Drafts are looked up in the model's own Hugging Face repository (its MTP folder)
// only when the user asks, and are downloaded with the normal downloader (ranges, resume, SHA-256).
const fs=require('node:fs'),path=require('node:path');
const PREFERENCE=[/q8_0\.gguf$/i,/q4_0\.gguf$/i,/(^|[-_.])f16\.gguf$/i,/(^|[-_.])bf16\.gguf$/i];

function createDraftStore(data,{fetchJson}){
 const file=path.join(data,'drafts.json'),modelsDir=path.join(data,'models');let cache=null;const found=new Map();
 function load(){if(cache)return cache;try{cache=JSON.parse(fs.readFileSync(file,'utf8'));if(!cache||typeof cache!=='object'||Array.isArray(cache))cache={};}catch{cache={};}return cache;}
 function save(){const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(cache,null,1));fs.renameSync(temp,file);}
 function local(entry){const full=path.resolve(modelsDir,entry.localFile);return full.startsWith(path.resolve(modelsDir)+path.sep)?full:null;}
 function ready(entry){const full=entry&&local(entry);try{return !!full&&fs.statSync(full).size===entry.bytes;}catch{return false;}}
 const validRepo=repo=>typeof repo==='string'&&/^[\w.-]{1,96}\/[\w.-]{1,96}$/.test(repo);
 const usable=f=>f&&f.type==='file'&&typeof f.path==='string'&&/\.gguf$/i.test(f.path)&&/(^|\/)mtp[-_]/i.test(f.path)&&!/shared/i.test(f.path)&&!f.path.includes('..')&&f.lfs&&/^[a-f0-9]{64}$/.test(f.lfs.oid)&&Number.isSafeInteger(f.size)&&f.size>0&&f.size<2*1024**3;
 return {
  path(model){const entry=load()[model];return ready(entry)?local(entry):null;},
  status(model){const entry=load()[model];return {model,ready:ready(entry),file:entry?.file||null,bytes:entry?.bytes||0,checked:found.has(model)?!!found.get(model):null};},
  // Root of the repository and its MTP folder (two Hugging Face API requests at most).
  async find(model){
   if(!model||!validRepo(model.Repo))return null;if(found.has(model.Name))return found.get(model.Name);
   const base=`https://huggingface.co/api/models/${model.Repo}/tree/main`;let files=[];
   const root=await fetchJson(base);if(Array.isArray(root)){files=root.filter(usable);const folder=root.find(f=>f?.type==='directory'&&/^mtp$/i.test(f.path));if(folder){const inner=await fetchJson(base+'/'+encodeURIComponent(folder.path));if(Array.isArray(inner))files=files.concat(inner.filter(usable));}}
   const rank=f=>{const i=PREFERENCE.findIndex(p=>p.test(f.path));return i<0?PREFERENCE.length:i;};files.sort((a,b)=>rank(a)-rank(b)||a.size-b.size);
   const pick=files[0];const entry=pick?{repo:model.Repo,file:pick.path,sha:pick.lfs.oid,bytes:pick.size,localFile:pick.lfs.oid.slice(0,12)+'-'+path.basename(pick.path)}:null;
   found.set(model.Name,entry);return entry;
  },
  remember(model,entry){load()[model]=entry;save();},
  remove(model){const all=load(),entry=all[model];if(!entry)return false;if(!Object.entries(all).some(([name,e])=>name!==model&&e.localFile===entry.localFile)){const full=local(entry);if(full)fs.rmSync(full,{force:true});}delete all[model];save();return true;},
  job(model,entry){return {Name:model+' · draft',Repo:entry.repo,File:entry.file,Sha:entry.sha,Bytes:entry.bytes,LocalFile:entry.localFile};}
 };
}
module.exports={createDraftStore};
