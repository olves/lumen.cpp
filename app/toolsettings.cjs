'use strict';
// Agent / Search / Browser preferences in <data>/tools-settings.json. API keys are encrypted with Electron safeStorage
// (DPAPI on Windows) and never leave the main process; the renderer only learns whether a key is stored.
const fs=require('node:fs'),path=require('node:path');
const defaults={agent:{enabled:true,auto:true,maxSubtasks:3,maxToolCalls:4,taskSeconds:120},search:{enabled:false,provider:'wikipedia',results:5,language:'auto',endpoint:''},browser:{render:true,panel:true,searchEngine:'duckduckgo',homePage:'',javascript:true,zoom:100,privacySignals:true,popups:'panel',panelWidth:'medium',clearOnExit:false}};
const engines=['duckduckgo','google','bing','brave','startpage'],zooms=[80,90,100,110,125,150];
const providers=['wikipedia','brave','tavily','searxng'];

function createToolSettings(data,safeStorage){
 const file=path.join(data,'tools-settings.json');let cache=null;
 function read(){if(cache)return cache;let stored={};try{stored=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}cache=sanitize(stored);cache.keys=stored&&typeof stored.keys==='object'&&!Array.isArray(stored.keys)?Object.fromEntries(Object.entries(stored.keys).filter(([k,v])=>providers.includes(k)&&typeof v==='string'&&v.length<4096)):{};return cache;}
 function write(){const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(cache,null,1));fs.renameSync(temp,file);}
 function home(value){if(typeof value!=='string'||!value.trim())return '';try{const u=new URL(/^[a-z][a-z0-9+.-]*:/i.test(value.trim())?value.trim():'https://'+value.trim());return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href.slice(0,500):'';}catch{return '';}}
 function int(value,min,max,fallback){const n=Number(value);return Number.isInteger(n)&&n>=min&&n<=max?n:fallback;}
 function sanitize(v={}){
  const a=v.agent||{},s=v.search||{},b=v.browser||{};
  let endpoint='';if(typeof s.endpoint==='string'&&s.endpoint.trim()){try{const u=new URL(s.endpoint.trim());if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password)endpoint=u.href.slice(0,500);}catch{}}
  return {
   agent:{enabled:a.enabled!==false,auto:a.auto!==false,maxSubtasks:int(a.maxSubtasks,1,4,3),maxToolCalls:int(a.maxToolCalls,1,8,4),taskSeconds:int(a.taskSeconds,30,300,120)},
   search:{enabled:s.enabled===true,provider:providers.includes(s.provider)?s.provider:'wikipedia',results:int(s.results,1,8,5),language:['auto','en','tr'].includes(s.language)?s.language:'auto',endpoint},
   browser:{render:b.render!==false,panel:b.panel!==false,searchEngine:engines.includes(b.searchEngine)?b.searchEngine:'duckduckgo',homePage:home(b.homePage),javascript:b.javascript!==false,zoom:zooms.includes(Number(b.zoom))?Number(b.zoom):100,privacySignals:b.privacySignals!==false,popups:b.popups==='block'?'block':'panel',panelWidth:['narrow','medium','wide'].includes(b.panelWidth)?b.panelWidth:'medium',clearOnExit:b.clearOnExit===true}
  };
 }
 function decrypt(provider){const value=read().keys[provider];if(!value||!safeStorage.isEncryptionAvailable())return '';try{return safeStorage.decryptString(Buffer.from(value,'base64'));}catch{return '';}}
 return {
  // Main-process view, including the decrypted key for the selected provider.
  get(){const c=read();return {agent:{...c.agent},search:{...c.search,key:decrypt(c.search.provider)},browser:{...c.browser}};},
  // Renderer view: no secrets.
  public(){const c=read();return {agent:{...c.agent},search:{...c.search,keys:Object.fromEntries(providers.map(p=>[p,!!c.keys[p]]))},browser:{...c.browser},encryption:safeStorage.isEncryptionAvailable()};},
  update(patch){const c=read();const next=sanitize({agent:{...c.agent,...(patch?.agent||{})},search:{...c.search,...(patch?.search||{})},browser:{...c.browser,...(patch?.browser||{})}});cache={...next,keys:c.keys};write();return this.public();},
  setKey(provider,key){if(!providers.includes(provider))throw Error('Unknown provider.');if(typeof key!=='string'||!key.trim()||key.length>512||/\s/.test(key.trim()))throw Error('Enter a valid API key.');if(!safeStorage.isEncryptionAvailable())throw Error('Secure storage is not available on this system, so the key was not saved.');const c=read();c.keys[provider]=safeStorage.encryptString(key.trim()).toString('base64');write();return this.public();},
  clearKey(provider){const c=read();delete c.keys[provider];write();return this.public();}
 };
}
module.exports={createToolSettings,defaults};
