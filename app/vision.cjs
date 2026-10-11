'use strict';
// Vision projectors (mmproj) per model, in <data>/vision.json. A projector lets llama-server read image pixels; lumen-host
// loads it with --mmproj. Projectors are found in the model's own Hugging Face repository only when the user asks, and are
// downloaded with the normal downloader (ranges, resume, SHA-256).
const fs=require('node:fs'),path=require('node:path');
const PREFERENCE=[/(^|[-_.])f16\.gguf$/i,/(^|[-_.])bf16\.gguf$/i,/q8_0\.gguf$/i,/(^|[-_.])f32\.gguf$/i];
// The OCR-only wording that photos.js stores in the message; for a vision model the request says the image is attached.
const OCR_NOTE='[Photo attachment context: the current engine receives only OCR text, not image pixels. Do not claim to see visual content that is not present in the recognized text.]';
const VISION_NOTE='[Photo attachment context: the photos are attached as images and you can see them. Text below each photo was recognized locally with OCR and may contain errors. If you are not sure who or what is shown, say so.]';
const FALLBACKS=[['Help me with the text extracted from the attached photos.','Describe the attached photos.'],['Eklediğim fotoğraflardan çıkarılan metne yardımcı ol.','Eklediğim fotoğrafları açıkla.']];

function createVisionStore(data,{fetchJson}){
 const file=path.join(data,'vision.json'),modelsDir=path.join(data,'models');let cache=null;const found=new Map();
 // conversation-vision.json: {chatId: [user message indices whose photos were sent as images]}.
 const seenFile=path.join(data,'conversation-vision.json');let seen=null;const validId=id=>typeof id==='string'&&/^[a-f0-9]{32}$/i.test(id);
 function loadSeen(){if(seen)return seen;try{seen=JSON.parse(fs.readFileSync(seenFile,'utf8'));if(!seen||typeof seen!=='object'||Array.isArray(seen))seen={};}catch{seen={};}return seen;}
 function saveSeen(){const temp=seenFile+'.tmp';fs.writeFileSync(temp,JSON.stringify(seen));fs.renameSync(temp,seenFile);}
 function load(){if(cache)return cache;try{cache=JSON.parse(fs.readFileSync(file,'utf8'));if(!cache||typeof cache!=='object'||Array.isArray(cache))cache={};}catch{cache={};}return cache;}
 function save(){const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(cache,null,1));fs.renameSync(temp,file);}
 function local(entry){const full=path.resolve(modelsDir,entry.localFile);return full.startsWith(path.resolve(modelsDir)+path.sep)?full:null;}
 function ready(entry){const full=entry&&local(entry);try{return !!full&&fs.statSync(full).size===entry.bytes;}catch{return false;}}
 const validRepo=repo=>typeof repo==='string'&&/^[\w.-]{1,96}\/[\w.-]{1,96}$/.test(repo);
 return {
  entry(model){return load()[model]||null;},
  // Absolute path of a complete projector for this model, or null.
  projector(model){const entry=load()[model];return ready(entry)?local(entry):null;},
  status(model){const entry=load()[model];return {model,ready:ready(entry),file:entry?.file||null,bytes:entry?.bytes||0,checked:found.has(model)?!!found.get(model):null};},
  // Looks for a projector in the model's repository (one Hugging Face API request). Returns the download entry or null.
  async find(model){
   if(!model||!validRepo(model.Repo))return null;if(found.has(model.Name))return found.get(model.Name);
   const tree=await fetchJson(`https://huggingface.co/api/models/${model.Repo}/tree/main`);
   const files=(Array.isArray(tree)?tree:[]).filter(f=>f&&f.type==='file'&&typeof f.path==='string'&&/mmproj/i.test(f.path)&&/\.gguf$/i.test(f.path)&&!f.path.includes('..')&&f.lfs&&/^[a-f0-9]{64}$/.test(f.lfs.oid)&&Number.isSafeInteger(f.size)&&f.size>0&&f.size<4*1024**3);
   const rank=f=>{const i=PREFERENCE.findIndex(p=>p.test(f.path));return i<0?PREFERENCE.length:i;};
   files.sort((a,b)=>rank(a)-rank(b)||a.size-b.size);
   const pick=files[0];const entry=pick?{repo:model.Repo,file:pick.path,sha:pick.lfs.oid,bytes:pick.size,localFile:pick.lfs.oid.slice(0,12)+'-'+path.basename(pick.path)}:null;
   found.set(model.Name,entry);return entry;
  },
  remember(model,entry){load()[model]=entry;save();},
  // Forgets the projector; deletes its file unless another model uses the same one.
  remove(model){const all=load(),entry=all[model];if(!entry)return false;if(!Object.entries(all).some(([name,e])=>name!==model&&e.localFile===entry.localFile)){const full=local(entry);if(full)fs.rmSync(full,{force:true});}delete all[model];save();return true;},
  markSeen(chatId,indices){if(!validId(chatId)||!indices.length)return;const all=loadSeen();all[chatId]=[...new Set([...(all[chatId]||[]),...indices.filter(i=>Number.isInteger(i)&&i>=0&&i<2000)])].sort((a,b)=>a-b);saveSeen();},
  decorate(chat){if(!chat||!validId(chat.Id)||!Array.isArray(chat.Messages))return chat;const list=loadSeen()[chat.Id];if(!list?.length)return chat;return {...chat,Messages:chat.Messages.map((m,i)=>list.includes(i)&&m.Role==='user'?{...m,ImagesSeen:true}:m)};},
  branch(from,to,count){const list=loadSeen()[from];if(!list)return;const copy=list.filter(i=>i<count);if(copy.length){seen[to]=copy;saveSeen();}},
  forget(id){const all=loadSeen();if(all[id]){delete all[id];saveSeen();}},
  // Download job description for the downloader (same shape as a catalog model).
  job(model,entry){return {Name:model+' · vision',Repo:entry.repo,File:entry.file,Sha:entry.sha,Bytes:entry.bytes,LocalFile:entry.localFile};},
  // Request text for a user message with photos when the model can see them. The saved message is unchanged.
  requestText(content){let text=String(content||'').replace(OCR_NOTE,VISION_NOTE);text=text.split('No readable text was extracted from this photo.').join('OCR found no text in this photo.');for(const [from,to] of FALLBACKS)if(text.startsWith(from))text=to+text.slice(from.length);return text;}
 };
}
module.exports={createVisionStore};
