'use strict';
// One place for what Lumen knows about a model: display name (presentation only; model identity, repo and file never change),
// GGUF metadata read locally (architecture, context limit, attention/KV shape, experts, chat template), thinking support,
// a memory estimate for this computer and the automatic context choice. Everything here is an estimate unless it says measured.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFile}=require('node:child_process');
const {readGguf}=require('./gguf.cjs');

// ---------- Display names ----------
const QUANT=/(?:^|[-_.])((?:UD-)?(?:[A-Z]{0,3}Q[0-9](?:_[A-Z0-9]+)*|BF16|F16|F32|MXFP4(?:_MOE)?))$/i;
const SHARD=/-\d{5}-of-\d{5}$/i;
const LABELS={qat:'QAT',it:'IT',instruct:'Instruct',chat:'Chat',awq:'AWQ'};
const DROP=new Set(['it','instruct','chat','gguf','hf','qat','awq','compatible']);
const FAMILY={gemma:'Gemma',qwen:'Qwen',llama:'Llama',mistral:'Mistral',mixtral:'Mixtral',deepseek:'DeepSeek',phi:'Phi',tinyllama:'TinyLlama',smollm:'SmolLM',smollm2:'SmolLM2',smollm3:'SmolLM3',gpt:'GPT',oss:'OSS',vl:'VL',coder:'Coder',moe:'MoE',r1:'R1',distill:'Distill',math:'Math',vision:'Vision',thinking:'Thinking',devstral:'Devstral',codestral:'Codestral',granite:'Granite',olmo:'OLMo',glm:'GLM',kimi:'Kimi',nemotron:'Nemotron',hermes:'Hermes',minicpm:'MiniCPM',internlm:'InternLM',yi:'Yi',falcon:'Falcon',starcoder:'StarCoder',starcoder2:'StarCoder2',codellama:'CodeLlama',exaone:'EXAONE',seed:'Seed',magistral:'Magistral',ministral:'Ministral'};
function quantOf(file){const stem=path.basename(String(file||'')).replace(/\.gguf$/i,'').replace(SHARD,'');const m=stem.match(QUANT);return m?m[1].toUpperCase().replace(/^UD-/,'UD-'):'';}
function word(token){
 const lower=token.toLowerCase();
 if(FAMILY[lower])return FAMILY[lower];
 const familyVersion=lower.match(/^([a-z]+)(\d+(?:\.\d+)*)$/);if(familyVersion&&FAMILY[familyVersion[1]])return FAMILY[familyVersion[1]]+familyVersion[2];
 if(/^\d+(?:\.\d+)?[bmk]$/i.test(token)||/^[ae]\d+(?:\.\d+)?b$/i.test(token)||/^\d+x\d+(?:\.\d+)?b$/i.test(token))return token.toUpperCase();
 if(/^v\d/i.test(token))return 'v'+token.slice(1);
 return token===lower&&/^[a-z]/.test(token)?token[0].toUpperCase()+token.slice(1):token;
}
// Name stem from the file name; the repository name when the file name says nothing useful.
function stemOf(model){
 const file=path.basename(String(model.File||'')).replace(/\.gguf$/i,'').replace(SHARD,''),quant=quantOf(model.File);
 let stem=quant?file.slice(0,file.length-quant.length).replace(/[-_.]+$/,''):file;
 stem=stem.replace(/\.i\d$/i,'');
 if(!/[a-z]{2,}/i.test(stem)||/^(model|ggml-model|weights?)$/i.test(stem)){const repo=String(model.Repo||'').split('/').pop()||'';stem=repo.replace(/[-_]gguf$/i,'')||String(model.Name||file);}
 return stem;
}
function tokensOf(stem){return stem.split(/[-_\s]+/).filter(Boolean);}
// extra: dropped words to put back (only the ones that tell otherwise identical names apart).
function baseDisplay(model,extra=null){
 const tokens=tokensOf(stemOf(model)).filter(t=>!DROP.has(t.toLowerCase())||extra?.has(t.toLowerCase())).map(t=>extra?.has(t.toLowerCase())&&LABELS[t.toLowerCase()]?LABELS[t.toLowerCase()]:t);
 const text=tokens.map(word).join(' ').trim();
 return text.length>=2?text:path.basename(String(model.File||model.Name||'Model')).replace(/\.gguf$/i,'');
}
// Display names for a whole list; duplicates get their dropped variant words back, then the repository owner.
function displayNames(models){
 const names=new Map();for(const m of models){const q=quantOf(m.File);names.set(m.Name,baseDisplay(m)+(q?' · '+q:''));}
 for(const round of [1,2]){
  const groups=new Map();for(const m of models){const n=names.get(m.Name);groups.set(n,(groups.get(n)||[]).concat(m));}
  for(const [,group] of groups){
   if(group.length<2)continue;
   const dropped=group.map(m=>new Set(tokensOf(stemOf(m)).map(t=>t.toLowerCase()).filter(t=>DROP.has(t))));
   const common=[...dropped[0]].filter(t=>dropped.every(s=>s.has(t)));
   group.forEach((m,i)=>{const q=quantOf(m.File);let base=baseDisplay(m,new Set([...dropped[i]].filter(t=>!common.includes(t))));if(round===2)base+=' ('+(String(m.Repo||'').split('/')[0]||'local')+')';names.set(m.Name,base+(q?' · '+q:''));});
  }
 }
 return names;
}

