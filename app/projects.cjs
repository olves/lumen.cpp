'use strict';
// Read-only project folders. A conversation can be bound to a folder the user picked; the model can then list, find, search
// and read text files inside it through bounded tools. Nothing here writes, deletes, runs or installs anything.
// Every path is resolved to its real location and must stay inside the folder's real root (no "..", absolute paths, symbolic
// links or junctions out). Build output, VCS data, .gitignore matches, sensitive files (keys, .env, credentials), binary and
// very large files are excluded by default; a sensitive file is readable only after the user allows that exact file.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path');

const EXCLUDED_DIRS=new Set(['.git','.hg','.svn','node_modules','bower_components','dist','build','out','target','bin','obj','.next','.nuxt','.svelte-kit','.turbo','.parcel-cache','.cache','__pycache__','.venv','venv','.tox','.mypy_cache','.pytest_cache','.ruff_cache','.gradle','.idea','.vs','coverage','.terraform','Pods','DerivedData']);
const SENSITIVE=[/^\.env(\..*)?$/i,/\.(pem|key|p12|pfx|keystore|jks|kdbx|ppk|asc|gpg)$/i,/^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,/^(credentials|secrets?)(\..*)?$/i,/^\.(npmrc|pypirc|netrc|git-credentials)$/i,/^service[-_]?account.*\.json$/i];
const BINARY=/\.(png|jpe?g|gif|webp|bmp|ico|icns|tiff?|psd|pdf|zip|7z|rar|gz|tgz|bz2|xz|tar|exe|dll|so|dylib|lib|a|o|obj|pdb|class|jar|war|wasm|bin|dat|gguf|safetensors|onnx|pt|pth|ckpt|npz|npy|parquet|sqlite3?|db|mdb|mp3|wav|flac|ogg|m4a|mp4|mov|avi|mkv|webm|woff2?|ttf|otf|eot|psd|ai|sketch|fig|docx?|xlsx?|pptx?)$/i;
const LIMITS={fileBytes:1024*1024,listEntries:300,findResults:100,searchMatches:60,searchFiles:4000,searchMs:4000,readLines:300,readChars:20000,lineChars:240,walkEntries:20000};

function isSensitive(name){return SENSITIVE.some(re=>re.test(name));}
// .gitignore subset: comments, negation, directory-only (trailing /), anchored (leading or inner /), * ** ? character classes.
function gitignoreMatcher(text){
 const rules=[];
 for(let line of String(text||'').split(/\r?\n/)){
  line=line.replace(/\s+$/,'');if(!line||line.startsWith('#'))continue;let negate=false;if(line.startsWith('!')){negate=true;line=line.slice(1);}
  let dirOnly=false;if(line.endsWith('/')){dirOnly=true;line=line.slice(0,-1);}if(!line)continue;
  const anchored=line.startsWith('/')||line.slice(0,-1).includes('/');line=line.replace(/^\//,'');
  let re='';for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='*'){if(line[i+1]==='*'){re+='.*';i++;if(line[i+1]==='/')i++;}else re+='[^/]*';}else if(ch==='?')re+='[^/]';else if(ch==='['){const end=line.indexOf(']',i);if(end>i){re+=line.slice(i,end+1);i=end;}else re+='\\[';}else re+=ch.replace(/[.+^${}()|\\]/g,'\\$&');}
  rules.push({negate,dirOnly,re:new RegExp((anchored?'^':'(^|/)')+re+'(/|$)')});
 }
 return (rel,isDir)=>{let ignored=false;for(const r of rules){if(r.dirOnly&&!isDir&&!r.re.source.includes('/|$'))continue;if(r.re.test(rel))ignored=!r.negate;}return ignored;};
}
function globToRegex(glob){let re='';for(let i=0;i<glob.length;i++){const ch=glob[i];if(ch==='*'){if(glob[i+1]==='*'){re+='.*';i++;if(glob[i+1]==='/')i++;}else re+='[^/]*';}else if(ch==='?')re+='[^/]';else re+=ch.replace(/[.+^${}()|[\]\\]/g,'\\$&');}return new RegExp('^'+re+'$','i');}

async function realRoot(root){const real=await fsp.realpath(root);const stat=await fsp.stat(real);if(!stat.isDirectory())throw Error('The project folder is not a folder.');return real;}
function inside(real,rootReal){const a=process.platform==='win32'?real.toLowerCase():real,b=process.platform==='win32'?rootReal.toLowerCase():rootReal;return a===b||a.startsWith(b.endsWith(path.sep)?b:b+path.sep);}

