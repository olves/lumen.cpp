'use strict';
// Model presentation from main's model info (modelinfo.cjs): one display-name source for every screen, memory-fit labels,
// thinking support of the selected model and the automatic context. Model identity (Name/Repo/File) is never changed here.
Object.assign(translations,{
 fit_gpu:['Can fit fully on the GPU','GPU’ya tamamen sığabilir'],fit_hybrid:['Can run with GPU + RAM','GPU + RAM ile hibrit çalışabilir'],fit_cpu:['Runs from RAM on the CPU','CPU ile RAM’den çalışır'],fit_strain:['May strain memory','Bellek açısından zorlayabilir'],fit_unknown:['Not enough information to estimate','Tahmin için yeterli bilgi yok'],
 fitAtContext:['estimate at {n} context','{n} context için tahmin'],fitNoContext:['estimate from file size; context not included','dosya boyutundan tahmin; context dahil değil'],
 fitMoe:['MoE: all {experts} experts stay in memory, {used} run per token','MoE: {experts} uzmanın hepsi bellekte durur, token başına {used} tanesi çalışır'],moeChip:['MoE','MoE'],
 codingSorted:['Sorted for this computer: models that fit the GPU first.','Bu bilgisayara göre sıralandı: GPU’ya sığanlar önce.'],
 contextAuto:['Auto','Otomatik'],
 autoNote_gpu:['Auto uses {n} tokens for {model}: it fits fully on the GPU (estimate).','Otomatik, {model} için {n} token kullanıyor: tamamen GPU’ya sığıyor (tahmin).'],
 'autoNote_mostly-gpu':['Auto uses {n} tokens for {model}: a small part may run from RAM (estimate).','Otomatik, {model} için {n} token kullanıyor: küçük bir kısmı RAM’den çalışabilir (tahmin).'],
 autoNote_hybrid:['Auto uses {n} tokens for {model}: the model runs partly from RAM, so the window stays moderate (estimate).','Otomatik, {model} için {n} token kullanıyor: model kısmen RAM’den çalıştığı için pencere orta seviyede (tahmin).'],
 autoNote_cpu:['Auto uses {n} tokens for {model} on the CPU engine.','Otomatik, CPU motorunda {model} için {n} token kullanıyor.'],
 autoNote_strain:['Auto uses {n} tokens for {model}: memory is tight on this computer (estimate).','Otomatik, {model} için {n} token kullanıyor: bu bilgisayarda bellek sınırda (tahmin).'],
 autoNote_reduced:['Auto lowered the window to {n} tokens for {model} after the model failed to load.','Model yüklenemediği için Otomatik, {model} penceresini {n} token’a indirdi.'],
 'autoNote_no-metadata':['Auto uses {n} tokens for {model}: its details are not read yet.','Otomatik, {model} için {n} token kullanıyor: model ayrıntıları henüz okunmadı.'],
 'autoNote_no-size':['Auto uses {n} tokens.','Otomatik {n} token kullanıyor.'],'autoNote_unknown-model':['Auto uses {n} tokens.','Otomatik {n} token kullanıyor.'],
 modelLimit:['{model} supports up to {n} tokens.','{model} en fazla {n} token destekliyor.'],manualOverLimit:['This is more than {model} supports ({n} tokens).','Bu, {model} modelinin desteklediğinden fazla ({n} token).'],
 think_supported:['{model} supports thinking.','{model} düşünmeyi destekliyor.'],think_always:['{model} always thinks before answering; this switch does not change it.','{model} her zaman yanıt vermeden önce düşünür; bu düğme bunu değiştirmez.'],
 think_unsupported:['{model} does not support thinking, so this is off for it. The setting stays for models that do.','{model} düşünmeyi desteklemiyor; bu model için kapalı. Ayar destekleyen modeller için korunur.'],
 think_unknown:['Thinking support for {model} could not be determined. If it has no thinking mode, the setting has no effect.','{model} için düşünme desteği belirlenemedi. Düşünme modu yoksa ayarın etkisi olmaz.'],
 modelFullName:['Full name','Tam ad'],
 fitEstimate:['Memory labels are estimates from this computer’s free memory, the file size and, for downloaded models, the model’s own context needs. Speed and loading are measured only when the model runs.','Bellek etiketleri; bu bilgisayarın boş belleği, dosya boyutu ve indirilmiş modellerde modelin kendi context ihtiyacından yapılan tahminlerdir. Hız ve yükleme yalnızca model çalışınca ölçülür.']
});

