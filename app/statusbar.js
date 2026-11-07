'use strict';
// Status bar (window bottom) and the single status line under the composer. One statusState object is fed by engine events
// (the "engine-event" stream), context/model changes and the existing tool settings; both placements are the same element,
// so they can never be visible at the same time. There is no polling: the surface is repainted only when one of those
// sources changes. Clicking model opens the model menu, context opens Settings -> Chat behavior, web toggles the existing
// web-search setting (the same functions the composer uses).
Object.assign(translations,{
 statusBarLabel:['Status bar','Durum çubuğu'],
 statusBarHint:['Show model, context, and engine status.','Model, bağlam ve motor durumunu göster.'],
 statusModel:['Model','Model'],
 statusContext:['Context','Bağlam'],
 statusVram:['VRAM','VRAM'],
 statusEngine:['Engine','Motor'],
 statusWebOn:['Web on','Web açık'],
 statusWebOff:['Web off','Web kapalı'],
 statusCloud:['Cloud · {provider}','Bulut · {provider}'],
 statusTokens:['{n} tokens','{n} token'],
 statusLoading:['Loading','Yükleniyor'],
 statusReady:['Ready','Hazır'],
 statusAnswering:['Answering','Yanıtlıyor'],
 composerPlaceholder:['Ask anything. Keep it local.','Ne istersen sor; her şey bu cihazda kalsın.']
});

// The only source the status surface reads. syncStatus() fills it from the app; paintStatus() never reads state.* itself.
const statusState={ready:false,placement:'composer',model:'',cloud:null,context:null,vram:null,engine:'',web:false,phase:'ready'};

const statusRoot=el('div','app-status');
statusRoot.id='app-status';
statusRoot.dataset.placement='composer';
statusRoot.setAttribute('role','contentinfo');
statusRoot.hidden=true;

function statusItem(id,cls,tag='span'){
 const node=el(tag,'status-item '+cls);node.id=id;if(tag==='button')node.type='button';
 const label=el('span','status-label'),value=el('span','status-value');value.id=id+'-value';
 node.append(label,value);return {node,label,value};
}
const modelItem=statusItem('status-model','status-model','button');
const contextItem=statusItem('status-context','status-context','button');
const vramItem=statusItem('status-vram','status-vram');
const engineItem=statusItem('status-engine','status-engine');
const phaseDot=el('span','status-dot');phaseDot.dataset.phase='ready';const phaseText=el('span','status-phase');modelItem.node.append(phaseDot,phaseText);
contextItem.value.classList.add('status-mono');vramItem.value.classList.add('status-mono');

const webItem=el('button','status-item status-web');webItem.id='status-web';webItem.type='button';
const webValue=el('span','status-value');webValue.id='status-web-value';webItem.append(webValue);

statusRoot.append(modelItem.node,contextItem.node,vramItem.node,engineItem.node,webItem);
const composerFoot=document.querySelector('.composer-foot');
const contextWrap=composerFoot?composerFoot.querySelector('.context-wrap'):null;
// The detailed composer context popover is replaced by the status context item (which opens Settings -> Context). It stays in
// the DOM because renderContext() still writes its fields.
if(contextWrap)contextWrap.hidden=true;
// A row of its own under the composer foot: the hint/assistant/run-settings line keeps its controls, and the status stays
// readable at narrow widths. In window mode placeStatus() moves this same element to <body>.
if(composerFoot)composerFoot.after(statusRoot);else document.body.append(statusRoot);

function engineName(){
 const id=String(state.activeBackend||state.backend?.Selected||'').toLowerCase();
 if(id==='cuda13')return 'CUDA 13.4';
 if(id==='cuda12')return 'CUDA 12.4';
 if(id==='vulkan')return 'Vulkan';
 if(id==='cpu')return 'CPU';
 return id?id.toUpperCase():'';
}
function providerOf(){
 const cloud=statusState.cloud;
 if(cloud)return cloud.label||cloud.provider||'';
 const match=/^cloud:([^/]+)\//.exec(statusState.model);
 return match?match[1]:'';
}
function isCloud(){return !!(statusState.cloud||/^cloud:/.test(statusState.model));}
function localContext(){
 const ctx=statusState.context;
 const capacity=ctx?.Capacity||(typeof effectiveContext==='function'?effectiveContext():state.prefs?.contextSize)||4096;
 const model=typeof modelByName==='function'?modelByName(statusState.model):null;
 const auto=typeof autoContextByModel!=='undefined'?autoContextByModel.get(statusState.model):null;
 const trained=ctx?.ModelCapacity||model?.Meta?.trainedContext||auto?.trained||null;
 return trained?`${fmt(capacity)} / ${fmt(trained)}`:fmt(capacity);
}
function phaseKey(){return statusState.phase==='answering'?'statusAnswering':statusState.phase==='loading'?'statusLoading':'statusReady';}

