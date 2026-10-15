'use strict';
// Skills: reusable instructions (and optional reference notes) the user selects for a conversation. A skill is text only:
// it cannot run scripts, install anything or change which tools the model may use.
// skills.json v2: {version:2, skills:[{id,name,description,instructions,references[{name,text}],source{type,origin},unsupported[],created,updated}]}.
// A v1 file (a plain array) is migrated once; the original is kept as skills.v1.json. Starter skills are added only when no
// library exists yet. conversation-skills.json keeps per-conversation selections (and the legacy recovery state).
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const validId=id=>typeof id==='string'&&/^[a-f0-9]{32}$/i.test(id);
const LIMITS={name:80,description:240,instructions:8000,references:5,referenceChars:16000,referencesTotal:32000,library:200,perChat:4,legacyPrompt:12000,skillsPrompt:24000,file:65536};
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2));fs.renameSync(file+'.tmp',file);}
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^﻿/,''));}catch(e){if(e.code==='ENOENT')return fallback;throw Error('Cannot read local skill data: '+e.message);}}
function cleanReferences(list){
 if(list==null)return [];if(!Array.isArray(list)||list.length>LIMITS.references)throw Error(`Use at most ${LIMITS.references} reference notes.`);let total=0;
 const out=list.map(r=>{const name=String(r?.name||'').trim().slice(0,120),text=String(r?.text||'').replace(/\r\n/g,'\n').trim();if(!name||!text)throw Error('Each reference needs a name and text.');if(text.length>LIMITS.referenceChars)throw Error(`A reference note can have at most ${LIMITS.referenceChars.toLocaleString('en-US')} characters.`);total+=text.length;return {name,text};});
 if(total>LIMITS.referencesTotal)throw Error(`Reference notes can have at most ${LIMITS.referencesTotal.toLocaleString('en-US')} characters in total.`);return out;
}
function validate(skill,{keepDates=false}={}){
 if(!skill||typeof skill.name!=='string'||!skill.name.trim()||skill.name.trim().length>LIMITS.name||typeof (skill.description??'')!=='string'||String(skill.description??'').length>LIMITS.description||typeof skill.instructions!=='string'||!skill.instructions.trim()||skill.instructions.length>LIMITS.instructions)throw Error('Use a name (1–80), description (up to 240) and instructions (1–8,000 characters).');
 const now=new Date().toISOString(),source=skill.source&&typeof skill.source==='object'?{type:['manual','file','folder','url','starter','plugin'].includes(skill.source.type)?skill.source.type:'manual',origin:String(skill.source.origin||'').slice(0,500)}:{type:'manual',origin:''};
 return {id:validId(skill.id)?skill.id:crypto.randomUUID().replaceAll('-',''),name:skill.name.trim(),description:String(skill.description||'').trim(),instructions:skill.instructions.trim(),references:cleanReferences(skill.references),source,
  unsupported:(Array.isArray(skill.unsupported)?skill.unsupported:[]).map(s=>String(s).slice(0,240)).slice(0,20),created:keepDates&&skill.created?String(skill.created):now,updated:keepDates&&skill.updated?String(skill.updated):now};
}
// SKILL.md: YAML-like front matter (name and description are used; every other field is reported, never applied) and a body.
function parseMarkdown(text,{origin='',type='file'}={}){
 if(typeof text!=='string'||text.length>LIMITS.file)throw Error('A skill file can be at most 64 KB.');
 text=text.replace(/^﻿/,'').replaceAll('\r\n','\n');const unsupported=[];
 if(text.trim().startsWith('{')){let obj;try{obj=JSON.parse(text);}catch{throw Error('The JSON skill file is not valid JSON.');}for(const key of Object.keys(obj))if(!['name','description','instructions','references'].includes(key))unsupported.push(`Field “${key}” is not used.`);return {...validate({name:obj.name,description:obj.description||'',instructions:obj.instructions,references:obj.references,source:{type,origin},unsupported}),draft:true};}
 let name='',description='',body=text;const front=text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
 if(front){
  body=text.slice(front[0].length);
  for(const line of front[1].split('\n')){
   const match=line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);if(!match)continue;const key=match[1].toLowerCase();let value=match[2].trim();
   if(value.startsWith('"')){try{value=JSON.parse(value);}catch{throw Error('Invalid quoted front matter.');}}else if(value.startsWith("'")&&value.endsWith("'"))value=value.slice(1,-1).replaceAll("''","'");
   if(key==='name')name=value;else if(key==='description')description=value;
   else if(['allowed-tools','tools','permissions'].includes(key))unsupported.push(`“${match[1]}” is ignored: skills cannot grant tools or permissions.`);
   else unsupported.push(`Front matter field “${match[1]}” is not used.`);
  }
 }
 if(!name)name=body.match(/^#\s+(.+)$/m)?.[1]||'Imported skill';
 if(description.length>LIMITS.description){unsupported.push('The description was shortened to 240 characters.');description=description.slice(0,LIMITS.description);}
 let instructions=body.trim();if(instructions.length>LIMITS.instructions)throw Error('The skill instructions are longer than 8,000 characters. Shorten them or split the skill.');
 return {...validate({name:name.slice(0,LIMITS.name),description,instructions,source:{type,origin},unsupported}),draft:true};
}
const STARTERS=[
 {name:'Code review',description:'Find concrete bugs, risks and missing checks.',instructions:'Review the provided code. Prioritize reproducible bugs, correctness and security issues. Explain each finding with its impact and a concrete fix. State uncertainty and avoid inventing problems. Respond in the user’s language.'},
 {name:'Debugging',description:'Turn symptoms into testable hypotheses.',instructions:'Help debug systematically. Separate observations from assumptions. Identify the most likely causes, suggest the smallest useful diagnostic step, and explain what each result would imply. Prefer minimal fixes. Respond in the user’s language.'},
 {name:'Technical writing',description:'Clear documentation with practical examples.',instructions:'Write clear, concise technical documentation for the intended audience. Use accurate terminology, practical examples and explicit prerequisites. Do not invent APIs or behavior. Respond in the user’s language.'}
];
function skillText(s){return '\n[Skill: '+s.name+']\n'+s.instructions+(s.references.length?'\n'+s.references.map(r=>'\n[Reference: '+r.name+']\n'+r.text+'\n[End reference]').join('\n'):'')+'\n[End skill]';}
const HEADER='\n\nReusable guidance selected for this conversation:\n';