function createProjectTools(binding){
 const root=binding.root,allowed=new Set((binding.allow||[]).map(p=>p.replace(/\\/g,'/').toLowerCase())),userExcludes=(binding.exclude||[]).filter(Boolean).slice(0,50).map(globToRegex);
 let rootReal=null,ignore=null;const readCache=new Map();
 async function setup(){if(rootReal)return;rootReal=await realRoot(root);let text='';for(const f of ['.gitignore','.git/info/exclude']){try{text+='\n'+await fsp.readFile(path.join(rootReal,f),'utf8');}catch{}}ignore=gitignoreMatcher(text);}
 const rel=full=>path.relative(rootReal,full).split(path.sep).join('/');
 function excluded(relPath,isDir){
  const parts=relPath.split('/'),name=parts[parts.length-1];
  if(parts.some((p,i)=>(i<parts.length-1||isDir)&&EXCLUDED_DIRS.has(p)))return 'excluded-folder';
  if(ignore(relPath,isDir))return 'gitignore';if(userExcludes.some(re=>re.test(relPath)||re.test(name)))return 'user-exclude';
  if(!isDir&&isSensitive(name)&&!allowed.has(relPath.toLowerCase()))return 'sensitive';
  if(!isDir&&BINARY.test(name))return 'binary';return null;
 }
 // A user-supplied relative path, resolved and checked against the real root.
 async function resolve(input,{dir=false}={}){
  await setup();const text=String(input??'').trim().replace(/\\/g,'/');
  if(text.includes('\0')||/^[a-z]:/i.test(text)||text.startsWith('/')||text.startsWith('//'))throw Error('Use a path relative to the project folder.');
  const full=path.resolve(rootReal,text||'.');let real;try{real=await fsp.realpath(full);}catch{throw Error('Not found: '+(text||'.'));}
  if(!inside(real,rootReal))throw Error('That path is outside the project folder.');
  const stat=await fsp.stat(real);if(dir&&!stat.isDirectory())throw Error('Not a folder: '+text);if(!dir&&stat.isDirectory())throw Error('That is a folder; use list_dir.');
  const r=rel(real);if(r){const why=excluded(r,stat.isDirectory());if(why)throw Error(r+' is excluded ('+why+').');}
  return {real,rel:r,stat};
 }
 // Files and folders under start, skipping excluded ones and every symbolic link or junction.
 async function walk(start,{depth=Infinity,onFile,onDir,signal}={}){
  let seen=0;const queue=[{dir:start,level:0}];
  while(queue.length){
   if(signal?.aborted)throw Error('Cancelled');const {dir,level}=queue.shift();let entries;try{entries=await fsp.readdir(dir,{withFileTypes:true});}catch{continue;}
   entries.sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||a.name.localeCompare(b.name));
   for(const entry of entries){
    if(++seen>LIMITS.walkEntries)return {truncated:true};if(entry.isSymbolicLink())continue;
    const full=path.join(dir,entry.name),r=rel(full),isDir=entry.isDirectory();if(!isDir&&!entry.isFile())continue;if(excluded(r,isDir))continue;
    if(isDir){if(onDir&&onDir(r,level)===false)return {truncated:true};if(level+1<depth)queue.push({dir:full,level:level+1});}
    else if(onFile&&await onFile(r,full,level)===false)return {truncated:true};
   }
  }
  return {truncated:false};
 }
 async function readText(full,relPath){
  const stat=await fsp.stat(full);if(stat.size>LIMITS.fileBytes)throw Error(relPath+' is larger than 1 MB and is not read.');
  const key=full+'|'+stat.size+'|'+stat.mtimeMs;if(readCache.has(key))return readCache.get(key);
  const buffer=await fsp.readFile(full);if(buffer.subarray(0,8192).includes(0))throw Error(relPath+' looks binary and is not read.');
  const text=buffer.toString('utf8').replace(/^﻿/,'');if(readCache.size>40)readCache.delete(readCache.keys().next().value);readCache.set(key,text);return text;
 }
 return {
  root:()=>rootReal||root,
  async info(){await setup();let files=0;const r=await walk(rootReal,{onFile:()=>{files++;}});return {root:rootReal,name:path.basename(rootReal),files,truncated:r.truncated};},
  async list(input='.',depth=2){
   const dir=await resolve(input,{dir:true});const lines=[];depth=Math.max(1,Math.min(4,Number(depth)||2));
   const r=await walk(dir.real,{depth,onDir:(p,l)=>{if(lines.length>=LIMITS.listEntries)return false;lines.push(p+'/');},onFile:(p)=>{if(lines.length>=LIMITS.listEntries)return false;lines.push(p);}});
   return {path:dir.rel||'.',entries:lines,truncated:r.truncated||lines.length>=LIMITS.listEntries};
  },
  async find(pattern){
   await setup();const text=String(pattern||'').trim().replace(/\\/g,'/');if(!text||text.length>200)throw Error('Give a file name or glob pattern.');
   const re=text.includes('/')?globToRegex(text):globToRegex(text.includes('*')||text.includes('?')?text:'*'+text+'*');const found=[];
   const r=await walk(rootReal,{onFile:p=>{const name=p.split('/').pop();if(re.test(text.includes('/')?p:name)){found.push(p);if(found.length>=LIMITS.findResults)return false;}}});
   return {pattern:text,files:found,truncated:r.truncated||found.length>=LIMITS.findResults};
  },
  async search(query,{path:inPath='.',signal}={}){
   const text=String(query||'');if(text.trim().length<2||text.length>200)throw Error('Search for 2–200 characters.');
   const start=await resolve(inPath,{dir:true});const needle=text.toLowerCase();const matches=[];let files=0,skipped=0;const began=Date.now();
   const r=await walk(start.real,{signal,onFile:async(p,full)=>{
    if(++files>LIMITS.searchFiles||Date.now()-began>LIMITS.searchMs)return false;let body;try{body=await readText(full,p);}catch{skipped++;return;}
    if(!body.toLowerCase().includes(needle))return;const lines=body.split(/\r?\n/);
    for(let i=0;i<lines.length;i++){if(lines[i].toLowerCase().includes(needle)){matches.push({path:p,line:i+1,text:lines[i].trim().slice(0,LIMITS.lineChars)});if(matches.length>=LIMITS.searchMatches)return false;}}
   }});
   return {query:text,path:start.rel||'.',matches,filesScanned:Math.min(files,LIMITS.searchFiles),skipped,truncated:r.truncated||matches.length>=LIMITS.searchMatches};
  },
  async read(input,startLine=1,endLine){
   const file=await resolve(input);const body=await readText(file.real,file.rel);const lines=body.split(/\r?\n/);
   const start=Math.max(1,Math.min(lines.length,Number(startLine)||1));let end=Math.max(start,Math.min(lines.length,Number(endLine)||start+LIMITS.readLines-1,start+LIMITS.readLines-1));
   let out=[],chars=0;for(let i=start;i<=end;i++){const line=lines[i-1];if(chars+line.length>LIMITS.readChars){end=i-1;break;}out.push(line);chars+=line.length+1;}
   return {path:file.rel,start,end,totalLines:lines.length,text:out.join('\n'),truncated:end<lines.length&&end<(Number(endLine)||Infinity),mtime:file.stat.mtimeMs};
  },
  async sensitiveCheck(input){await setup();const text=String(input||'').replace(/\\/g,'/');const full=path.resolve(rootReal,text);const real=await fsp.realpath(full);if(!inside(real,rootReal))throw Error('That file is outside the project folder.');const r=rel(real);if(!isSensitive(r.split('/').pop()))throw Error('Only files excluded as sensitive need to be allowed.');return r;}
 };
}