// ---------- Metadata ----------
const KEEP=/^general\.(architecture|type|name|basename|size_label|file_type)$|^tokenizer\.chat_template$|\.(block_count|context_length|embedding_length|attention\.head_count|attention\.head_count_kv|attention\.key_length|attention\.value_length|attention\.key_length_swa|attention\.value_length_swa|attention\.sliding_window|attention\.sliding_window_pattern|attention\.shared_kv_layers|expert_count|expert_used_count)$/;
function shapeOf(meta){
 const arch=meta['general.architecture'];if(!arch)return null;const g=k=>meta[arch+'.'+k];
 const num=v=>Array.isArray(v)?(v.length?v.reduce((a,b)=>a+Number(b||0),0)/v.length:null):(Number.isFinite(Number(v))?Number(v):null);
 const layers=num(g('block_count')),heads=num(g('attention.head_count')),embd=num(g('embedding_length'));
 const kvHeads=num(g('attention.head_count_kv'))??heads,key=num(g('attention.key_length'))??(embd&&heads?embd/heads:null),value=num(g('attention.value_length'))??key;
 const pattern=g('attention.sliding_window_pattern'),window=num(g('attention.sliding_window'));
 return {arch,layers,embd,kvHeads,key,value,keySwa:num(g('attention.key_length_swa'))??key,valueSwa:num(g('attention.value_length_swa'))??value,
  window:window||null,swaShare:Array.isArray(pattern)&&pattern.length?pattern.filter(Boolean).length/pattern.length:(window?0.5:0),
  sharedLayers:num(g('attention.shared_kv_layers'))||0,trainedContext:num(g('context_length')),experts:num(g('expert_count'))||0,expertsUsed:num(g('expert_used_count'))||0};
}
// Thinking support from the chat template the engine applies (llama-server --jinja). "supported" means the template reads
// enable_thinking, which the engine sets per request; "always" means the template emits reasoning with no switch.
function thinkingOf(template){
 if(typeof template!=='string'||!template)return {state:'unknown',reason:'no-template'};
 if(/enable_thinking/.test(template))return {state:'supported',toggle:true,reason:'template-switch'};
 if(/<think>|reasoning_content/.test(template))return {state:'supported',toggle:false,reason:'template-always'};
 if(/reasoning_effort|<\|channel\|>/.test(template))return {state:'unknown',reason:'template-other'};
 return {state:'unsupported',reason:'template-none'};
}

