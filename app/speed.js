'use strict';
// Runtime → Performance (GPU memory, speculative generation, compact context memory) and per-model MTP drafts in the model
// details. Settings take effect when the model next loads; nothing is checked online until the user clicks.
Object.assign(translations,{
 performanceLabel:['PERFORMANCE','PERFORMANS'],
 gpuMemory:['GPU memory','GPU belleği'],gpuMemoryHint:['Auto fits as much of the model as the GPU can hold and keeps the rest in RAM, including the experts of large MoE models. All on GPU fails over to the CPU when the model does not fit.','Otomatik, modelin GPU’ya sığan kısmını GPU’ya, kalanını RAM’e koyar; büyük MoE modellerinin uzmanları dahil. Hepsi GPU’da seçeneği model sığmazsa CPU’ya düşer.'],
 gpuAuto:['Auto','Otomatik'],gpuAll:['All on GPU','Hepsi GPU’da'],gpuCpu:['CPU only','Yalnızca CPU'],
 fastGeneration:['Faster generation','Hızlı üretim'],fastGenerationHint:['Guesses upcoming text from the conversation and checks several tokens in one step. Answers stay the same. Most useful when the model repeats code or text you gave it.','Gelecek metni sohbetten tahmin eder ve birkaç token’ı tek adımda doğrular. Yanıtlar değişmez. En çok, model verdiğin kodu veya metni tekrar yazarken işe yarar.'],
 compactContext:['Compact context memory','Sıkıştırılmış context belleği'],compactContextHint:['Keeps the context in 8-bit instead of 16-bit: about half the memory, so longer contexts or larger models fit. The quality change is usually very small.','Context’i 16 yerine 8 bit tutar: yaklaşık yarı bellek, böylece daha uzun context veya daha büyük model sığar. Kalite farkı genellikle çok küçüktür.'],
 performanceNote:['Changes apply when the model next loads. Some models also offer a small draft model for faster replies: open the model in Library.','Değişiklikler model bir sonraki yüklenişinde uygulanır. Bazı modellerin hızlı yanıt için küçük bir taslak modeli de vardır: modeli Library’de aç.'],
 performanceNoHost:['These settings need the engine host (backend/lumen-host.exe). The engine currently uses its defaults.','Bu ayarlar motor host’unu (backend/lumen-host.exe) gerektirir. Motor şu an varsayılanlarını kullanıyor.'],
 contextNeedsHost:['32,768 tokens needs the engine host.','32.768 token motor host’unu gerektirir.'],
 draftTitle:['Faster replies','Hızlı yanıt'],draftReady:['A draft model (MTP) is installed. With Faster generation on, replies are usually faster; the answer is checked by this model.','Bir taslak model (MTP) kurulu. Hızlı üretim açıkken yanıtlar genellikle daha hızlıdır; cevabı bu model doğrular.'],
 draftMissing:['Some models ship a small draft model (MTP) that predicts several tokens at once.','Bazı modeller aynı anda birkaç token tahmin eden küçük bir taslak modelle (MTP) gelir.'],
 draftNone:['This model has no draft model. Faster generation still works without one.','Bu modelin taslak modeli yok. Hızlı üretim taslak olmadan da çalışır.'],
 draftDownloading:['Downloading the draft model. Progress is shown at the top.','Taslak model indiriliyor. İlerleme üstte görünür.'],
 draftCheck:['Check for a draft model','Taslak modeli kontrol et'],draftDownload:['Download draft model · {size}','Taslak modeli indir · {size}'],draftRemove:['Remove','Kaldır'],draftRemoved:['Draft model removed','Taslak model kaldırıldı'],
 draftOff:['Faster generation is off in Runtime, so the draft model is not used.','Runtime’da Hızlı üretim kapalı; taslak model kullanılmıyor.']
});
segmentedIds.push('gpu-layers');
function paintPerformance(){
 const p=state.prefs;$('gpu-layers').value=['auto','gpu','cpu'].includes(p.gpuLayers)?p.gpuLayers:'auto';$('speculative').checked=p.speculative!==false;$('kv-cache').checked=p.kvCache==='q8_0';
 const noHost=toolsConfig&&!toolsConfig.hostReady;for(const id of ['gpu-layers','speculative','kv-cache'])$(id).disabled=!!noHost;
 $('performance-note').textContent=t(noHost?'performanceNoHost':'performanceNote');
 const wide=document.querySelector('#context-size option[value="32768"]');if(wide){wide.disabled=!!noHost;wide.title=noHost?t('contextNeedsHost'):'';}
}
async function savePerformance(){
 try{state.prefs=await api.preferences({...state.prefs,gpuLayers:$('gpu-layers').value,speculative:$('speculative').checked,kvCache:$('kv-cache').checked?'q8_0':'f16'});}catch(e){toast(cleanError(e));}
 paintPerformance();syncSegmented();
}
for(const id of ['gpu-layers','speculative','kv-cache'])$(id).onchange=savePerformance;
const speedOpenSettings=openSettings;openSettings=function(section,animate){speedOpenSettings(section,animate);if(['runtime','agent'].includes(state.setting)){paintPerformance();if(!toolsConfig)loadToolsConfig().then(paintPerformance,()=>{});}};
const speedLocalize=localize;localize=function(){speedLocalize();if(state.ready)paintPerformance();};