// Bindings per conversation in <data>/conversation-projects.json.
function createProjectStore(data){
 const file=path.join(data,'conversation-projects.json');let cache=null;const validId=id=>typeof id==='string'&&/^[a-f0-9]{32}$/i.test(id);
 function load(){if(cache)return cache;try{cache=JSON.parse(fs.readFileSync(file,'utf8'));if(!cache||typeof cache!=='object'||Array.isArray(cache))cache={};}catch{cache={};}return cache;}
 function save(){const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(cache,null,1));fs.renameSync(temp,file);}
 return {
  get(chatId){return validId(chatId)?load()[chatId]||null:null;},
  bind(chatId,root){if(!validId(chatId))throw Error('Invalid conversation.');const all=load();all[chatId]={root,name:path.basename(root),boundAt:new Date().toISOString(),allow:all[chatId]?.root===root?all[chatId].allow||[]:[],exclude:all[chatId]?.root===root?all[chatId].exclude||[]:[]};save();return all[chatId];},
  update(chatId,patch){const all=load(),b=all[chatId];if(!b)throw Error('No project is attached.');if(Array.isArray(patch.allow))b.allow=[...new Set(patch.allow.map(String))].slice(0,50);if(Array.isArray(patch.exclude))b.exclude=patch.exclude.map(s=>String(s).trim()).filter(s=>s&&s.length<=200).slice(0,50);save();return b;},
  unbind(chatId){const all=load();if(all[chatId]){delete all[chatId];save();}return null;},
  branch(from,to){const all=load();if(all[from]){all[to]=JSON.parse(JSON.stringify(all[from]));save();}},
  forget(id){this.unbind(id);}
 };
}
module.exports={createProjectTools,createProjectStore,gitignoreMatcher,isSensitive,LIMITS};