// ---------- Memory ----------
const GiB=1024**3;
function kvBytes(shape,context,kv){
 if(!shape||!shape.layers||!shape.kvHeads||!shape.key)return null;
 const per=kv==='q8_0'?34/32:2,own=Math.max(1,shape.layers-shape.sharedLayers),swaLayers=shape.window?Math.round(own*shape.swaShare):0,full=own-swaLayers;
 const tokensSwa=shape.window?Math.min(context,shape.window):context;
 return per*shape.kvHeads*(full*context*(shape.key+shape.value)+swaLayers*tokensSwa*(shape.keySwa+shape.valueSwa));
}
// Rough compute/working buffers on top of weights and KV cache.
const overhead=context=>0.45*GiB+context*2048;
function estimate(model,{context,kv='f16',gpu='auto',hardware}){
 const weights=Number(model.Bytes)||0;if(!weights)return {placement:'unknown',reason:'no-size'};
 const cache=kvBytes(model.shape,context,kv),need=weights+(cache||0)+overhead(context);
 const vram=hardware?.vramFree??null,ram=hardware?.ramFree??null,margin=1*GiB;
 let placement='unknown';
 if(gpu!=='cpu'&&vram!=null&&need<=vram-margin)placement='gpu';
 else if(ram!=null&&need<=(gpu==='cpu'?0:Math.max(0,(vram??0)-margin))+ram-2*GiB)placement=gpu==='cpu'?'cpu':'hybrid';
 else if(ram!=null)placement='strain';
 return {placement,weights,kv:cache,need,contextIncluded:cache!=null,moe:model.shape?.experts>0,experts:model.shape?.experts||0,expertsUsed:model.shape?.expertsUsed||0};
}