// Pull the current values into statusState. A model switch can happen through the picker, the model menu or the history list;
// renderPickers/renderContext cover all three (and the engine context event), so no timer is needed.
function syncStatus(){
 statusState.ready=!!state.ready;
 statusState.model=(typeof currentModel==='function'?currentModel():document.getElementById('model-picker')?.value)||'';
 const model=typeof modelByName==='function'?modelByName(statusState.model):null;
 statusState.cloud=model?.Cloud||null;
 statusState.context=state.contexts?.get?.(state.chat?.Id)||null;
 statusState.vram=Number.isFinite(state.hardware?.Vram)?state.hardware.Vram:null;
 statusState.engine=engineName();
 statusState.web=!!(typeof toolsConfig!=='undefined'&&toolsConfig?.search?.enabled);
 const appearance=globalThis.LumenAppearance?LumenAppearance.sanitizeAppearance(state.prefs?.appearance):null;
 statusState.placement=appearance?.statusBar===true?'window':'composer';
 statusState.phase=!state.ready?'loading':!state.busy?'ready':state.operation==='send'?'answering':state.operation==='backend'?'loading':'ready';
}

function paintStatus(){
 if(!statusRoot)return;
 statusRoot.hidden=!statusState.ready;
 if(statusRoot.hidden)return;
 statusRoot.setAttribute('aria-label',t('statusBarLabel'));
 const cloud=isCloud(),provider=providerOf(),phase=t(phaseKey());
 modelItem.label.textContent=t('statusModel');
 modelItem.value.textContent=cloud?(provider?tf('statusCloud',{provider}):(typeof displayName==='function'?displayName(statusState.model):statusState.model)):((typeof displayName==='function'?displayName(statusState.model):statusState.model)||t('chooseModel'));
 phaseDot.hidden=cloud;phaseText.hidden=cloud;
 phaseDot.dataset.phase=statusState.phase;
 phaseDot.title=phase;
 phaseDot.setAttribute('aria-label',phase);
 phaseText.textContent=phase;
 const modelTitle=cloud?modelItem.value.textContent:(typeof modelDetail==='function'?modelDetail(statusState.model):modelItem.value.textContent);
 modelItem.node.title=(modelTitle?modelTitle+' · ':'')+phase;
 modelItem.node.setAttribute('aria-label',`${t('statusModel')}: ${modelItem.value.textContent} · ${phase}`);
 modelItem.node.disabled=!!state.busy;
 contextItem.label.textContent=t('statusContext');
 if(cloud){
  const ctx=statusState.context,counted=!!(ctx?.Cloud&&ctx.Counted);
  contextItem.value.textContent=counted?tf('statusTokens',{n:fmt(ctx.Prompt+ctx.Generated)}):'—';
  contextItem.node.title=ctx?.Cloud&&!ctx.Counted?tf('cloudContextNone',{provider:ctx.Cloud}):t('statusContext');
 }else{
  contextItem.value.textContent=localContext();
  contextItem.node.title=t('adjustContext');
 }
 contextItem.node.setAttribute('aria-label',`${t('statusContext')}: ${contextItem.value.textContent}`);
 const hideVram=cloud||statusState.vram==null;
 vramItem.node.hidden=hideVram;
 if(!hideVram){vramItem.label.textContent=t('statusVram');vramItem.value.textContent=`${fmt(Math.round(statusState.vram*10)/10)} GB`;}
 const hideEngine=cloud||!statusState.engine;
 engineItem.node.hidden=hideEngine;
 if(!hideEngine){engineItem.label.textContent=t('statusEngine');engineItem.value.textContent=statusState.engine;}
 webItem.hidden=cloud;
 // The header's privacy badge says "Local & private"; with a cloud model selected that is a contradiction.
 const localBadge=document.querySelector('.local-label');if(localBadge)localBadge.hidden=cloud;
 if(!cloud){
  const text=t(statusState.web?'statusWebOn':'statusWebOff');
  webValue.textContent=text;webItem.title=text;webItem.setAttribute('aria-label',text);webItem.setAttribute('aria-pressed',String(statusState.web));webItem.disabled=!!state.busy;
 }
}