// Model details: MTP draft for an installed model of the selected repository.
const draftState=new Map();let draftBusy=false;
async function loadDraft(model,action='status'){
 if(!model||!api.drafts)return null;
 try{const status=await api.drafts(action,{model});draftState.set(model,{...(draftState.get(model)||{}),...status,downloading:action==='enable'?!status.ready:(draftState.get(model)?.downloading&&!status.ready)});}
 catch(e){if(action!=='status')toast(cleanError(e));draftState.set(model,{...(draftState.get(model)||{}),error:true});}
 return draftState.get(model);
}
const speedRenderDetails=renderModelDetails;renderModelDetails=function(){
 speedRenderDetails();
 const panel=$('model-details'),model=state.models.find(m=>m.Repo===selectedRepo&&m.Installed);if(!model||!panel)return;
 const s=draftState.get(model.Name);if(!s){loadDraft(model.Name).then(s=>{if(s&&selectedRepo===model.Repo)renderModelDetails();});return;}
 const row=el('div','vision-detail draft-detail'),text=el('div');
 const detail=s.ready?(state.prefs.speculative===false?'draftOff':'draftReady'):s.checked===false?'draftNone':s.downloading?'draftDownloading':'draftMissing';
 text.append(el('strong','',t('draftTitle')),el('p','quiet',t(detail)));row.append(text);
 if(s.checked!==false||s.ready){
  const action=el('button','secondary');action.type='button';action.disabled=state.busy||draftBusy||s.downloading||s.host===false;
  action.textContent=s.ready?t('draftRemove'):s.checked?tf('draftDownload',{size:modelSize(s.bytes)}):t('draftCheck');
  action.onclick=async()=>{draftBusy=true;await loadDraft(model.Name,s.ready?'remove':s.checked?'enable':'check');draftBusy=false;if(s.ready)toast(t('draftRemoved'));renderModelDetails();};
  row.append(action);
 }
 const anchor=panel.querySelector('.vision-detail:not(.draft-detail)')||panel.querySelector('.options-note');if(anchor)anchor.after(row);else panel.append(row);
};
listen('download-event',event=>{
 if(!/ · draft$/.test(event.name||'')||!['completed','failed','cancelled','paused'].includes(event.phase))return;
 const model=event.name.slice(0,-' · draft'.length);loadDraft(model).then(()=>{if(state.page==='settings')renderModelDetails();});
});
if(state.ready)paintPerformance();else window.addEventListener('lumen-ready',paintPerformance,{once:true});