function createModelInfo(data,{log=()=>{}}={}){
 const cacheFile=path.join(data,'model-info.json');let cache=null;let backendHardware=null;let hw=null,hwAt=0,hwLoaded=0;const reading=new Map();
 function load(){if(cache)return cache;try{cache=JSON.parse(fs.readFileSync(cacheFile,'utf8'));if(!cache||typeof cache!=='object'||cache.version!==1)cache={version:1,files:{}};}catch{cache={version:1,files:{}};}return cache;}
 function save(){const temp=cacheFile+'.tmp';fs.writeFileSync(temp,JSON.stringify(cache));fs.renameSync(temp,cacheFile);}
 const localPath=m=>{const dir=path.join(data,'models'),full=path.resolve(dir,m.LocalFile||m.File||'');return full.startsWith(path.resolve(dir)+path.sep)?full:null;};
 // Reads GGUF metadata once per file version (size + mtime) and keeps only what Lumen uses.
 async function metaFor(m){
  const file=localPath(m);if(!file)return null;let stat;try{stat=await fs.promises.stat(file);}catch{return null;}if(stat.size!==m.Bytes)return null;
  const key=path.basename(file),c=load(),entry=c.files[key];if(entry&&entry.size===stat.size&&entry.mtime===stat.mtimeMs)return entry;
  if(reading.has(key))return reading.get(key);
  const job=readGguf(file,{keep:k=>KEEP.test(k)}).then(({meta})=>{const value={size:stat.size,mtime:stat.mtimeMs,shape:shapeOf(meta),thinking:thinkingOf(meta['tokenizer.chat_template']),sizeLabel:meta['general.size_label']||null,type:meta['general.type']||null};load().files[key]=value;save();return value;},e=>{log('[models] metadata '+key+': '+e.message);return null;}).finally(()=>reading.delete(key));
  reading.set(key,job);return job;
 }
 function cached(m){const file=localPath(m);if(!file)return null;const entry=load().files[path.basename(file)];return entry&&entry.size===m.Bytes?entry:null;}
 // Free VRAM from nvidia-smi when present (cached briefly); otherwise the backend's VRAM total with a small reserve.
 function nvidia(){return new Promise(resolve=>{const exe=path.join(process.env.SystemRoot||'C:\\Windows','System32','nvidia-smi.exe');if(!fs.existsSync(exe))return resolve(null);execFile(exe,['--query-gpu=memory.total,memory.used','--format=csv,noheader,nounits'],{timeout:3000,windowsHide:true},(e,out)=>{if(e)return resolve(null);const [total,used]=String(out).split(/\r?\n/)[0].split(',').map(Number);resolve(Number.isFinite(total)&&Number.isFinite(used)?{total:total*1024**2,used:used*1024**2}:null);});});}
 async function hardware({loadedBytes=0}={}){
  // The free-VRAM reading is only reused while the same model usage is resident; a reading taken before a model loaded
  // must not get that model's usage added on top again.
  const free=()=>hw.vramFree==null?null:Math.min(hw.vramTotal??Infinity,hw.vramFree+loadedBytes);
  if(hw&&Date.now()-hwAt<15000&&hwLoaded===loadedBytes)return {...hw,vramFree:free()};
  const smi=await nvidia();const backendVram=backendHardware?.Vram?backendHardware.Vram*GiB:null;
  const vramTotal=smi?.total??backendVram,vramFree=smi?Math.max(0,smi.total-smi.used):(backendVram?Math.max(0,backendVram-0.6*GiB):null);
  hw={vramTotal,vramFree,ramTotal:os.totalmem(),ramFree:os.freemem(),source:smi?'nvidia-smi':backendVram?'backend':'none',gpu:backendHardware?.Gpu||null};hwAt=Date.now();hwLoaded=loadedBytes;
  return {...hw,vramFree:free()};
 }
 return {
  setBackendHardware(h){if(h&&typeof h==='object')backendHardware=h;},
  quantOf,displayNames,
  // Presentation fields added to backend model lists. Metadata-based fields appear once the file has been read.
  decorate(models){if(!Array.isArray(models))return models;const names=displayNames(models);return models.map(m=>{const meta=m.Installed?cached(m):null;return {...m,Display:names.get(m.Name),Detail:(m.Repo?m.Repo+' / ':'')+(m.File||''),Quant:quantOf(m.File),Meta:meta?{thinking:meta.thinking,trainedContext:meta.shape?.trainedContext||null,arch:meta.shape?.arch||null,moe:(meta.shape?.experts||0)>0,experts:meta.shape?.experts||0,expertsUsed:meta.shape?.expertsUsed||0,sizeLabel:meta.sizeLabel}:null};});},
  async read(models){const list=(models||[]).filter(m=>m.Installed);const results=await Promise.all(list.map(metaFor));return results.filter(Boolean).length;},
  meta:cached,
  thinking(m){const meta=m&&cached(m);return meta?meta.thinking:{state:'unknown',reason:'not-read'};},
  hardware,
  async estimate(m,options){const meta=m.Installed?(cached(m)||await metaFor(m)):null;return estimate({...m,shape:meta?.shape||null},{...options,hardware:options.hardware||await hardware()});},
  // Automatic context: the largest of 4K/8K/16K that fits this computer with margin, never above the model's own limit.
  // Fully on the GPU when possible; partly in RAM it stays at 8K at most; CPU only stays at 8K at most.
  async autoContext(m,{kv='f16',gpu='auto',loadedBytes=0,cap=16384}={}){
   const meta=m&&m.Installed?(cached(m)||await metaFor(m)):null,shape=meta?.shape||null,hwNow=await hardware({loadedBytes});
   const trained=shape?.trainedContext||null;let candidates=[4096,8192,16384].filter(c=>c<=cap&&(!trained||c<=trained));if(!candidates.length)candidates=[trained&&trained>=2048?2048:4096];
   if(!m?.Bytes)return {value:4096,reason:'no-size',hardware:hwNow};
   if(!shape)return {value:4096,reason:'no-metadata',hardware:hwNow};
   let best=null;
   for(const c of candidates){const e=estimate({...m,shape},{context:c,kv,gpu,hardware:hwNow});if(e.placement==='gpu')best={value:c,reason:'gpu',estimate:e};}
   // 4K fits fully but 8K only just overflows (at most 15% of the weights would move to RAM): 8K, mostly on the GPU.
   if(best&&best.value===4096&&candidates.includes(8192)&&gpu!=='cpu'&&hwNow.vramFree!=null){const e=estimate({...m,shape},{context:8192,kv,gpu,hardware:hwNow});const overflow=e.need-(hwNow.vramFree-GiB);if(e.placement==='hybrid'&&overflow<=0.15*m.Bytes)return {value:8192,reason:'mostly-gpu',estimate:e,trained,hardware:hwNow};}
   if(best)return {...best,trained,hardware:hwNow};
   const partial=candidates.filter(c=>c<=8192);
   for(const c of partial){const e=estimate({...m,shape},{context:c,kv,gpu,hardware:hwNow});if(e.placement==='hybrid'||e.placement==='cpu')best={value:c,reason:e.placement,estimate:e};}
   if(best)return {...best,trained,hardware:hwNow};
   const smallest=candidates[0];return {value:smallest,reason:'strain',estimate:estimate({...m,shape},{context:smallest,kv,gpu,hardware:hwNow}),trained,hardware:hwNow};
  }
 };
}
module.exports={createModelInfo,displayNames,quantOf,thinkingOf,shapeOf,kvBytes,estimate};