function placeStatus(){
 const windowMode=statusState.placement==='window';
 statusRoot.dataset.placement=windowMode?'window':'composer';
 if(windowMode){
  if(statusRoot.parentElement!==document.body)document.body.append(statusRoot);
  document.body.classList.add('statusbar-window');
 }else{
  if(composerFoot&&statusRoot.parentElement!==composerFoot.parentElement)composerFoot.after(statusRoot);
  document.body.classList.remove('statusbar-window');
 }
}
function refreshStatus(){syncStatus();placeStatus();paintStatus();}

// The engine stream. The context event already carries what the renderer stores in state.contexts; writing it back keeps this
// listener self-contained (and lets the UI test feed the same event shape without a running model).
function handleEngineEvent(event){
 if(!event)return;
 if(event.type==='context'){
  if(state.chat&&event.data)state.contexts.set(state.chat.Id,event.data);
  refreshStatus();return;
 }
 if(event.type==='progress'&&/^Engine · /.test(String(event.data?.label||'')))refreshStatus();
}

function openModelMenu(){
 if(state.busy)return;
 if(state.page!=='chat')setPage('chat');
 const trigger=document.getElementById('model-trigger');if(trigger)trigger.click();
}
function openContextSettings(){
 openSettings('agent');
 const select=document.getElementById('context-size');
 if(select){
  // The real <select> is hidden by the segmented control; focus the chosen segment (or the select when there is none).
  const segment=select.nextElementSibling?.classList?.contains('segmented')?select.nextElementSibling.querySelector('button[aria-checked=true]'):null;
  const target=segment||select;
  target.focus();target.scrollIntoView({block:'center'});
 }
}
async function toggleWeb(){
 if(state.busy)return;
 if(!toolsConfig)await loadToolsConfig();
 if(!toolsConfig)return;
 if(toolsConfig.search.enabled){researchMode=false;await updateTools({search:{enabled:false}});return;}
 if(!toolsConfig.hostReady){toast(t('toolsUnavailable'));return;}
 if(state.page!=='chat')setPage('chat');
 showConsent();
}
modelItem.node.addEventListener('click',openModelMenu);
contextItem.node.addEventListener('click',openContextSettings);
webItem.addEventListener('click',()=>{toggleWeb();});

// Inputs. Wrapping the existing update points keeps this file free of timers: the paint happens in the same task as the change.
const statusApplyAppearance=applyAppearance;applyAppearance=function(){const result=statusApplyAppearance.apply(this,arguments);refreshStatus();return result;};
const statusRenderPickers=renderPickers;renderPickers=function(){statusRenderPickers.apply(this,arguments);refreshStatus();};
const statusRenderContext=renderContext;renderContext=function(){statusRenderContext.apply(this,arguments);refreshStatus();};
const statusSetBusy=setBusy;setBusy=function(){statusSetBusy.apply(this,arguments);refreshStatus();};
const statusPaintTools=paintToolSettings;paintToolSettings=function(){statusPaintTools.apply(this,arguments);refreshStatus();};
const statusRenderBackend=renderBackend;renderBackend=function(){statusRenderBackend.apply(this,arguments);refreshStatus();};
const statusLocalize=localize;localize=function(){statusLocalize.apply(this,arguments);refreshStatus();};
document.getElementById('model-picker').addEventListener('change',refreshStatus);
if(typeof api!=='undefined'&&api.onEvent)api.onEvent(handleEngineEvent);
window.addEventListener('lumen-ready',()=>{refreshStatus();if(!toolsConfig&&typeof loadToolsConfig==='function')loadToolsConfig();},{once:true});

placeStatus();
if(state.ready)refreshStatus();else statusRoot.hidden=true;
// Test seam only (no window.lumen change): read the state, feed an engine event, or force a repaint.
globalThis.LumenStatus=Object.freeze({state:statusState,refresh:refreshStatus,event:handleEngineEvent,placement:placeStatus});