// ---------- Names ----------
function modelByName(name){return state.models.find(m=>m.Name===name)||null;}
function displayName(model){const m=typeof model==='object'&&model?model:modelByName(model);return m?.Display||m?.Name||String(model||'');}
function modelDetail(model){const m=typeof model==='object'&&model?model:modelByName(model);return m?.Detail||m?.Name||'';}
function currentModel(){return $('model-picker').value||state.chat?.Model||'';}
const modelsRenderPickers=renderPickers;renderPickers=function(){
 modelsRenderPickers();
 for(const id of ['model-picker','bench-model'])for(const option of $(id).options){option.textContent=displayName(option.value);option.title=modelDetail(option.value);}
};
// Same menu as before; labels come from displayName and the full repository/file is the tooltip.
renderModelSelector=function(){
 const selected=modelByName($('model-picker').value);$('selected-model-name').textContent=selected?displayName(selected):t('chooseModel');
 $('selected-model-logo').replaceChildren(...(selected?[modelLogo(selected.Repo,selected.Name)]:[]));$('model-trigger').title=selected?modelDetail(selected):t('chooseModel');
 const list=$('model-options');list.replaceChildren();const query=$('model-filter').value.trim().toLocaleLowerCase();
 const matching=state.models.filter(m=>(displayName(m)+' '+m.Name+' '+m.File).toLocaleLowerCase().includes(query));
 if(!matching.length)list.append(el('p','model-menu-empty',t('noMatch')));
 for(const m of matching){
  const chosen=m.Name===selected?.Name,option=el('button','model-option'+(chosen?' selected':''));option.type='button';option.title=modelDetail(m);option.setAttribute('role','option');option.setAttribute('aria-selected',String(chosen));option.disabled=state.busy;
  const info=el('span','model-option-info');info.append(el('strong','',displayName(m)),el('small','',modelSize(m.Bytes)+' · '+t(m.Installed?'ready':'firstDownload')));
  option.append(modelLogo(m.Repo,m.Name),info,el('span','model-check',chosen?'✓':''));
  option.onclick=()=>{$('model-picker').value=m.Name;$('model-picker').dispatchEvent(new Event('change'));closeComposerMenus();$('model-trigger').focus();};list.append(option);
 }
};
const modelsMessageNode=messageNode;messageNode=function(m,index,stream=false){
 const result=modelsMessageNode(m,index,stream);
 if(m.Role!=='user'){const label=result.node.querySelector('.message-meta > span:nth-child(2)');if(label&&state.chat){label.textContent=displayName(state.chat.Model);label.title=modelDetail(state.chat.Model);}}
 return result;
};
renderModels=function(){
 const list=$('model-list');list.replaceChildren();const installed=state.models.filter(m=>m.Installed);
 for(const m of installed){const row=repoRow(m.Repo,displayName(m),modelSize(m.Bytes),true);row.title=modelDetail(m);list.append(row);}
 if(!installed.length){list.append(el('p','library-empty',t('noInstalled')));const button=el('button','text-button',t('browseHf'));button.onclick=()=>openSettings('explore');list.append(button);}
 if($('settings-model-count'))$('settings-model-count').textContent=installed.length;
};
// Download card: projector and draft jobs are named "<model> · vision" / "<model> · draft" by main.
function jobName(name){const m=String(name||'').match(/^(.*) · (vision|draft)$/);return m?displayName(m[1])+' · '+m[2]:(modelByName(name)?displayName(name):name);}
const modelsPaintDock=paintDock;paintDock=function(){const s=dockState;modelsPaintDock();if(s&&$('download-name'))$('download-name').textContent=jobName(s.name);};