function createStore(data){
 const file=path.join(data,'skills.json'),metaFile=path.join(data,'conversation-skills.json');let libraryCache,metadataCache;
 function list(){
  if(libraryCache)return libraryCache;let stored=read(file,null),records;
  if(stored===null){records=STARTERS.map(s=>validate({...s,source:{type:'starter'}}));atomic(file,{version:2,skills:records});}
  else if(Array.isArray(stored)){
   // v1 → v2: every record is kept with its id and dates; the original file stays as skills.v1.json.
   const backup=path.join(data,'skills.v1.json');if(!fs.existsSync(backup))fs.copyFileSync(file,backup);
   records=stored.map(s=>validate({...s,created:s.created||s.updated,source:{type:'manual'}},{keepDates:true}));atomic(file,{version:2,skills:records});
  }
  else if(stored&&stored.version===2&&Array.isArray(stored.skills))records=stored.skills.map(s=>validate(s,{keepDates:true}));
  else throw Error('Invalid skill library.');
  if(records.length>LIMITS.library)throw Error('Invalid skill library.');libraryCache=records;return records;
 }
 function save(records){libraryCache=records;atomic(file,{version:2,skills:records});}
 function metadata(){if(metadataCache)return metadataCache;const value=read(metaFile,{});if(!value||Array.isArray(value)||typeof value!=='object')throw Error('Invalid conversation skill data.');metadataCache=value;return value;}
 function upsert(skill){const records=list();if(skill.id&&!validId(skill.id))throw Error('Invalid skill ID.');const previous=records.find(s=>s.id===skill.id);const result=validate({...skill,created:previous?.created},{keepDates:false});if(previous)result.created=previous.created;delete result.draft;const index=records.findIndex(s=>s.id===result.id);if(index<0){if(records.length>=LIMITS.library)throw Error('Skill library is full (200 skills).');records.push(result);}else records[index]=result;save(records);return result;}
 function selected(ids){if(!Array.isArray(ids)||ids.length>LIMITS.perChat||ids.some(id=>!validId(id))||new Set(ids).size!==ids.length)throw Error('Select up to four different skills.');const library=list();return ids.map(id=>{const skill=library.find(s=>s.id===id);if(!skill)throw Error('Selected skill no longer exists.');return skill;});}
 // Guidance text for the selected skills. With the engine host it is added to the request only (never saved in the chat).
 function guidance(ids){const chosen=selected(ids);const text=chosen.length?HEADER.trimStart()+chosen.map(skillText).join('\n'):'';if(text.length>LIMITS.skillsPrompt)throw Error(`The selected skills have ${text.length.toLocaleString('en-US')} characters; at most ${LIMITS.skillsPrompt.toLocaleString('en-US')} can be used together. Select fewer skills or shorten their references.`);return {text,selected:chosen};}
 // Legacy path (original engine without the host): skills are placed in the system prompt, limited to 12,000 characters in total.
 function compile(base,ids){if(typeof base!=='string'||base.length>LIMITS.legacyPrompt)throw Error('Invalid system instructions.');const chosen=selected(ids);const prompt=base+(chosen.length?HEADER+chosen.map(skillText).join('\n'):'');return {prompt,selected:chosen,chars:prompt.length};}
 function budget(base,ids,hostReady){const g=guidance(ids);const chars=(base||'').length+(g.text?g.text.length+2:0);return {chars,skillsChars:g.text.length,limit:hostReady?LIMITS.skillsPrompt:LIMITS.legacyPrompt,legacy:!hostReady,over:hostReady?g.text.length>LIMITS.skillsPrompt:chars>LIMITS.legacyPrompt,tokens:Math.ceil(chars/3.6)};}
 function select(chatId,ids,base=''){if(!validId(chatId))throw Error('Invalid conversation ID.');guidance(ids);const meta=metadata();if(meta[chatId]?.applied)throw Error('Wait until the current response finishes.');meta[chatId]={ids:[...ids],applied:false};atomic(metaFile,meta);return ids;}
 function idsFor(chatId){const known=new Set(list().map(s=>s.id));return (metadata()[chatId]?.ids||[]).filter(id=>known.has(id));}
 function decorate(chat){if(!chat||!validId(chat.Id))return chat;const item=metadata()[chat.Id];return {...chat,SkillIds:idsFor(chat.Id),...(item?.applied?{SystemPrompt:item.basePrompt}:{})};}
 function prepare(chat){
  if(!chat||!validId(chat.Id))throw Error('Invalid conversation ID.');const entry=metadata()[chat.Id];const ids=idsFor(chat.Id);const base=entry?.applied?entry.basePrompt:chat.SystemPrompt;
  const {prompt,selected:chosen}=compile(base||'',ids);if(prompt.length>LIMITS.legacyPrompt)throw Error('Selected skills and system instructions exceed 12,000 characters. Shorten them or select fewer skills.');
  if(!chosen.length)return {chat,base,applied:false};const meta=metadata();meta[chat.Id]={ids,basePrompt:base,applied:true};atomic(metaFile,meta);return {chat:{...chat,SystemPrompt:prompt},base,applied:true};
 }
 function restored(id){const meta=metadata();if(meta[id]){meta[id].applied=false;delete meta[id].basePrompt;atomic(metaFile,meta);}}
 function forget(id){const meta=metadata();delete meta[id];atomic(metaFile,meta);}
 function remove(id){if(!validId(id))throw Error('Invalid skill ID.');const records=list().filter(s=>s.id!==id),meta=metadata();for(const entry of Object.values(meta))entry.ids=(entry.ids||[]).filter(value=>value!==id);save(records);atomic(metaFile,meta);return records;}
 function recover(){const meta=metadata();let changed=false;for(const [id,entry] of Object.entries(meta)){if(!validId(id)||!entry.applied)continue;const chatFile=path.join(data,'chats',id+'.json');if(fs.existsSync(chatFile)){const chat=read(chatFile,null);if(chat?.Id!==id||!Array.isArray(chat.Messages))throw Error('Cannot recover conversation skill state.');chat.SystemPrompt=entry.basePrompt;atomic(chatFile,chat);}entry.applied=false;delete entry.basePrompt;changed=true;}if(changed)atomic(metaFile,meta);}
 function markdown(id){const skill=list().find(s=>s.id===id);if(!skill)throw Error('Skill not found.');return '---\nname: '+JSON.stringify(skill.name)+'\ndescription: '+JSON.stringify(skill.description)+'\n---\n\n'+skill.instructions+'\n'+skill.references.map(r=>'\n## Reference: '+r.name+'\n\n'+r.text+'\n').join('');}
 return {list,upsert,select,decorate,prepare,restored,forget,remove,recover,compile,guidance,budget,idsFor,markdown,parseMarkdown};
}
// SKILL.md folder import: the SKILL.md plus up to five small text references (from references/ or files the skill names).
// Scripts, binaries and anything else are listed as not imported; nothing outside the folder is followed.
async function importFolder(dir){
 const fsp=fs.promises,root=await fsp.realpath(dir),skillFile=path.join(root,'SKILL.md');
 let stat;try{stat=await fsp.stat(skillFile);}catch{throw Error('The folder has no SKILL.md.');}if(!stat.isFile()||stat.size>LIMITS.file)throw Error('SKILL.md must be a file up to 64 KB.');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(await fsp.readFile(skillFile));const draft=parseMarkdown(text,{origin:path.basename(root),type:'folder'});
 const files=[];const walk=async(current,depth)=>{if(depth>2||files.length>200)return;for(const entry of await fsp.readdir(current,{withFileTypes:true})){if(entry.isSymbolicLink())continue;const full=path.join(current,entry.name);const rel=path.relative(root,full).split(path.sep).join('/');if(entry.isDirectory()){if(!/^(\.git|node_modules|__pycache__)$/.test(entry.name))await walk(full,depth+1);}else if(entry.isFile()&&rel!=='SKILL.md')files.push(rel);}};await walk(root,0);
 const mentioned=f=>text.includes(f)||text.includes(path.basename(f));const textual=/\.(md|txt|json|ya?ml|csv|xml|html?)$/i;
 const candidates=files.filter(f=>textual.test(f)&&(f.startsWith('references/')||f.startsWith('reference/')||mentioned(f)));const references=[],notes=[...draft.unsupported];let total=0;
 for(const f of candidates){if(references.length>=LIMITS.references){notes.push(`${f} was not imported: at most ${LIMITS.references} references.`);continue;}const full=path.join(root,f);const real=await fsp.realpath(full);if(!real.startsWith(root+path.sep))continue;const size=(await fsp.stat(real)).size;if(size>LIMITS.referenceChars){notes.push(`${f} was not imported: larger than 16 KB.`);continue;}let body;try{body=new TextDecoder('utf-8',{fatal:true}).decode(await fsp.readFile(real));}catch{notes.push(`${f} was not imported: not UTF-8 text.`);continue;}if(total+body.length>LIMITS.referencesTotal){notes.push(`${f} was not imported: the references would exceed 32 KB.`);continue;}total+=body.length;references.push({name:f,text:body});}
 for(const f of files.filter(f=>!candidates.includes(f))){if(/\.(py|js|mjs|cjs|ts|sh|bash|ps1|bat|cmd|exe|dll|rb|pl)$/i.test(f))notes.push(`${f} was not imported: Lumen skills are instructions only and never run scripts.`);else if(!textual.test(f))notes.push(`${f} was not imported: not a text reference.`);else notes.push(`${f} was not imported: not referenced by SKILL.md and not in references/.`);}
 return {...validate({...draft,references,unsupported:notes.slice(0,20)}),draft:true};
}
module.exports={createStore,parseMarkdown,validate,importFolder,LIMITS};
