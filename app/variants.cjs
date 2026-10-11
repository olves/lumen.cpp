'use strict';
// Reply versions for regenerated answers, in <data>/conversation-variants.json: {chatId: {index: {active, versions[]}}}.
// The chat file always holds the active version (so context and export use it); the other versions, with their reasoning and
// activity, live here. Only the last assistant message can switch versions, so later turns never depend on a swapped answer.
const fs=require('node:fs'),path=require('node:path');
const MAX_VERSIONS=12,MAX_TEXT=200000;

function createVariantStore(data){
 const file=path.join(data,'conversation-variants.json');let cache=null;
 const validId=id=>typeof id==='string'&&/^[a-f0-9]{32}$/i.test(id);
 function load(){if(cache)return cache;try{cache=JSON.parse(fs.readFileSync(file,'utf8'));if(!cache||typeof cache!=='object'||Array.isArray(cache))cache={};}catch{cache={};}return cache;}
 function save(){const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(cache));fs.renameSync(temp,file);}
 function snapshot(message){
  return {content:String(message?.Content||'').slice(0,MAX_TEXT),interrupted:!!message?.Interrupted,
   reasoning:message?.Reasoning&&typeof message.Reasoning.text==='string'?{text:message.Reasoning.text.slice(0,30000),seconds:message.Reasoning.seconds??null}:null,
   activity:message?.Activity&&typeof message.Activity==='object'?message.Activity:null,created:new Date().toISOString()};
 }
 function entry(chatId,index){const all=load();return all[chatId]?.[index]||null;}
 return {
  entry,
  // Before regenerating: keep the current reply as a version (once) and return the list.
  begin(chatId,index,message){
   if(!validId(chatId)||!Number.isInteger(index)||index<1||index>2000)throw Error('Invalid reply.');
   const all=load(),chat=all[chatId]||(all[chatId]={});let current=chat[index];
   if(!current)current=chat[index]={active:0,versions:[snapshot(message)]};
   else current.versions[current.active]=snapshot(message);
   save();return current;
  },
  // A new reply arrived: it becomes the active version.
  commit(chatId,index,message){const current=entry(chatId,index);if(!current)return null;current.versions.push(snapshot(message));if(current.versions.length>MAX_VERSIONS)current.versions.splice(0,current.versions.length-MAX_VERSIONS);current.active=current.versions.length-1;save();return current;},
  // Regeneration produced nothing: the active version stays; a list with a single version is dropped.
  abandon(chatId,index){const all=load(),current=all[chatId]?.[index];if(!current)return null;const version=current.versions[current.active];if(current.versions.length<2){delete all[chatId][index];if(!Object.keys(all[chatId]).length)delete all[chatId];}save();return version;},
  select(chatId,index,k){const current=entry(chatId,index);if(!current||!Number.isInteger(k)||k<0||k>=current.versions.length)throw Error('Unknown version.');current.active=k;save();return current.versions[k];},
  decorate(chat){
   if(!chat||!validId(chat.Id)||!Array.isArray(chat.Messages))return chat;const list=load()[chat.Id];if(!list)return chat;
   return {...chat,Messages:chat.Messages.map((m,i)=>list[i]&&m.Role==='assistant'&&list[i].versions.length>1?{...m,Variants:{count:list[i].versions.length,active:list[i].active}}:m)};
  },
  branch(from,to,count){const all=load();if(!all[from])return;const copy={};for(const [i,v] of Object.entries(all[from]))if(Number(i)<count)copy[i]=JSON.parse(JSON.stringify(v));if(Object.keys(copy).length){all[to]=copy;save();}},
  forget(id){const all=load();if(all[id]){delete all[id];save();}}
 };
}
module.exports={createVariantStore};