// ---------- Memory fit ----------
const fitCache=new Map(),fitQueue=new Map();let fitTimer=0,fitWindow=null;
function fitEstimate(bytes,name){
 if(!bytes)return null;const key=(name||'')+'|'+Math.round(bytes);if(fitCache.has(key))return fitCache.get(key);
 fitQueue.set(key,{key,bytes:Math.round(bytes),name:name||null});if(!fitTimer)fitTimer=setTimeout(flushFits,40);return null;
}
async function flushFits(){
 fitTimer=0;const items=[...fitQueue.values()].slice(0,300);fitQueue.clear();if(!items.length||!api.modelsInfo)return;
 try{const r=await api.modelsInfo('fit',{items});fitWindow=r.context;for(const it of items)fitCache.set(it.key,r.estimates[it.key]||{placement:'unknown'});paintFitDots();if(state.page==='settings'&&['explore','library'].includes(state.setting))renderModelDetails();}catch{}
}
function fitText(e){
 if(!e)return '';const parts=[t('fit_'+(e.placement||'unknown'))];
 if(e.placement!=='unknown')parts.push(e.contextIncluded?tf('fitAtContext',{n:fmt(fitWindow||8192)}):t('fitNoContext'));
 let text=parts[0]+(parts[1]?' ('+parts[1]+')':'');if(e.moe&&e.experts)text+=' · '+tf('fitMoe',{experts:fmt(e.experts),used:fmt(e.expertsUsed||0)});return text;
}
const levels={gpu:'gpu',hybrid:'mixed',cpu:'mixed',strain:'over'};
// A file that is installed is estimated with its own metadata (context included); file lists from Hugging Face carry no
// Installed flag, so they are matched by SHA-256 or exact size.
function installedName(bytes,m){const found=state.models.find(x=>x.Installed&&(m&&x.Name===m.Name||m&&m.Sha&&x.Sha===m.Sha||x.Bytes===bytes));return found?found.Name:null;}
fitLevel=function(bytes,name){const e=fitEstimate(bytes,name||installedName(bytes));return e?levels[e.placement]||null:null;};
fit=function(m){return fitText(fitEstimate(m.Bytes,installedName(m.Bytes,m)));};
// Dots are drawn at once and filled when the estimate arrives.
fitDot=function(bytes,name){
 if(!bytes)return null;name=name||installedName(bytes);const dot=el('span','fit-dot');dot.dataset.fitKey=(name||'')+'|'+Math.round(bytes);dot.setAttribute('role','img');
 const e=fitEstimate(bytes,name);paintDot(dot,e);return dot;
};
function paintDot(dot,e){const level=e?levels[e.placement]:null;dot.className='fit-dot'+(level?' fit-'+level:'');dot.hidden=!e||e.placement==='unknown';const title=fitText(e);dot.title=title;dot.setAttribute('aria-label',title);}
function paintFitDots(){document.querySelectorAll('.fit-dot[data-fit-key]').forEach(dot=>paintDot(dot,fitCache.get(dot.dataset.fitKey)));}
function resetFits(){fitCache.clear();paintFitDots();}
// Coding collection: order by what this computer can run (GPU, then GPU + RAM, then the rest), downloads within a group.
const modelsDrawHubList=drawHubList;drawHubList=function(){
 if(exploreView.kind!=='coding')return modelsDrawHubList();
 const rank={gpu:0,hybrid:1,cpu:2,strain:3,unknown:4};const pending=hubRepos.filter(item=>item.parameters&&!fitCache.has('|'+Math.round(estimateQ4(item.parameters))));
 for(const item of pending)fitEstimate(estimateQ4(item.parameters));
 const sortAndDraw=()=>{hubRepos=[...hubRepos].sort((a,b)=>(rank[fitCache.get('|'+Math.round(estimateQ4(a.parameters)))?.placement]??4)-(rank[fitCache.get('|'+Math.round(estimateQ4(b.parameters)))?.placement]??4)||(b.downloads||0)-(a.downloads||0));modelsDrawHubList();const note=el('p','quiet explore-note',t('codingSorted'));$('discover-list').prepend(note);};
 if(!pending.length)return sortAndDraw();
 modelsDrawHubList();flushFits().then(()=>{if(exploreView.kind==='coding')sortAndDraw();});
};
const modelsExploreRow=exploreRow;exploreRow=function(repo,data){const row=modelsExploreRow(repo,data);if(/[-_]A\d+(?:\.\d+)?B(?:[-_]|$)/i.test(repo)||/moe/i.test(data.architecture||'')){const facts=row.querySelector('.row-facts');if(facts){const chip=el('span','fact-chip',t('moeChip'));chip.title=t('fitMoe').replace(/\{experts\}|\{used\}/g,'…');facts.append(chip);}}return row;};

