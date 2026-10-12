const {app,BrowserWindow,ipcMain,dialog,session,protocol,clipboard,nativeImage,safeStorage}=require('electron');
const {spawn}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');const readline=require('node:readline');
const test=process.argv.includes('--ui-check');const testDir=process.argv.find(a=>a.startsWith('--test-data='))?.slice(12)||process.env.LUMEN_TEST_DIR;if(process.argv.some(a=>a.startsWith('--check-output=')))process.env.LUMEN_CHECK_OUTPUT=process.argv.find(a=>a.startsWith('--check-output=')).slice(15);let win,core;let seq=0;const pending=new Map();
const allowed=new Set(['backend_status','install_backend','bootstrap','models','scan','save','rename','branch','send','search','files','register','download','bench','unload','cancel']);
const data=testDir||path.join(process.env.LOCALAPPDATA,'lumen.cpp');const prefPath=path.join(data,'desktop-preferences.json');

const photoStore=require('./photos.cjs').createStore(data,nativeImage,path.join(__dirname,'backend','lumen-image-ocr.exe'),decodeWebp);const skillStore=require('./skills.cjs').createStore(data);let skillFlight=null;
const {createAgent,createActivityStore,createReasoningStore}=require('./agent.cjs'),{createWeb}=require('./web.cjs'),{createToolSettings}=require('./toolsettings.cjs'),{createDownloader}=require('./downloader.cjs'),{createBrowser}=require('./browser.cjs');
const activityStore=createActivityStore(data),reasoningStore=createReasoningStore(data);
const {createRunSettings,cleanDefaults}=require('./runsettings.cjs'),runSettings=createRunSettings(data);
const documents=require('./documents.cjs').createDocuments(data);
const assistants=require('./assistants.cjs').createAssistants(data);
// Connections (connections.cjs): cloud models, MCP servers and the local API. All off until the user turns them on.
let connections=null,cloud=null,mcpClient=null,apiServer=null,artifacts=null,cloudFlight=null;
// Cloud models join the model list as "cloud:<provider>/<model>" entries; they have no file and are never loaded locally.
function cloudModelEntries(){if(!connections)return [];try{return connections.cloudModels().map(c=>({Name:c.name,Display:c.model+' · '+c.providerLabel,Detail:c.providerLabel+' · '+c.model+' · cloud',Repo:'cloud/'+c.provider,File:c.model,Sha:'',Bytes:0,Installed:true,Cloud:{provider:c.provider,label:c.providerLabel,model:c.model}}));}catch{return [];}}
function withCloud(models){return Array.isArray(models)?[...models.filter(m=>!m.Cloud),...cloudModelEntries()]:models;}
// A cloud reply: the conversation (instructions, skills, document excerpts, messages) goes to the provider chosen for this
// chat and nowhere else. The user message is saved first; a stopped reply keeps what arrived, marked as interrupted.
async function cloudSend(args){
 const chat=args.chat,target=connections?.parseCloud(chat?.Model);
 if(!target)throw Error('Unknown cloud model.');if(!connections.public().cloud.enabled)throw Error('Cloud models are turned off. Turn them on in Settings → Cloud models.');
 if(skillFlight||agent?.active())throw Error('A response is already running.');
 const emit=e=>{if(win&&!win.isDestroyed())win.webContents.send('engine-event',e);};
 skillFlight={id:chat.Id,snapshot:chat};const controller=new AbortController();cloudFlight=controller;let streamed='',reasoning='',firstThought=0,firstText=0;
 try{
  const base=await coreRequest('save',{chat});emit({type:'saved',data:base});
  const p=prefs(),run=runSettings.effective(chat.Id,p),req=runSettings.request(run),vars=promptVariables(p);
  const system=String(chat.SystemPrompt||'').replace(/\{\{\s*(current_date|current_time)\s*\}\}/g,(m,k)=>vars[k]);
  const lastUser=[...chat.Messages].reverse().find(m=>m.Role==='user');const docContext=documents.context(chat.Id,String(lastUser?.DisplayText||lastUser?.Content||''),60000);
  const guidance=[skillStore.guidance(skillStore.idsFor(chat.Id)).text,docContext?.guidance].filter(Boolean).join('\n\n');
  let history=chat.Messages.filter(m=>m.Content).map(m=>({role:m.Role==='assistant'?'assistant':'user',content:String(m.Content)}));
  let total=history.reduce((n,m)=>n+m.content.length,0),omitted=0;while(total>300000&&history.length>1){total-=history[0].content.length;history.shift();omitted++;}
  const messages=[...([system,guidance].filter(Boolean).length?[{role:'system',content:[system,guidance].filter(Boolean).join('\n\n')}]:[]),...history];
  const result=await cloud.chat({provider:target.provider,model:target.model,messages,maxTokens:run.responseTokens,temperature:req.temperature,sampling:req.sampling,signal:controller.signal,
   onChunk:t=>{if(!firstText)firstText=Date.now();streamed+=t;emit({type:'chunk',data:t});},onReasoning:t=>{if(!firstThought)firstThought=Date.now();reasoning+=t;emit({type:'reasoning',data:t});}});
  if(!result.content.trim())throw Error(connections.providerLabel(target.provider)+' returned an empty reply'+(result.finish==='length'?' (the response length ran out).':'.'));
  const saved=await coreRequest('save',{chat:{...base,Messages:[...base.Messages,{Role:'assistant',Content:result.content,Interrupted:result.finish==='length'}]}});
  const index=saved.Messages.length-1;
  if(docContext?.sources.length)documents.recordUse(saved.Id,index,docContext.sources,result.content);
  if(reasoning)reasoningStore.record(saved.Id,index,{text:reasoning.slice(0,30000),seconds:Math.max(1,Math.round(((firstText||Date.now())-firstThought)/1000))});
  const u=result.usage;emit({type:'context',data:{Prompt:Number(u?.prompt_tokens)||0,Generated:Number(u?.completion_tokens)||0,Capacity:0,ModelCapacity:0,OmittedMessages:omitted,Reserved:run.responseTokens,Cloud:connections.providerLabel(target.provider),Counted:!!u}});
  return decorateChat(saved);
 }catch(error){
  if(controller.signal.aborted){
   if(streamed.trim()){try{const saved=await coreRequest('save',{chat:{...chat,Messages:[...chat.Messages,{Role:'assistant',Content:streamed,Interrupted:true}]}});emit({type:'saved',data:decorateChat(saved)});}catch{}}
   throw Object.assign(Error('Cancelled'),{cancelled:true});
  }
  throw error;
 }finally{skillFlight=null;cloudFlight=null;}
}
// {{current_date}} in a system prompt, written out in the interface language (request only; the saved chat keeps the placeholder).
// The conversation's run settings for agent turns: thinking, response length, temperature and sampling for the final answer.
function runOptions(chat){const p=prefs(),run=runSettings.effective(chat.Id,p),req=runSettings.request(run);return {thinking:thinkingFor(chat.Model,{...p,thinking:run.thinking}),responseTokens:run.responseTokens,temperature:req.temperature,sampling:req.sampling};}
// A model load measured with nvidia-smi: GPU memory in use before the request (minus the model it replaces) and after it.
// Other programs are in both readings. The estimate stays in use when there is no reading or the result is implausible.
async function measureLoad(model,context,run){
 const same=loaded&&loaded.model===model&&loaded.context===context;if(same){const keep=loaded.measured;const result=await run();if(keep&&loaded?.model===model&&loaded.context===context)loaded.measured=keep;return result;}
 const replaced=loaded?await loadedUsage():0,before=await modelInfo.vramUsed().catch(()=>null);const result=await run();
 try{const after=await modelInfo.vramUsed(),m=modelNamed(model);if(before!=null&&after!=null&&m&&loaded?.model===model){const used=after-(before-replaced);if(used>128*1048576&&used<m.Bytes*2+2*1073741824)loaded.measured=used;}}catch{}
 return result;
}
function promptVariables(p=prefs()){const now=new Date(),tr=p.language==='tr';return {current_date:now.toLocaleDateString(tr?'tr-TR':'en-GB',{weekday:'long',year:'numeric',month:'long',day:'numeric'}),current_time:now.toLocaleTimeString(tr?'tr-TR':'en-GB',{hour:'2-digit',minute:'2-digit'})};}
const variantStore=require('./variants.cjs').createVariantStore(data);
const {createProjectStore,createProjectTools}=require('./projects.cjs'),projectStore=createProjectStore(data);
const hubJson=async url=>{const response=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Hugging Face: '+response.status);return response.json();};
const visionStore=require('./vision.cjs').createVisionStore(data,{fetchJson:hubJson}),draftStore=require('./drafts.cjs').createDraftStore(data,{fetchJson:hubJson});
// Engine options for lumen-host's llama-server launcher (Settings → Runtime → Performance).
const contextSizes=[2048,4096,8192,16384,32768];
const accentThemes=['warm','graphite','ocean','forest','plum','rose','teal','gold','custom'],hexColor=/^#[0-9a-f]{6}$/i;
const modelInfo=require('./modelinfo.cjs').createModelInfo(data,{log:message=>{try{fs.appendFileSync(path.join(data,'desktop-engine.log'),message+'\n');}catch{}}});
let knownModels=[],loaded=null;const autoChoices=new Map();
// When a message is about the browser or a website, tell the model what Lumen's own browser commands can do, so it points
// the user to them instead of saying nothing can be done. Not added to other messages (it would cost context for nothing).
function browserHint(chat){const last=[...(chat?.Messages||[])].reverse().find(m=>m.Role==='user')?.Content||'';if(!/tarayıcı|browser|web ?site|sitesi|sayfa|tıkla|\bbas\b|click|open .*\.(com|org|net|io)|\.com\b/i.test(last))return '';return 'About Lumen (the app you run in): the user can control Lumen\'s built-in browser panel with short chat messages that Lumen carries out itself, for example "discord\'u aç" / "open github.com", "youtube\'da lofi ara", "giriş yap\'a bas" / "click sign in", "aşağı kaydır", "geri git", "tarayıcıyı kapat", or several joined with "ve" / "and". You cannot operate the browser yourself. If the user wants something done in the browser, give them the exact short command to send. Lumen never types passwords or fills in forms; the user types those in the panel.';}function emitWindow(channel,payload){if(win&&!win.isDestroyed())win.webContents.send(channel,payload);}
// Reads GGUF metadata in the background; the renderer gets decorated models again when new files were read.
function refreshModelMeta(models){knownModels=models;const unread=models.filter(m=>m.Installed&&!modelInfo.meta(m)).length;if(!unread)return;modelInfo.read(models).then(()=>{autoChoices.clear();emitWindow('models-meta',modelInfo.decorate(knownModels));}).catch(()=>{});}
// What the model Lumen has loaded is estimated to use on the GPU (weights, KV cache, buffers); added back to free VRAM so a
// model is never judged against memory it occupies itself. Whether the next request reloads it does not matter for the estimate.
async function loadedUsage(){if(!loaded)return 0;if(loaded.measured)return loaded.measured;const m=modelNamed(loaded.model);if(!m)return 0;const e=await modelInfo.estimate(m,{context:loaded.context||4096,kv:engineOptions().kv,gpu:'auto',hardware:{vramFree:Infinity,ramFree:Infinity}});return e.need||m.Bytes||0;}
function modelNamed(name){return knownModels.find(m=>m.Name===name)||null;}
// Thinking actually requested: models whose template always reasons are parsed as reasoning; unsupported models never get it.
function thinkingFor(name,p=prefs()){const cap=modelInfo.thinking(modelNamed(name));if(cap.state==='supported'&&cap.toggle===false)return true;return p.thinking===true&&cap.state!=='unsupported';}
// Context for a request. Manual: the user's size. Auto: chosen once per model and engine settings for this session.
async function contextFor(name,requested){
 const p=prefs();if(p.contextMode!=='auto')return {value:requested,mode:'manual'};
 const options=engineOptions(p),key=name+'|'+options.gpu+'|'+options.kv;let choice=autoChoices.get(key);
 if(!choice){const m=modelNamed(name);const loadedBytes=await loadedUsage();choice=m?await modelInfo.autoContext(m,{kv:options.kv,gpu:options.gpu,loadedBytes}):{value:4096,reason:'unknown-model'};choice={value:choice.value,reason:choice.reason,trained:choice.trained||null,estimate:choice.estimate||null,reduced:0};autoChoices.set(key,choice);}
 return {value:hostReady?choice.value:Math.min(choice.value,16384),mode:'auto',reason:choice.reason,key};
}
// After a load failure in Auto mode the session choice steps down once per failure (never below 4,096).
function reduceAuto(key){const choice=autoChoices.get(key);if(!choice||choice.value<=4096)return false;const smaller=[4096,8192,16384].filter(v=>v<choice.value).pop();autoChoices.set(key,{...choice,value:smaller,reason:'reduced',reduced:choice.reduced+1});return true;}
// Speed lab results with the settings they were measured with (newest first, at most 100).
const benchPath=path.join(data,'benchmarks.json');
function benchmarks(){try{const list=JSON.parse(fs.readFileSync(benchPath,'utf8'));return Array.isArray(list)?list:[];}catch{return [];}}
function saveBenchmark(result){const list=[result,...benchmarks()].slice(0,100);const temp=benchPath+'.tmp';fs.writeFileSync(temp,JSON.stringify(list));fs.renameSync(temp,benchPath);}
const loadFailure=/Unable to start the local engine|took too long to load|stopped while loading|out of memory|failed to allocate/i;
function engineOptions(p=prefs()){return {gpu:['auto','gpu','cpu'].includes(p.gpuLayers)?p.gpuLayers:'auto',kv:p.kvCache==='q8_0'?'q8_0':'f16',speculative:p.speculative!==false};}
// Photos of the newest user messages (at most 4 images) go to a vision model as images; older ones keep their OCR text.
function visionImages(chat){const decorated=photoStore.decorate(chat),result=[];let left=4;for(let i=decorated.Messages.length-1;i>=0&&left>0;i--){const m=decorated.Messages[i];if(m.Role!=='user'||!Array.isArray(m.Images)||!m.Images.length)continue;const files=[];for(const image of m.Images.slice(0,left)){try{const file=photoStore.file(image.id,'image');if(fs.existsSync(file))files.push(file);}catch{}}if(files.length){left-=files.length;result.unshift({index:i,files,text:visionStore.requestText(m.Content)});}}return result;}
let toolSettings,webTools,agent,browser,downloader,hostReady=false;
const namesPath=path.join(data,'conversation-names.json');
function manualNames(){try{const parsed=JSON.parse(fs.readFileSync(namesPath,'utf8'));return Object.fromEntries(Object.entries(parsed).filter(([id,title])=>/^[a-fA-F0-9]{32}$/.test(id)&&typeof title==='string'&&title.length>0&&title.length<=120));}catch{return {};}}
function saveManualNames(names){const temp=namesPath+'.tmp';fs.writeFileSync(temp,JSON.stringify(names));fs.renameSync(temp,namesPath);}
async function decodeWebp(buffer){if(!win||win.isDestroyed())throw Error('The workspace is unavailable.');const base64=buffer.toString('base64');const script='(async()=>{const bytes=Uint8Array.from(atob('+JSON.stringify(base64)+'),c=>c.charCodeAt(0));const image=await createImageBitmap(new Blob([bytes],{type:"image/webp"}));try{if(image.width*image.height>50000000)throw Error("Use a photo with at most 50 million pixels.");const scale=Math.min(1,1600/Math.max(image.width,image.height)),canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL("image/png").split(",")[1];}finally{image.close();}})()';return Buffer.from(await win.webContents.executeJavaScript(script),'base64');}
function decorateChat(chat){return assistants.decorate(decorateDocuments(decorateProject(variantStore.decorate(visionStore.decorate(reasoningStore.decorate(activityStore.decorate(photoStore.decorate(skillStore.decorate(chat)))))))));}
// Excerpts each reply was given from attached documents ([D#] sources).
function decorateDocuments(chat){if(!chat?.Id||!Array.isArray(chat.Messages))return chat;const used=documents.usedFor(chat.Id);if(!Object.keys(used).length)return chat;return {...chat,Messages:chat.Messages.map((m,i)=>used[i]&&m.Role==='assistant'?{...m,DocSources:used[i]}:m)};}
// The attached project (name and folder) travels with the chat so the renderer can show it; the binding lives in main.
function decorateProject(chat){const b=chat&&projectStore.get(chat.Id);return b?{...chat,Project:{name:b.name,root:b.root,exists:fs.existsSync(b.root)}}:chat;}
function withManualTitle(value){if(!value||typeof value!=='object')return value;const names=manualNames();if(value.Id&&Array.isArray(value.Messages))return decorateChat({...value,...(names[value.Id]?{Title:names[value.Id],CustomTitle:true}:{})});if(Array.isArray(value.chats))return {...value,skills:skillStore.list(),chats:value.chats.map(chat=>decorateChat({...chat,...(names[chat.Id]?{Title:names[chat.Id],CustomTitle:true}:{})}))};return value;}
async function renameConversation(args){const id=args.id,title=typeof args.title==='string'?args.title.replace(/\s+/g,' ').trim():'';if(typeof id!=='string'||!/^[a-fA-F0-9]{32}$/.test(id)||!title||title.length>120)throw Error('Invalid conversation name or ID.');const bootstrap=await request('bootstrap');const chat=bootstrap.chats.find(c=>c.Id===id);if(!chat)throw Error('Conversation not found.');const renamed=await request('save',{chat:{...chat,Title:title}});const names=manualNames();names[id]=title;saveManualNames(names);return {...renamed,Title:title,CustomTitle:true};}

function prefs(){let raw={};try{raw=JSON.parse(fs.readFileSync(prefPath,'utf8'))||{};}catch{}const p={language:'en',motion:true,contextSize:4096,...raw};if(!['auto','manual'].includes(p.contextMode))p.contextMode=Object.prototype.hasOwnProperty.call(raw,'contextSize')?'manual':'auto';return p;}
function coreRequest(action,args={},onEvent=null){if(action==='rename')return renameConversation(args);if(['save','send'].includes(action)&&args.chat){const names=manualNames();if(names[args.chat.Id])args={...args,chat:{...args.chat,Title:names[args.chat.Id]}};}return new Promise((resolve,reject)=>{if(!core||core.killed)return reject(Error('Local engine is unavailable. Restart Lumen.'));const id=String(++seq);pending.set(id,{resolve,reject,onEvent});core.stdin.write(JSON.stringify({id,action,args})+'\n',e=>{if(e){pending.delete(id);reject(e);}});});}

async function request(action,args={}){
 if(['save','send'].includes(action)&&args.chat)photoStore.remember(args.chat);
 if(action==='send'&&/^cloud:/.test(String(args.chat?.Model||'')))return cloudSend(args);
 if(action==='cancel'&&cloudFlight){cloudFlight.abort();return true;}
 if(action==='send'){
  if(skillFlight)throw Error('A response is already running.');const prepared=hostReady?{chat:args.chat,applied:false}:skillStore.prepare(args.chat);const skillGuidance=hostReady?[skillStore.guidance(skillStore.idsFor(args.chat.Id)).text,browserHint(args.chat)].filter(Boolean).join('\n\n'):'';skillFlight={id:args.chat.Id,snapshot:args.chat};
  let reasoning='',firstThought=0,firstText=0,lastSaved=null,sentImages=[];
  try{
   if(!hostReady)return await coreRequest('send',{...args,contextSize:Math.min(args.contextSize,16384),chat:prepared.chat});
   const p=prefs(),run=runSettings.effective(args.chat.Id,p),thinking=thinkingFor(prepared.chat.Model,{...p,thinking:run.thinking}),responseTokens=run.responseTokens,runRequest=runSettings.request(run);
   const forward=e=>{if(e.type==='reasoning'){if(!firstThought)firstThought=Date.now();reasoning+=e.data;}else if(e.type==='chunk'&&!firstText)firstText=Date.now();else if(e.type==='saved')lastSaved=e.data;if(win&&!win.isDestroyed())win.webContents.send('engine-event',{...e,data:e.type==='saved'?withManualTitle(e.data):e.data});};
   // Thinking needs room: with it on, at least 2,048 tokens are reserved for the reply (the host caps this at half the window).
   const projector=visionStore.projector(prepared.chat.Model),images=projector?visionImages(args.chat):[];sentImages=images.map(x=>x.index);
   let context=await contextFor(prepared.chat.Model,args.contextSize),result;
   // Attached documents: whole when they fit, otherwise the passages that best match the latest message. About 45% of what the
   // window leaves after the reply, at ~3.2 characters per token.
   const lastUser=[...args.chat.Messages].reverse().find(m=>m.Role==='user');const docContext=documents.context(args.chat.Id,String(lastUser?.DisplayText||lastUser?.Content||''),Math.max(2000,Math.floor((context.value-(thinking?Math.max(responseTokens,2048):responseTokens))*0.45*3.2)));
   const guidanceWithDocs=[skillGuidance,docContext?.guidance].filter(Boolean).join('\n\n');
   await measureLoad(prepared.chat.Model,context.value,async()=>{for(let attempt=0;;attempt++){
    try{result=await coreRequest('chat',{chat:prepared.chat,guidance:guidanceWithDocs,contextSize:context.value,projector:projector||'',images,engine:engineOptions(p),draft:draftStore.path(prepared.chat.Model)||'',thinking,maxTokens:thinking?Math.max(responseTokens,2048):responseTokens,temperature:runRequest.temperature,sampling:runRequest.sampling,variables:promptVariables(p)},forward);break;}
    catch(error){if(attempt===0&&context.mode==='auto'&&!lastSaved&&loadFailure.test(error.message)&&reduceAuto(context.key)){context=await contextFor(prepared.chat.Model,args.contextSize);continue;}throw error;}
   }
   loaded={model:prepared.chat.Model,context:context.value};});
   if(docContext?.sources.length&&result?.Messages?.at(-1)?.Role==='assistant')documents.recordUse(result.Id,result.Messages.length-1,docContext.sources,result.Messages.at(-1).Content);
   if(reasoning&&result?.Messages?.at(-1)?.Role==='assistant'){reasoningStore.record(result.Id,result.Messages.length-1,{text:reasoning,seconds:Math.max(1,Math.round(((firstText||Date.now())-firstThought)/1000))});reasoning='';}
   if(sentImages.length){visionStore.markSeen(result.Id,sentImages);sentImages=[];}
   return decorateChat(result);
  }
  finally{
   const saved=lastSaved;if(sentImages.length&&saved?.Id)try{visionStore.markSeen(saved.Id,sentImages);}catch{}if(reasoning&&saved?.Messages?.length&&saved.Messages.at(-1).Role==='assistant')try{reasoningStore.record(saved.Id,saved.Messages.length-1,{text:reasoning,seconds:Math.max(1,Math.round(((firstText||Date.now())-firstThought)/1000))});}catch{}
   const snapshot=skillFlight?.snapshot||args.chat;try{if(prepared.applied){await coreRequest('save',{chat:{...snapshot,SystemPrompt:prepared.base}});skillStore.restored(args.chat.Id);}}finally{skillFlight=null;}}
 }
 if(action==='bench'&&hostReady){
  const name=String(args.name||''),profile=args.profile==='current'?'current':'standard';const m=modelNamed(name);if(!m||!m.Installed)throw Error('Choose a downloaded model.');
  const p=prefs(),context=profile==='current'?(await contextFor(name,p.contextSize)).value:2048;loaded=null;
  const result=await coreRequest('benchmark',{model:name,profile,contextSize:context,engine:engineOptions(p),draft:draftStore.path(name)||''});
  loaded={model:name,context:result.Context||context};saveBenchmark(result);return result;
 }
 const result=await coreRequest(action,args);
 if(action==='bench'&&result&&typeof result==='object'){const legacy={...result,Protocol:'legacy'};saveBenchmark(legacy);return legacy;}
 if(action==='bootstrap'&&result&&Array.isArray(result.models)){modelInfo.setBackendHardware(result.hardware);refreshModelMeta(result.models);return {...result,models:withCloud(modelInfo.decorate(result.models))};}
 if(action==='models'&&Array.isArray(result)){refreshModelMeta(result);return withCloud(modelInfo.decorate(result));}
 if(action==='download'&&Array.isArray(result))return withCloud(modelInfo.decorate(result));
 if(action==='unload')loaded=null;
 if(action==='branch'){photoStore.branch(args.chat.Id,result.Id,args.count);activityStore.branch(args.chat.Id,result.Id,args.count);reasoningStore.branch(args.chat.Id,result.Id,args.count);runSettings.branch(args.chat.Id,result.Id);documents.branch(args.chat.Id,result.Id);visionStore.branch(args.chat.Id,result.Id,args.count);variantStore.branch(args.chat.Id,result.Id,args.count);projectStore.branch(args.chat.Id,result.Id);assistants.branch(args.chat.Id,result.Id);skillStore.select(result.Id,decorateChat(args.chat).SkillIds,args.chat.SystemPrompt);return decorateChat(result);}
 return result;
}

function sender(event){if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('Invalid IPC sender');}
app.setName('lumen.cpp');app.setAppUserModelId('Lumen.Beta.Desktop');
protocol.registerSchemesAsPrivileged([{scheme:'lumen',privileges:{standard:true,secure:true,supportFetchAPI:true}},{scheme:'lumen-artifact',privileges:{standard:true,secure:true}}]);
if(!test&&!app.requestSingleInstanceLock()){app.quit();}else{
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
app.whenReady().then(async()=>{
 fs.mkdirSync(data,{recursive:true});skillStore.recover();
 protocol.handle('lumen',req=>{const u=new URL(req.url);const file=u.pathname==='/'?'index.html':u.pathname.slice(1);const types={'lumen.svg':'image/svg+xml','index.html':'text/html; charset=utf-8','style.css':'text/css; charset=utf-8','renderer.js':'text/javascript; charset=utf-8','workspace.js':'text/javascript; charset=utf-8','explore.js':'text/javascript; charset=utf-8','explore.css':'text/css; charset=utf-8','design.js':'text/javascript; charset=utf-8','tools.js':'text/javascript; charset=utf-8','tools.css':'text/css; charset=utf-8','controls.js':'text/javascript; charset=utf-8','vision.js':'text/javascript; charset=utf-8','speed.js':'text/javascript; charset=utf-8','models.js':'text/javascript; charset=utf-8','lab.js':'text/javascript; charset=utf-8','format.js':'text/javascript; charset=utf-8','regen.js':'text/javascript; charset=utf-8','search.js':'text/javascript; charset=utf-8','project.js':'text/javascript; charset=utf-8','skillsui.js':'text/javascript; charset=utf-8','updates.js':'text/javascript; charset=utf-8','themes.js':'text/javascript; charset=utf-8','browse.js':'text/javascript; charset=utf-8','notices.js':'text/javascript; charset=utf-8','run.js':'text/javascript; charset=utf-8','picks.js':'text/javascript; charset=utf-8','imports.js':'text/javascript; charset=utf-8','docs.js':'text/javascript; charset=utf-8','run.css':'text/css; charset=utf-8','assistants.js':'text/javascript; charset=utf-8','connect.js':'text/javascript; charset=utf-8','artifacts.js':'text/javascript; charset=utf-8','extras.css':'text/css; charset=utf-8','engineui.js':'text/javascript; charset=utf-8','themes.css':'text/css; charset=utf-8','format.css':'text/css; charset=utf-8','vendor/markdown-it.min.js':'text/javascript; charset=utf-8','vendor/highlight.min.js':'text/javascript; charset=utf-8','vendor/katex.min.js':'text/javascript; charset=utf-8','vendor/katex.min.css':'text/css; charset=utf-8','controls.css':'text/css; charset=utf-8','polish.css':'text/css; charset=utf-8','photos.js':'text/javascript; charset=utf-8','photos.css':'text/css; charset=utf-8','design.css':'text/css; charset=utf-8','previews/desk-dark.png':'image/png','previews/desk-light.png':'image/png','previews/studio-dark.png':'image/png','previews/studio-light.png':'image/png',"logos/qwen.webp":"image/webp","logos/llama.webp":"image/webp","logos/mistral.webp":"image/webp","logos/deepseek.webp":"image/webp","logos/gemma.webp":"image/webp","logos/phi.webp":"image/webp","logos/tinyllama.webp":"image/webp"};if(u.hostname==='app'){const match=file.match(/^(photo|photo-thumb)\/([a-f0-9]{64})\.png$/);if(match){try{return new Response(fs.readFileSync(photoStore.file(match[2],match[1]==='photo-thumb'?'thumb':'image')),{headers:{'content-type':'image/png','cache-control':'private, max-age=86400'}});}catch{return new Response('Not found',{status:404});}}}if(/^vendor\/fonts\/KaTeX_[A-Za-z0-9-]+\.woff2$/.test(file))types[file]='font/woff2';if(u.hostname!=='app'||!types[file])return new Response('Not found',{status:404});let content=fs.readFileSync(path.join(__dirname,file));if(file==='index.html'){const p=prefs();content=content.toString('utf8').replace('<body>','<body'+(p.motion===false?' class="no-motion"':'')+' data-layout="'+(p.layout==='studio'?'studio':'desk')+'" data-mode="'+(p.colorMode==='light'?'light':'dark')+'" data-theme="'+(accentThemes.includes(p.theme)?p.theme:'warm')+'">');}return new Response(content,{headers:{'content-type':types[file]}});});
 // lumen-host (backend/LumenHost.cs + LumenCore.cs) is the local engine process: chats, models, engine setup and llama-server.
 const fail=e=>{for(const p of pending.values())p.reject(e);pending.clear();if(win&&!win.isDestroyed())win.webContents.send('engine-event',{type:'fatal',data:{message:e.message}});};
 function startCore(){
  const child=spawn(path.join(__dirname,'backend','lumen-host.exe'),['--bridge',data],{windowsHide:true,stdio:['pipe','pipe','pipe']});core=child;hostReady=true;
  child.stderr.on('data',d=>fs.appendFileSync(path.join(data,'desktop-engine.log'),d));
  child.on('error',e=>{if(core===child)fail(e);});
  child.on('exit',()=>{if(core!==child)return;fail(Error('Local engine stopped. Restart Lumen.'));});
  readline.createInterface({input:child.stdout}).on('line',line=>{try{const e=JSON.parse(line);if(e.type==='saved'&&skillFlight?.id===e.data.Id)skillFlight.snapshot=e.data;const p=pending.get(e.id);if(e.type==='done'){pending.delete(e.id);p?.resolve(withManualTitle(e.data));}else if(e.type==='error'){pending.delete(e.id);const error=Error(e.data.message);error.cancelled=e.data.cancelled;p?.reject(error);}else if(p?.onEvent)p.onEvent(e);else if(win&&!win.isDestroyed())win.webContents.send('engine-event',{...e,data:e.type==='saved'?withManualTitle(e.data):e.data});}catch(e){fail(Error('Invalid engine response.'));}});
 }
 startCore();
 win=new BrowserWindow({width:1240,height:860,minWidth:780,minHeight:580,frame:false,backgroundColor:prefs().colorMode==='light'?(prefs().layout==='studio'?'#eef1f1':'#faf8f4'):'#1c1c1b',show:false,title:'lumen.cpp',icon:path.join(__dirname,'lumen.ico'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false,backgroundThrottling:!test}});
 session.defaultSession.setPermissionRequestHandler((wc,permission,callback)=>callback(false));
 win.webContents.on('will-navigate',e=>e.preventDefault());win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('render-process-gone',(_event,details)=>fs.appendFileSync(path.join(data,'desktop-engine.log'),JSON.stringify(details)+'\n'));
 ipcMain.handle('engine',async(e,action,args)=>{sender(e);if(!allowed.has(action)||JSON.stringify(args||{}).length>4000000)throw Error('Invalid request');return request(action,args);});
 ipcMain.handle('preferences',(e,value)=>{sender(e);if(value){const previous=prefs();const p={...previous,layout:['desk','studio'].includes(value.layout)?value.layout:(previous.layout||'desk'),colorMode:['light','dark'].includes(value.colorMode)?value.colorMode:(previous.colorMode||'dark'),designChosen:previous.designChosen===true||value.designChosen===true,theme:accentThemes.includes(value.theme)?value.theme:(accentThemes.includes(previous.theme)?previous.theme:'warm'),accentColor:hexColor.test(value.accentColor||'')?value.accentColor.toLowerCase():(hexColor.test(previous.accentColor||'')?previous.accentColor:undefined),textSize:[13,14,15,16].includes(value.textSize)?value.textSize:14,language:value.language==='tr'?'tr':'en',motion:!!value.motion,contextSize:contextSizes.includes(value.contextSize)?value.contextSize:(contextSizes.includes(previous.contextSize)?previous.contextSize:4096),contextMode:['auto','manual'].includes(value.contextMode)?value.contextMode:previous.contextMode,gpuLayers:['auto','gpu','cpu'].includes(value.gpuLayers)?value.gpuLayers:(['auto','gpu','cpu'].includes(previous.gpuLayers)?previous.gpuLayers:'auto'),speculative:typeof value.speculative==='boolean'?value.speculative:previous.speculative!==false,kvCache:['f16','q8_0'].includes(value.kvCache)?value.kvCache:(previous.kvCache==='q8_0'?'q8_0':'f16'),thinking:typeof value.thinking==='boolean'?value.thinking:previous.thinking===true,showThinking:typeof value.showThinking==='boolean'?value.showThinking:previous.showThinking!==false,responseTokens:[512,1024,2048,4096].includes(value.responseTokens)?value.responseTokens:([512,1024,2048,4096].includes(previous.responseTokens)?previous.responseTokens:512),creativity:['precise','balanced','creative'].includes(value.creativity)?value.creativity:(['precise','balanced','creative'].includes(previous.creativity)?previous.creativity:'balanced'),sampling:(()=>{try{return cleanDefaults(value.sampling===undefined?previous.sampling:value.sampling);}catch{return cleanDefaults(previous.sampling);}})()};fs.writeFileSync(prefPath,JSON.stringify(p));return p;}return prefs();});
 ipcMain.on('window',(e,action)=>{sender(e);if(action==='minimize')win.minimize();if(action==='maximize')win.isMaximized()?win.unmaximize():win.maximize();if(action==='close')win.close();});
 ipcMain.handle('export',async(e,text)=>{sender(e);if(typeof text!=='string'||text.length>4000000)throw Error('Invalid export');const result=await dialog.showSaveDialog(win,{defaultPath:'lumen-chat.md',filters:[{name:'Markdown',extensions:['md']}]});if(!result.canceled)fs.writeFileSync(result.filePath,text,'utf8');return !result.canceled;});
 ipcMain.handle('copy',(e,text)=>{sender(e);if(typeof text!=='string'||text.length>4000000)throw Error('Invalid clipboard content');clipboard.writeText(text);return true;});
 ipcMain.handle('delete-chat',async(e,id,title,language)=>{sender(e);if(typeof id!=='string'||!/^[a-fA-F0-9]{32}$/.test(id))throw Error('Invalid conversation ID');const tr=language==='tr';const answer=await dialog.showMessageBox(win,{type:'warning',title:tr?'Sohbeti sil':'Delete conversation',message:tr?'Bu sohbet silinsin mi?':'Delete this conversation?',detail:`“${String(title||'').slice(0,200)}”\n\n`+(tr?'Sohbet ve kayıtlı mesajları kalıcı olarak silinecek. Bu işlem geri alınamaz.':'The conversation and its saved messages will be permanently deleted. This cannot be undone.'),buttons:tr?['Vazgeç','Sil']:['Cancel','Delete'],defaultId:0,cancelId:0,noLink:true});if(answer.response!==1)return {deleted:false};await request('delete',{id});skillStore.forget(id);photoStore.forget(id);activityStore.forget(id);reasoningStore.forget(id);runSettings.remove(id);documents.forget(id);visionStore.forget(id);variantStore.forget(id);projectStore.forget(id);assistants.forget(id);const names=manualNames();if(names[id]){delete names[id];saveManualNames(names);}return {deleted:true};});
 ipcMain.handle('attach-text',async(e,language)=>{sender(e);const tr=language==='tr';const result=await dialog.showOpenDialog(win,{title:tr?'Metin veya kod dosyası ekle':'Attach text or code files',properties:['openFile','multiSelections'],filters:[{name:tr?'UTF-8 metin ve kod':'UTF-8 text & code',extensions:['txt','md','json','js','ts','tsx','jsx','py','cs','cpp','c','h','html','css','yaml','yml','toml','xml','csv','log','rs','go','java','sql','sh','ps1']}]});if(result.canceled)return [];if(result.filePaths.length>5)throw Error(tr?'En fazla 5 dosya ekleyebilirsin.':'Attach up to 5 files.');const files=[];let chars=0;for(const file of result.filePaths){const stat=await fs.promises.stat(file);if(!stat.isFile()||stat.size>1048576)throw Error(tr?'Her dosya en fazla 1 MB olmalı.':'Each file must be at most 1 MB.');const buffer=await fs.promises.readFile(file);if(buffer.includes(0))throw Error(tr?'Yalnızca metin ve kod dosyaları destekleniyor.':'Only text and code files are supported.');const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);chars+=text.length;if(chars>45000)throw Error(tr?'Dosyaların toplamı 45.000 karakteri aşamaz.':'Files must total at most 45,000 characters.');files.push({name:path.basename(file),text,bytes:stat.size});}return files;});
 
 ipcMain.handle('photos',async(e,action,args={})=>{sender(e);if(JSON.stringify(args).length>10000)throw Error('Invalid photo request.');if(action==='info')return args.retain===true?photoStore.retain({id:args.id,name:args.name}):photoStore.publicPhoto({id:args.id,name:args.name});if(action==='release'){if(!Array.isArray(args.ids)||args.ids.length>4)throw Error('Invalid photo IDs.');photoStore.release(args.ids);return true;}if(action==='choose'){if(skillFlight)throw Error('Wait until the response finishes.');const tr=args.language==='tr';const choice=await dialog.showOpenDialog(win,{title:tr?'Fotoğraf ekle':'Add photos',properties:['openFile','multiSelections'],filters:[{name:tr?'Fotoğraflar':'Photos',extensions:['png','jpg','jpeg','webp']}]});if(choice.canceled)return [];return photoStore.importFiles(choice.filePaths,args.language);}if(action==='paste'){if(skillFlight)throw Error('Wait until the response finishes.');const items=await clipboard.read();for(const item of items){const type=item.types.find(type=>['image/png','image/jpeg','image/webp'].includes(type));if(!type)continue;const blob=await item.getType(type);if(blob.size>12582912)throw Error('Each photo must be at most 12 MB.');return photoStore.importBuffer(Buffer.from(await blob.arrayBuffer()),'Screenshot.'+(type==='image/jpeg'?'jpg':type==='image/webp'?'webp':'png'),args.language);}return [];}throw Error('Invalid photo action.');});
 ipcMain.handle('skills',async(e,action,args={})=>{
  sender(e);if(JSON.stringify(args).length>100000)throw Error('Skill request too large.');if(skillFlight&&!['list','export','preview','budget','import','import-url','reference-file'].includes(action))throw Error('Wait until the response finishes.');
  if(action==='list')return skillStore.list();
  if(action==='upsert')return skillStore.upsert(args.skill);
  if(action==='select')return skillStore.select(args.chatId,args.ids,args.basePrompt||'');
  if(action==='preview'){if(!hostReady)return skillStore.compile(args.basePrompt||'',args.ids||[]).prompt;const g=skillStore.guidance(args.ids||[]);return [String(args.basePrompt||''),g.text].filter(Boolean).join('\n\n');}
  if(action==='budget')return skillStore.budget(String(args.basePrompt||''),args.ids||[],hostReady);
  if(action==='remove'){const skill=skillStore.list().find(s=>s.id===args.id);if(!skill)throw Error('Skill not found.');const tr=args.language==='tr';const answer=await dialog.showMessageBox(win,{type:'warning',message:tr?'Skill silinsin mi?':'Delete this skill?',detail:skill.name,buttons:tr?['Vazgeç','Sil']:['Cancel','Delete'],defaultId:0,cancelId:0,noLink:true});return answer.response===1?{removed:true,skills:skillStore.remove(args.id)}:{removed:false,skills:skillStore.list()};}
  if(action==='import'){
   const folder=args.folder===true;const choice=await dialog.showOpenDialog(win,{title:folder?'Select a folder containing SKILL.md':'Import a skill',properties:[folder?'openDirectory':'openFile'],...(folder?{}:{filters:[{name:'Skill',extensions:['md','json']}]})});if(choice.canceled)return null;
   // Returns a draft for review; nothing is saved until the user confirms.
   if(folder)return require('./skills.cjs').importFolder(choice.filePaths[0]);
   const file=choice.filePaths[0];const stat=await fs.promises.stat(file);if(!stat.isFile()||stat.size>65536)throw Error('Use a SKILL.md or JSON file up to 64 KB.');const bytes=await fs.promises.readFile(file);let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('The skill file is not UTF-8 text.');}return skillStore.parseMarkdown(text,{origin:path.basename(file),type:'file'});
  }
  // URL import: https only, through the guarded fetch (no local or private addresses), 64 KB at most; GitHub file pages are
  // read from their raw address. The result is a draft for review.
  if(action==='import-url'){
   let url;try{url=new URL(String(args.url||'').trim());}catch{throw Error('Enter a valid https address.');}if(url.protocol!=='https:')throw Error('Use an https address.');
   const gh=url.hostname==='github.com'&&url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);if(gh)url=new URL('https://raw.githubusercontent.com/'+gh[1]+'/'+gh[2]+'/'+gh[3]);
   const {guardedFetch}=require('./web.cjs');const response=await guardedFetch(url.href,{timeoutMs:15000,maxBytes:65537,headers:{accept:'text/markdown,text/plain,application/json;q=0.9,*/*;q=0.1'}});
   if(response.status!==200)throw Error('The address returned '+response.status+'.');if(response.truncated||response.body.length>65536)throw Error('The skill file is larger than 64 KB.');
   if(/text\/html/i.test(String(response.headers['content-type']||'')))throw Error('That address is a web page, not a skill file. Use the raw file address.');
   let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(response.body);}catch{throw Error('The file is not UTF-8 text.');}
   return skillStore.parseMarkdown(text,{origin:url.href,type:'url'});
  }
  // A reference note from a local UTF-8 text file (16 KB at most).
  if(action==='reference-file'){const choice=await dialog.showOpenDialog(win,{title:args.language==='tr'?'Referans dosyası seç':'Choose a reference file',properties:['openFile'],filters:[{name:'Text',extensions:['md','txt','json','yaml','yml','csv','xml','html']}]});if(choice.canceled)return null;const file=choice.filePaths[0];const stat=await fs.promises.stat(file);if(stat.size>16000)throw Error('A reference note can be at most 16 KB.');let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(await fs.promises.readFile(file));}catch{throw Error('The file is not UTF-8 text.');}return {name:path.basename(file),text};}
  if(action==='export'){const text=skillStore.markdown(args.id);const result=await dialog.showSaveDialog(win,{defaultPath:'SKILL.md',filters:[{name:'Markdown skill',extensions:['md']}]});if(!result.canceled)await fs.promises.writeFile(result.filePath,text,'utf8');return !result.canceled;}
  throw Error('Invalid skill action.');
 });
 const modelInfoCache=new Map();
 // What a model can do, from the chat template Hugging Face reports (the same template llama-server applies): thinking switch,
 // images and tool calls. null means unknown (no template). Seeing images also needs the vision file (mmproj) from the repository.
 function capsOf(gguf,pipeline){
  const template=typeof gguf?.chat_template==='string'?gguf.chat_template:'';const thinking=require('./modelinfo.cjs').thinkingOf(template);
  return {thinking:thinking.state,thinkingToggle:thinking.toggle!==false,vision:pipeline==='image-text-to-text'||/image_url|<\|image|<image|image_pad|start_of_image|<\|vision/i.test(template)?true:template?false:null,tools:template?/\btools\b|tool_call/.test(template):null};
 }
 ipcMain.handle('model-info',async(e,repo)=>{
  sender(e);if(typeof repo!=='string'||! /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))throw Error('Invalid model repository.');if(modelInfoCache.has(repo))return modelInfoCache.get(repo);
  const response=await fetch('https://huggingface.co/api/models/'+repo,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Hugging Face: '+response.status);const info=await response.json();const result={repo,downloads:info.downloads||0,likes:info.likes||0,updated:info.lastModified||null,architecture:info.gguf?.architecture||null,parameters:Number(info.gguf?.total)||null,context:Number(info.gguf?.context_length)||null,caps:capsOf(info.gguf,info.pipeline_tag),readme:''};
  try{const readme=await fetch('https://huggingface.co/'+repo+'/raw/main/README.md',{signal:AbortSignal.timeout(10000)});if(readme.ok){const reader=readme.body.getReader();let bytes=0,chunks=[];while(bytes<24000){const part=await reader.read();if(part.done)break;chunks.push(part.value.subarray(0,24000-bytes));bytes+=part.value.length;}await reader.cancel();result.readme=Buffer.concat(chunks).toString('utf8').slice(0,16000);}}catch{}
  if(modelInfoCache.size>=24)modelInfoCache.delete(modelInfoCache.keys().next().value);modelInfoCache.set(repo,result);return result;
 });
 // Explore collections: public GGUF listings with the metadata needed for rows. Repo IDs are validated before reaching the renderer.
 const hubCache=new Map();
 ipcMain.handle('hub',async(e,kind,query='')=>{
  sender(e);if(!['popular','coding','compact','search'].includes(kind)||typeof query!=='string'||query.length>80||(kind==='search'&&!query.trim()))throw Error('Invalid model search.');
  const key=kind+':'+query.trim().toLowerCase();if(hubCache.has(key))return hubCache.get(key);
  const params=new URLSearchParams({filter:'gguf',sort:'downloads',direction:'-1',limit:kind==='compact'?'100':'40'});for(const field of ['downloads','likes','lastModified','gguf','pipeline_tag'])params.append('expand[]',field);
  if(kind==='search')params.set('search',query.trim());else params.set('pipeline_tag','text-generation');if(kind==='coding')params.set('search','coder');
  const response=await fetch('https://huggingface.co/api/models?'+params,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Hugging Face: '+response.status);const list=await response.json();
  let result=(Array.isArray(list)?list:[]).filter(m=>typeof m?.id==='string'&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(m.id)).map(m=>({repo:m.id,downloads:Number(m.downloads)||0,likes:Number(m.likes)||0,updated:typeof m.lastModified==='string'?m.lastModified:null,parameters:Number(m.gguf?.total)||null,architecture:typeof m.gguf?.architecture==='string'?m.gguf.architecture.slice(0,40):null,context:Number(m.gguf?.context_length)||null,caps:capsOf(m.gguf,m.pipeline_tag)}));
  if(kind==='compact')result=result.filter(m=>m.parameters&&m.parameters<=4.5e9);result=result.slice(0,30);
  if(hubCache.size>=12)hubCache.delete(hubCache.keys().next().value);hubCache.set(key,result);return result;
 });
 ipcMain.handle('open-model',async(e,repo)=>{sender(e);if(typeof repo!=='string'||! /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))throw Error('Invalid model repository.');await require('electron').shell.openExternal('https://huggingface.co/'+repo);return true;});

 // ---------- Tools: settings, web, browser, agent runtime and the model downloader ----------
 const send=(channel,payload)=>{if(win&&!win.isDestroyed())win.webContents.send(channel,payload);};
 toolSettings=createToolSettings(data,safeStorage);
 connections=require('./connections.cjs').createConnections(data,safeStorage);
 cloud=require('./cloud.cjs').createCloud({connections,version:app.getVersion()});
 mcpClient=require('./mcp.cjs').createMcp({version:app.getVersion()});
 artifacts=require('./artifacts.cjs').createArtifacts({BrowserWindow,session,getWindow:()=>win,icon:path.join(__dirname,'lumen.ico')});
 // The web session (persist:lumen-web), its request filter and views are created on first use, not at startup.
 const getBrowser=()=>browser||(browser=createBrowser({getWindow:()=>win,emit:state=>send('browser-event',state),getSettings:()=>toolSettings.get().browser}));
 webTools=createWeb({render:(url,options)=>toolSettings.get().browser.render?getBrowser().render(url,options):Promise.reject(Object.assign(Error('JavaScript rendering is off.'),{code:'disabled'}))});
 const engine={
  complete({model,contextSize,messages,schema,maxTokens,temperature,sampling,stream,thinking,onChunk,onReasoning,signal,timeoutMs}){
   if(!hostReady)return Promise.reject(Error('Tools need the bundled engine host, which is not available. Normal chat still works.'));
   if(signal?.aborted)return Promise.reject(Object.assign(Error('Cancelled'),{cancelled:true}));
   const result=coreRequest('complete',{model,contextSize,messages,engine:engineOptions(),draft:draftStore.path(model)||'',...(schema?{schema}:{}),...(sampling&&!schema?{sampling}:{}),variables:promptVariables(),maxTokens,temperature,stream:!!stream,thinking:!!thinking,timeoutMs},e=>{if(e.type==='agent-chunk')onChunk?.(e.data);else if(e.type==='agent-reasoning')onReasoning?.(e.data);else if(e.type==='progress')send('agent-event',{type:'progress',label:e.data.label,value:e.data.value});});
   const abort=()=>{coreRequest('cancel').catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
   return result.finally(()=>signal?.removeEventListener('abort',abort));
  },
  cancel(){return coreRequest('cancel').catch(()=>{});}
 };
 agent=createAgent({engine,web:webTools,settings:toolSettings,emit:event=>send('agent-event',event),log:message=>fs.appendFileSync(path.join(data,'desktop-engine.log'),'[agent] '+message+'\n')});
 downloader=createDownloader({dataDir:data,emit:state=>{send('download-event',state);if(state.phase==='completed')request('models').then(models=>send('download-event',{...state,models})).catch(()=>{});}});
 const validChat=chat=>chat&&typeof chat==='object'&&/^[a-fA-F0-9]{32}$/.test(chat.Id||'')&&Array.isArray(chat.Messages)&&chat.Messages.length<=2000&&typeof chat.Model==='string'&&chat.Model.length<=200;
 ipcMain.handle('tools',async(e,action,args={})=>{
  sender(e);if(JSON.stringify(args).length>20000)throw Error('Invalid request.');
  if(action==='get')return {...toolSettings.public(),hostReady,providers:webTools.providers};
  if(action==='update'){const result=toolSettings.update(args);webTools.clear();browser?.applySettings();return {...result,hostReady,providers:webTools.providers};}
  if(action==='set-key')return {...toolSettings.setKey(String(args.provider),String(args.key||'')),hostReady,providers:webTools.providers};
  if(action==='clear-key')return {...toolSettings.clearKey(String(args.provider)),hostReady,providers:webTools.providers};
  if(action==='clear-browser'){webTools.clear();await getBrowser().clearData();return true;}
  throw Error('Invalid tools action.');
 });
 ipcMain.handle('agent',async(e,action,args={})=>{
  sender(e);if(JSON.stringify(args).length>4000000)throw Error('Invalid request.');
  if(action==='route'){const config=toolSettings.get(),prompt=String(args.prompt||'').slice(0,90000);if(/^cloud:/.test(String(args.model||'')))return {route:'chat',reason:'cloud'};if(!hostReady)return {route:'chat',reason:'unavailable'};if(args.mode==='research')return config.search.enabled?{route:'agent'}:{route:'chat',reason:'web-off'};return {route:config.search.enabled&&config.agent.auto&&agent.needsTools(prompt)?'agent':'chat'};}
  if(action==='run'){
   const {runId,chat,prompt,mode,contextSize}=args;
   if(typeof runId!=='string'||!/^[a-f0-9-]{36}$/.test(runId)||!validChat(chat)||typeof prompt!=='string'||!prompt.trim()||prompt.length>90000||!['auto','research','project','tools'].includes(mode)||!contextSizes.includes(contextSize)||!hostReady&&contextSize>16384)throw Error('Invalid research request.');
   if(skillFlight)throw Error('A response is already running.');
   if(/^cloud:/.test(chat.Model))throw Error(prefs().language==='tr'?'Araştırma, proje ve araçlar yerel modellerle çalışır. Bu sohbet için yerel bir model seç.':'Research, project folders and tools run on local models. Choose a local model for this conversation.');
   let systemPrompt=String(chat.SystemPrompt||'').slice(0,12000);try{systemPrompt=skillStore.compile(systemPrompt,Array.isArray(chat.SkillIds)?chat.SkillIds:[]).prompt;}catch{}
   const p=prefs(),context=await contextFor(chat.Model,contextSize);loaded={model:chat.Model,context:context.value};
   if(mode==='project'){const binding=projectStore.get(chat.Id);if(!binding)throw Error('No project folder is attached to this conversation.');if(!fs.existsSync(binding.root))throw Error('The project folder was not found: '+binding.root);return agent.runProject({runId,chat,prompt,model:chat.Model,contextSize:context.value,language:p.language==='tr'?'tr':'en',project:createProjectTools(binding),research:args.research===true,systemPrompt,...runOptions(chat)});}
   if(mode==='tools'){const tools=connections.activeTools();return agent.runTools({runId,chat,prompt,model:chat.Model,contextSize:context.value,language:p.language==='tr'?'tr':'en',tools,
    callTool:(serverId,name,toolArgs,signal)=>mcpClient.callTool(connections.server(serverId),name,toolArgs,{signal}),
    allowAlways:(serverId,name)=>{try{connections.updateServer(serverId,{tool:{name,ask:false}});}catch{}},systemPrompt,...runOptions(chat)});}
   return agent.run({runId,chat,prompt,model:chat.Model,contextSize:context.value,language:p.language==='tr'?'tr':'en',mode,systemPrompt,...runOptions(chat)});
  }
  if(action==='approve')return agent.approve(String(args.runId||''),String(args.callId||''),String(args.decision||'deny'));
  if(action==='cancel')return agent.cancel(String(args.runId||''));
  if(action==='record'){const record=activityStore.record(args.chatId,args.index,args.record);if(typeof args.reasoning?.text==='string'&&args.reasoning.text)reasoningStore.record(args.chatId,args.index,args.reasoning);return record;}
  throw Error('Invalid agent action.');
 });
 ipcMain.handle('browser',async(e,action,args={})=>{
  sender(e);if(JSON.stringify(args).length>4000)throw Error('Invalid request.');
  if(['back','forward','reload','stop','close','state'].includes(action))return browser?browser[action]():{open:false};
  if(action==='open')return getBrowser().open(args.url);
  if(action==='home')return getBrowser().home();
  if(action==='find')return browser?browser.find(String(args.text||'').slice(0,200),{forward:args.forward!==false,next:args.next===true}):false;
  if(action==='find-stop')return browser?browser.stopFind():true;
  if(action==='zoom')return browser?browser.zoom(args.step):{open:false};
  if(action==='bounds')return browser||args.rect?getBrowser().bounds(args.rect||null):true;
  if(action==='external')return getBrowser().external(args.url);
  // Chat commands: click a named link/button (never typing), scroll, and wait for a page to finish loading.
  if(action==='click'){const labels=Array.isArray(args.labels)?args.labels.filter(l=>typeof l==='string'&&l.trim()&&l.length<=80).slice(0,4):[];if(!labels.length)throw Error('Invalid request.');return browser?browser.click(labels,{force:args.force===true}):{status:'closed'};}
  if(action==='scroll')return browser?browser.scroll(String(args.direction||'')):{status:'closed'};
  if(action==='settle')return browser?browser.settle(Math.min(20000,Math.max(0,Number(args.ms)||15000))):{open:false};
  throw Error('Invalid browser action.');
 });
 // Regenerate: begin keeps the current reply as a version and clears its reasoning/activity; commit adds the new reply;
 // abandon puts the active version back when nothing was produced; select switches the last reply to another version.
 function restoreSidecars(id,index,version){reasoningStore.remove(id,index);activityStore.remove(id,index);if(version.reasoning)reasoningStore.record(id,index,version.reasoning);if(version.activity)activityStore.record(id,index,version.activity);}
 // Project folders: chosen by the user in a folder dialog, read-only; sensitive files only after the user picks that file.
 ipcMain.handle('projects',async(e,action,args={})=>{
  sender(e);if(JSON.stringify(args).length>20000||typeof args.chatId!=='string'||!/^[a-f0-9]{32}$/i.test(args.chatId))throw Error('Invalid request.');
  const tr=args.language==='tr',binding=projectStore.get(args.chatId);
  const status=async b=>{if(!b)return null;if(!fs.existsSync(b.root))return {...b,exists:false};try{const info=await createProjectTools(b).info();return {...b,exists:true,files:info.files,truncated:info.truncated};}catch(error){return {...b,exists:false,error:error.message};}};
  if(action==='status')return status(binding);
  if(action==='choose'){if(skillFlight||agent.active())throw Error(tr?'Yanıt bitene kadar bekle.':'Wait for the current response to finish.');const r=await dialog.showOpenDialog(win,{title:tr?'Proje klasörü seç (salt okunur)':'Choose a project folder (read-only)',properties:['openDirectory']});if(r.canceled||!r.filePaths[0])return status(binding);const root=fs.realpathSync(r.filePaths[0]);if(path.parse(root).root===root)throw Error(tr?'Bir sürücünün tamamı bağlanamaz; bir proje klasörü seç.':'A whole drive cannot be attached; choose a project folder.');return status(projectStore.bind(args.chatId,root));}
  if(!binding)throw Error(tr?'Bu sohbete bağlı proje yok.':'No project folder is attached.');
  if(action==='detach'){projectStore.unbind(args.chatId);return null;}
  if(action==='exclude'){if(!Array.isArray(args.exclude))throw Error('Invalid request.');return status(projectStore.update(args.chatId,{exclude:args.exclude}));}
  if(action==='allow'){const r=await dialog.showOpenDialog(win,{title:tr?'İzin verilecek hassas dosyayı seç':'Choose the sensitive file to allow',defaultPath:binding.root,properties:['openFile','dontAddToRecent']});if(r.canceled||!r.filePaths[0])return status(binding);const relative=path.relative(binding.root,r.filePaths[0]);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error(tr?'Dosya proje klasörünün içinde olmalı.':'The file must be inside the project folder.');const checked=await createProjectTools(binding).sensitiveCheck(relative);return status(projectStore.update(args.chatId,{allow:[...(binding.allow||[]),checked]}));}
  if(action==='disallow'){return status(projectStore.update(args.chatId,{allow:(binding.allow||[]).filter(p=>p!==args.path)}));}
  if(action==='excerpt'){const r=await createProjectTools(binding).read(String(args.path||''),Number(args.start)||1,Number(args.end)||undefined);return {path:r.path,start:r.start,end:r.end,total:r.totalLines,text:r.text,truncated:r.truncated};}
  throw Error('Invalid project action.');
 });
 // Models already on this computer (other apps' folders or one the user picks). The renderer only sends IDs from the last scan.
 const importHome=test&&process.env.LUMEN_IMPORT_HOME?process.env.LUMEN_IMPORT_HOME:null;
 const imports=require('./imports.cjs').createImports({dataDir:data,home:importHome||require('os').homedir(),localAppData:importHome?path.join(importHome,'AppData','Local'):process.env.LOCALAPPDATA,appData:importHome?path.join(importHome,'AppData','Roaming'):process.env.APPDATA,env:importHome?{}:process.env,
  register:model=>request('register',{model}),models:()=>request('models'),log:message=>{try{fs.appendFileSync(path.join(data,'desktop-engine.log'),message+'\n');}catch{}}});
 let importScan=null,importFolders=[],importRun=null;
 ipcMain.handle('imports',async(e,action,args={})=>{sender(e);
  if(action==='scan'){importScan=await imports.scan({folders:importFolders});return importScan;}
  if(action==='folder'){const tr=prefs().language==='tr';const r=await dialog.showOpenDialog(win,{title:tr?'Model klasörü seç':'Choose a model folder',properties:['openDirectory']});if(r.canceled||!r.filePaths[0])return null;if(!importFolders.includes(r.filePaths[0]))importFolders.push(r.filePaths[0]);importScan=await imports.scan({folders:importFolders});return importScan;}
  if(action==='import'){
   if(importRun)throw Error('An import is already running.');if(!importScan)throw Error('Scan first.');
   const ids=Array.isArray(args.ids)?args.ids.filter(id=>typeof id==='string').slice(0,50):[];const items=importScan.models.filter(m=>ids.includes(m.id)&&m.status!=='installed');if(!items.length)throw Error('Choose a model to add.');
   const controller=new AbortController();importRun=controller;
   try{const results=await imports.importModels(items,{allowCopy:args.allowCopy===true,signal:controller.signal,onProgress:event=>send('import-event',event)});const models=await request('models');return {results,models};}
   finally{importRun=null;}
  }
  if(action==='cancel'){importRun?.abort();return true;}
  throw Error('Invalid request');
 });
 // Documents of a conversation: added through a file dialog here (the renderer never sends paths), read on this computer.
 ipcMain.handle('documents',async(e,action,args={})=>{sender(e);
  const chatId=String(args.chatId||'');if(!/^[a-fA-F0-9]{32}$/.test(chatId))throw Error('Invalid conversation ID.');
  if(action==='list')return documents.list(chatId);
  if(action==='remove')return documents.detach(chatId,String(args.id||''));
  if(action==='add'){
   const tr=prefs().language==='tr';
   // UI tests (--ui-check only) pass files directly; the product always asks through the dialog.
   const r=test&&Array.isArray(args.testFiles)?{canceled:false,filePaths:args.testFiles.map(String)}:await dialog.showOpenDialog(win,{title:tr?'Belge ekle':'Add documents',properties:['openFile','multiSelections'],filters:[{name:tr?'Belgeler':'Documents',extensions:documents.KINDS}]});
   if(r.canceled||!r.filePaths.length)return {documents:documents.list(chatId),added:[],failed:[]};
   if(r.filePaths.length>10)throw Error(tr?'En fazla 10 belge ekleyebilirsin.':'Add up to 10 documents.');
   const added=[],failed=[];
   for(const file of r.filePaths){send('document-event',{chatId,name:path.basename(file),phase:'reading'});try{added.push(await documents.add(file));}catch(error){failed.push({name:path.basename(file),reason:error.message});}}
   let list=documents.list(chatId);try{list=documents.attach(chatId,added.map(d=>d.id));}catch(error){failed.push({name:'',reason:error.message});}
   send('document-event',{chatId,phase:'done'});
   return {documents:list,added,failed};
  }
  throw Error('Invalid request');
 });
 // Run settings of one conversation (Run settings panel). "default" makes this chat's values the defaults for new chats.
 ipcMain.handle('run',async(e,action,args={})=>{sender(e);
  const id=String(args.id||''),p=prefs(),view=()=>{const q=prefs(),cap=args.model?modelInfo.thinking(modelNamed(String(args.model))):{state:'unknown'};return {overrides:/^[a-fA-F0-9]{32}$/.test(id)?runSettings.overrides(id):{},defaults:runSettings.defaults(q),effective:runSettings.effective(id,q),thinking:cap,variables:promptVariables(q)};};
  if(action==='get')return view();
  if(action==='set'){runSettings.set(id,args.values);return view();}
  if(action==='reset'){runSettings.reset(id);return view();}
  if(action==='default'){
   const run=runSettings.effective(id,p),preset=Object.entries({precise:0.2,balanced:0.7,creative:1.0}).find(([,v])=>v===run.temperature)?.[0];
   const sampling=Object.fromEntries(Object.entries(run).filter(([k])=>!['thinking','responseTokens'].includes(k)&&!(k==='temperature'&&preset)));
   fs.writeFileSync(prefPath,JSON.stringify({...p,thinking:run.thinking,responseTokens:run.responseTokens,creativity:preset||p.creativity||'balanced',sampling:cleanDefaults(sampling)}));
   runSettings.reset(id);return {...view(),prefs:prefs()};
  }
  throw Error('Invalid request');
 });
 // Assistants: saved instructions, model, run settings and skills. "start" copies one into a conversation.
 ipcMain.handle('assistants',async(e,action,args={})=>{sender(e);if(JSON.stringify(args).length>40000)throw Error('Invalid request.');
  if(action==='list')return assistants.list();
  if(action==='save'){assistants.upsert(args.assistant);return assistants.list();}
  if(action==='remove'){const a=assistants.get(String(args.id||''));if(!a)throw Error('Assistant not found.');const tr=prefs().language==='tr';const answer=await dialog.showMessageBox(win,{type:'warning',message:tr?'Asistan silinsin mi?':'Delete this assistant?',detail:`“${a.name}”\n\n`+(tr?'Bu asistanla başlatılmış sohbetler değişmez.':'Conversations started with it stay as they are.'),buttons:tr?['Vazgeç','Sil']:['Cancel','Delete'],defaultId:0,cancelId:0,noLink:true});if(answer.response!==1)return assistants.list();assistants.remove(a.id);return assistants.list();}
  if(action==='start'){
   const chatId=String(args.chatId||''),a=args.id?assistants.get(String(args.id)):null;if(!/^[a-fA-F0-9]{32}$/.test(chatId))throw Error('Invalid conversation ID.');if(args.id&&!a)throw Error('Assistant not found.');
   if(skillFlight)throw Error('Wait for the current response to finish.');
   if(!a){runSettings.reset(chatId);assistants.link(chatId,null);return {assistant:null};}
   runSettings.set(chatId,a.run);const known=new Set(skillStore.list().map(s=>s.id));const skillIds=a.skillIds.filter(id=>known.has(id));
   try{skillStore.select(chatId,skillIds,a.instructions);}catch{}assistants.link(chatId,a.id);
   const models=withCloud(modelInfo.decorate(knownModels));const model=a.model&&models.some(m=>m.Name===a.model&&m.Installed)?a.model:'';
   return {assistant:{id:a.id,name:a.name},instructions:a.instructions,model,modelMissing:!!a.model&&!model,skillIds};
  }
  throw Error('Invalid request');
 });
 // Connections: cloud providers, MCP servers and the local API (Settings → Connections / Cloud models).
 const connectionsView=()=>({...connections.public(),api:{...connections.public().api,...(apiServer?.status()||{})}});
 ipcMain.handle('connections',async(e,action,args={})=>{sender(e);if(JSON.stringify(args).length>40000)throw Error('Invalid request.');
  if(action==='get')return connectionsView();
  if(action==='cloud'){connections.setCloud(args);return connectionsView();}
  if(action==='provider'){connections.setCloudProvider(String(args.provider||''),args);return connectionsView();}
  if(action==='provider-models'){const list=await cloud.listModels(String(args.provider||''));return {models:list};}
  if(action==='provider-test'){const target=String(args.provider||''),model=String(args.model||'');const r=await cloud.chat({provider:target,model,messages:[{role:'user',content:'Reply with the single word: ready'}],maxTokens:16,signal:AbortSignal.timeout(60000)});return {reply:String(r.content||'').slice(0,200)};}
  if(action==='mcp-add'){const id=connections.addServer({name:args.name,url:args.url,token:args.token});try{const r=await mcpClient.listTools(connections.server(id));connections.updateServer(id,{tools:r.tools,serverName:r.serverName,checked:new Date().toISOString(),error:''});}catch(error){connections.updateServer(id,{error:error.message,checked:new Date().toISOString()});}return connectionsView();}
  if(action==='mcp-refresh'){const id=String(args.id||'');try{const r=await mcpClient.listTools(connections.server(id));connections.updateServer(id,{tools:r.tools,serverName:r.serverName,checked:new Date().toISOString(),error:''});}catch(error){connections.updateServer(id,{error:error.message,checked:new Date().toISOString()});}return connectionsView();}
  if(action==='mcp-update'){const id=String(args.id||'');connections.updateServer(id,{enabled:args.enabled,name:args.name,token:args.token,tool:args.tool});if(typeof args.token==='string')mcpClient.forget(id);return connectionsView();}
  if(action==='mcp-remove'){const id=String(args.id||'');mcpClient.forget(id);connections.removeServer(id);return connectionsView();}
  if(action==='api'){connections.setApi(args);await apiServer.start();return connectionsView();}
  throw Error('Invalid request');
 });
 // The local API server reuses the engine: one request at a time, same models, same context rules.
 apiServer=require('./apiserver.cjs').createApiServer({getConfig:()=>connections.api(),models:()=>request('models'),contextFor:async name=>(await contextFor(name,prefs().contextSize)).value,
  complete:args=>engine.complete(args),cancel:()=>engine.cancel(),log:message=>{try{fs.appendFileSync(path.join(data,'desktop-engine.log'),message+'\n');}catch{}}});
 apiServer.start().catch(()=>{});
 // Artifact preview: HTML/SVG from a reply in a separate, offline, sandboxed window (artifacts.cjs).
 ipcMain.handle('artifact',async(e,action,args={})=>{sender(e);
  if(action==='open'){if(typeof args.code!=='string'||args.code.length>2000000)throw Error('Nothing to preview.');return artifacts.open({code:args.code,kind:String(args.kind||''),title:String(args.title||''),dark:prefs().colorMode!=='light'});}
  if(action==='close'){artifacts.close();return true;}
  throw Error('Invalid request');
 });
 ipcMain.handle('variants',async(e,action,args={})=>{
  sender(e);if(JSON.stringify(args).length>4000000)throw Error('Invalid request.');
  const chat=args.chat,index=args.index;if(!validChat(chat)||!Number.isInteger(index)||index<1||index>2000)throw Error('Invalid reply.');
  if(skillFlight&&action!=='abandon'&&action!=='commit')throw Error('Wait for the current response to finish.');
  if(action==='begin'){if(index!==chat.Messages.length-1||chat.Messages[index]?.Role!=='assistant'||chat.Messages[index-1]?.Role!=='user')throw Error('Only the last reply can be regenerated here.');variantStore.begin(chat.Id,index,decorateChat(chat).Messages[index]);reasoningStore.remove(chat.Id,index);activityStore.remove(chat.Id,index);return true;}
  if(action==='commit'){const decorated=decorateChat(chat);if(decorated.Messages[index]?.Role!=='assistant')throw Error('Invalid reply.');variantStore.commit(chat.Id,index,decorated.Messages[index]);return decorateChat(chat);}
  if(action==='abandon'){const version=variantStore.abandon(chat.Id,index);if(!version)return decorateChat(chat);const restored={...chat,Messages:[...chat.Messages.slice(0,index),{Role:'assistant',Content:version.content,Interrupted:version.interrupted}]};const saved=await request('save',{chat:restored});restoreSidecars(chat.Id,index,version);return decorateChat(withManualTitle(saved));}
  if(action==='select'){if(index!==chat.Messages.length-1||chat.Messages[index]?.Role!=='assistant')throw Error('Only the last reply can switch versions.');const version=variantStore.select(chat.Id,index,args.version);const next={...chat,Messages:[...chat.Messages.slice(0,index),{Role:'assistant',Content:version.content,Interrupted:version.interrupted}]};const saved=await request('save',{chat:next});restoreSidecars(chat.Id,index,version);return decorateChat(withManualTitle(saved));}
  throw Error('Invalid variants action.');
 });
 ipcMain.handle('models-info',async(e,action,args={})=>{
  sender(e);if(JSON.stringify(args).length>20000)throw Error('Invalid request.');
  if(action==='context'){if(typeof args.model!=='string'||args.model.length>400)throw Error('Invalid request.');const p=prefs();const r=await contextFor(args.model,p.contextSize);const choice=r.key?autoChoices.get(r.key):null;const m=modelNamed(args.model);return {mode:r.mode,value:r.value,reason:r.reason||null,trained:choice?.trained||m&&modelInfo.meta(m)?.shape?.trainedContext||null,estimate:choice?.estimate||null};}
  if(action==='benchmarks')return benchmarks();
  if(action==='fit'){
   // Memory estimates for model files: installed ones use their GGUF metadata (context included), others only the file size.
   if(!Array.isArray(args.items)||args.items.length>300)throw Error('Invalid request.');const p=prefs(),options=engineOptions(p),hardware=await modelInfo.hardware({loadedBytes:await loadedUsage()});
   const context=contextSizes.includes(args.context)?args.context:(p.contextMode==='auto'?8192:p.contextSize);const out={};
   for(const item of args.items){if(!item||typeof item.key!=='string'||!Number.isSafeInteger(item.bytes))continue;const m=item.name?modelNamed(item.name):null;out[item.key]=await modelInfo.estimate(m&&m.Installed?m:{Bytes:item.bytes,Installed:false},{context,kv:options.kv,gpu:options.gpu,hardware});}
   return {context,hardware:{vramTotal:hardware.vramTotal,vramFree:hardware.vramFree,ramTotal:hardware.ramTotal,ramFree:hardware.ramFree,source:hardware.source},estimates:out};
  }
  throw Error('Invalid models action.');
 });
 ipcMain.handle('drafts',async(e,action,args={})=>{
  sender(e);if(JSON.stringify(args).length>2000||typeof args.model!=='string'||args.model.length>400)throw Error('Invalid request.');
  if(action==='status')return {...draftStore.status(args.model),host:hostReady};
  const model=(await request('models')).find(m=>m.Name===args.model);if(!model)throw Error('Unknown model.');
  if(action==='check'){const entry=await draftStore.find(model);return {...draftStore.status(args.model),checked:!!entry,file:entry?.file||null,bytes:entry?.bytes||0,host:hostReady};}
  if(action==='enable'){
   if(!hostReady)throw Error('Draft models need the engine host (backend/lumen-host.exe).');
   const entry=await draftStore.find(model);if(!entry)throw Error('No draft model was found for this model.');
   draftStore.remember(model.Name,entry);if(draftStore.path(model.Name))return draftStore.status(model.Name);downloader.start(draftStore.job(model.Name,entry)).catch(()=>{});return draftStore.status(model.Name);
  }
  if(action==='remove'){if(skillFlight)throw Error('Wait for the current response to finish.');
   // The running engine keeps the draft file open; unload first so the file can be deleted.
   await request('unload').catch(()=>{});for(let attempt=0;;attempt++){try{draftStore.remove(model.Name);break;}catch{if(attempt>=6)throw Error('The draft file is still in use. Try again in a moment.');await new Promise(r=>setTimeout(r,400));}}return draftStore.status(model.Name);}
  throw Error('Invalid draft action.');
 });
 ipcMain.handle('vision',async(e,action,args={})=>{
  sender(e);if(JSON.stringify(args).length>2000||typeof args.model!=='string'||args.model.length>400)throw Error('Invalid request.');
  if(action==='status')return {...visionStore.status(args.model),host:hostReady};
  const model=(await request('models')).find(m=>m.Name===args.model);if(!model)throw Error('Unknown model.');
  if(action==='check'){const entry=await visionStore.find(model);return {...visionStore.status(args.model),checked:!!entry,file:entry?.file||null,bytes:entry?.bytes||0,host:hostReady};}
  if(action==='enable'){
   if(!hostReady)throw Error('Seeing photos needs the engine host (backend/lumen-host.exe).');
   const entry=await visionStore.find(model);if(!entry)throw Error('No vision projector was found for this model.');
   visionStore.remember(model.Name,entry);if(visionStore.projector(model.Name))return visionStore.status(model.Name);downloader.start(visionStore.job(model.Name,entry)).catch(()=>{});return visionStore.status(model.Name);
  }
  if(action==='remove'){if(skillFlight)throw Error('Wait for the current response to finish.');
   // The running engine keeps the projector file open; unload first so the file can be deleted.
   await request('unload').catch(()=>{});for(let attempt=0;;attempt++){try{visionStore.remove(model.Name);break;}catch{if(attempt>=6)throw Error('The vision file is still in use. Try again in a moment.');await new Promise(r=>setTimeout(r,400));}}return visionStore.status(model.Name);}
  throw Error('Invalid vision action.');
 });
 // Version check and updates (updates.cjs). Test runs may point at a local release server and test key; the product cannot.
 const updater=require('./updates.cjs').createUpdater({dataDir:data,appDir:path.dirname(process.execPath),version:app.getVersion(),build:require('./package.json').build,emit:s=>emitWindow('update-event',s),log:message=>{try{fs.appendFileSync(path.join(data,'desktop-engine.log'),message+'\n');}catch{}},test,apiBase:process.env.LUMEN_UPDATE_API,publicKey:test&&process.env.LUMEN_UPDATE_KEY?fs.readFileSync(process.env.LUMEN_UPDATE_KEY,'utf8'):undefined});
 const engineUpdater=require('./engine.cjs').createEngineUpdater({dataDir:data,emit:s=>emitWindow('engine-update-event',s),log:message=>{try{fs.appendFileSync(path.join(data,'desktop-engine.log'),message+'\n');}catch{}},unload:()=>request('unload')});
 // Startup checks run while the opening animation plays: Lumen's own update and a newer llama.cpp engine, each only when its
 // automatic check is on. The renderer waits for them at most a few seconds; results that arrive later still show.
 const startupChecks=(!test||process.env.LUMEN_STARTUP_CHECKS==='1')?Promise.allSettled([updater.status().auto?updater.check():null,engineUpdater.status().auto?engineUpdater.check():null]):Promise.resolve([]);
 ipcMain.handle('engine-update',async(e,action,args={})=>{
  sender(e);if(JSON.stringify(args).length>200)throw Error('Invalid request.');
  if(action==='status')return engineUpdater.status();
  if(action==='check')return engineUpdater.check();
  if(action==='install')return engineUpdater.install();
  if(action==='cancel')return engineUpdater.cancel();
  if(action==='rollback')return engineUpdater.rollback();
  if(action==='snooze')return engineUpdater.snooze();
  if(action==='ack')return engineUpdater.acknowledgeFailure();
  if(action==='auto')return engineUpdater.setAuto(args.on===true);
  throw Error('Invalid engine action.');
 });
 ipcMain.handle('updates',async(e,action,args={})=>{
  sender(e);if(JSON.stringify(args).length>200)throw Error('Invalid request.');
  if(action==='startup'){const ms=Math.min(8000,Math.max(0,Number(args.wait)||4000));await Promise.race([startupChecks,new Promise(r=>setTimeout(r,ms))]);return {app:updater.status(),engine:engineUpdater.status()};}
  if(action==='status')return updater.status();
  if(action==='check')return updater.check({manual:true});
  if(action==='download')return updater.download();
  if(action==='cancel')return updater.cancel();
  if(action==='auto')return updater.setAuto(args.on===true);
  if(action==='install'){const relaunchArgs=test?process.argv.slice(1).filter(a=>/^--(ui-check|no-sandbox|in-process-gpu|disable-gpu|test-data=|check-output=|user-data-dir=)/.test(a)):[];return updater.install({quit:()=>app.quit(),relaunchArgs,language:prefs().language});}
  throw Error('Invalid update action.');
 });
 ipcMain.handle('downloads',async(e,action,args={})=>{
  sender(e);if(JSON.stringify(args).length>2000)throw Error('Invalid request.');
  if(action==='list')return downloader.list();
  if(action==='start'){const models=await request('models');const model=models.find(m=>m.Name===args.name);if(!model)throw Error('Unknown model.');return downloader.start(model);}
  const id=String(args.id||'').toLowerCase();
  if(action==='pause')return downloader.pause(id);
  if(action==='resume')return downloader.resume(id);
  if(action==='cancel')return downloader.cancel(id);
  throw Error('Invalid download action.');
 });

 await win.loadURL('lumen://app/');if(!test)win.show();else win.showInactive();
 updater.cleanup().catch(()=>{});
 if(test){try{await require('./ui-check.cjs').run(win,app,request,prefs,data);}catch(e){fs.writeFileSync(path.join(process.env.LUMEN_CHECK_OUTPUT||data,'failure.txt'),e.stack);app.exitCode=1;}finally{app.quit();}}
}).catch(e=>{fs.mkdirSync(data,{recursive:true});fs.writeFileSync(path.join(data,'desktop-startup-error.log'),e.stack);if(core)core.stdin.end();app.exit(1);});}
let shuttingDown=false;
app.on('window-all-closed',()=>app.quit());app.on('before-quit',event=>{if(!core||shuttingDown)return;event.preventDefault();shuttingDown=true;if(win&&!win.isDestroyed())win.hide();agent?.cancelAll();cloudFlight?.abort();apiServer?.stop().catch(()=>{});try{artifacts?.close();}catch{}downloader?.cancelAll();try{browser?.close();}catch{}const timeout=setTimeout(()=>{core?.kill();app.exit();},8000);Promise.resolve().then(()=>request('cancel')).then(()=>request('unload')).catch(()=>{}).then(()=>{if(toolSettings?.get().browser.clearOnExit){const web=session.fromPartition('persist:lumen-web');return Promise.all([web.clearStorageData(),web.clearCache()]).catch(()=>{});}}).finally(()=>{core.stdin.end();clearTimeout(timeout);app.exit();});});