// ---------- Context (Auto / manual) ----------
const autoContextByModel=new Map();
function effectiveContext(){if(state.prefs.contextMode!=='auto')return state.prefs.contextSize||4096;return autoContextByModel.get(currentModel())?.value||state.prefs.contextSize||4096;}
async function refreshAutoContext(){
 const model=currentModel();if(!model||!api.modelsInfo)return;
 try{const r=await api.modelsInfo('context',{model});autoContextByModel.set(model,r);}catch{}
 paintContextNote();renderContext();
}
(function addContextControls(){
 const select=$('context-size');if(!select.querySelector('option[value="auto"]')){const option=el('option','',t('contextAuto'));option.value='auto';option.dataset.i18n='contextAuto';select.prepend(option);}
 const row=select.closest('.setting-row');if(row&&!$('context-auto-note')){const note=el('p','quiet context-auto-note');note.id='context-auto-note';row.after(note);}
})();
function paintContextNote(){
 const note=$('context-auto-note');if(!note)return;const model=currentModel(),m=modelByName(model),name=displayName(model),info=autoContextByModel.get(model),trained=info?.trained||m?.Meta?.trainedContext||null;
 $('context-size').value=state.prefs.contextMode==='auto'?'auto':String(state.prefs.contextSize);
 const lines=[];
 if(state.prefs.contextMode==='auto'&&info)lines.push(tf('autoNote_'+(info.reason||'gpu'),{n:fmt(info.value),model:name}));
 if(state.prefs.contextMode!=='auto'&&trained&&state.prefs.contextSize>trained)lines.push(tf('manualOverLimit',{model:name,n:fmt(trained)}));
 else if(trained)lines.push(tf('modelLimit',{model:name,n:fmt(trained)}));
 note.textContent=lines.join(' ');note.hidden=!lines.length;
}
// Context sizes and Auto share one select; Auto keeps the last manual size for when the user switches back.
savePreferences=async function(){
 const value=$('context-size').value,auto=value==='auto';
 try{state.prefs=await api.preferences({...state.prefs,language:$('language').value,motion:$('motion').checked,contextMode:auto?'auto':'manual',contextSize:auto?state.prefs.contextSize:Number(value)});state.contexts.clear();localize();}catch(e){toast(e.message);}
 resetFits();refreshAutoContext();
};
['language','motion','context-size'].forEach(id=>$(id).onchange=savePreferences);
const modelsRenderContext=renderContext;renderContext=function(){
 modelsRenderContext();const c=state.contexts.get(state.chat?.Id);if(c)return;
 const capacity=effectiveContext();$('context-text').textContent=`Context — / ${fmt(capacity)}`;$('window-tokens').textContent=fmt(capacity);
};
expectedReserve=function(){const p=state.prefs,ctx=effectiveContext();if(toolsConfig&&!toolsConfig.hostReady)return 512;const n=p.responseTokens||512;const thinking=p.thinking&&thinkingState(currentModel()).state!=='unsupported';return Math.min(thinking?Math.max(n,2048):n,Math.floor(ctx/2));};

// ---------- Thinking support ----------
function thinkingState(model){const m=modelByName(model);return m?.Meta?.thinking||{state:'unknown'};}
(function addThinkingNote(){const row=$('thinking-mode').closest('.setting-row');if(row&&!$('thinking-model-note')){const note=el('p','quiet thinking-model-note');note.id='thinking-model-note';row.after(note);}})();
function paintThinkingSupport(){
 const note=$('thinking-model-note');if(!note)return;const model=currentModel(),cap=thinkingState(model),name=displayName(model);
 const key=cap.state==='supported'&&cap.toggle===false?'think_always':'think_'+cap.state;note.textContent=model?tf(key,{model:name}):'';
 const noHost=toolsConfig&&!toolsConfig.hostReady;$('thinking-mode').disabled=!!noHost||cap.state==='unsupported'||key==='think_always';
 if(cap.state==='unsupported')$('thinking-mode').value='off';else if(key==='think_always')$('thinking-mode').value='on';else $('thinking-mode').value=state.prefs.thinking?'on':'off';
 syncSegmented();
}
const modelsPaintResponse=paintResponseSettings;paintResponseSettings=function(){modelsPaintResponse();paintThinkingSupport();paintContextNote();};

// ---------- Refresh ----------
listen('models-meta',models=>{if(!Array.isArray(models))return;state.models=models;resetFits();renderPickers();if(state.page==='settings'){renderModels();renderModelDetails();}paintThinkingSupport();refreshAutoContext();});
$('model-picker').addEventListener('change',()=>{paintThinkingSupport();refreshAutoContext();});
const modelsLocalize=localize;localize=function(){modelsLocalize();if(!state.ready)return;for(const id of ['model-picker','bench-model'])for(const option of $(id).options)option.textContent=displayName(option.value);paintThinkingSupport();paintContextNote();};
const modelsSpeedSave=savePerformance;savePerformance=async function(){await modelsSpeedSave();resetFits();autoContextByModel.clear();refreshAutoContext();};
for(const id of ['gpu-layers','speculative','kv-cache'])$(id).onchange=savePerformance;
function startModels(){renderPickers();paintThinkingSupport();refreshAutoContext();}
if(state.ready)startModels();else window.addEventListener('lumen-ready',startModels,{once:true});
