'use strict';
// Runtime → Performance (GPU memory, speculative generation, compact context memory) and per-model MTP drafts in the model
// details. Settings take effect when the model next loads; nothing is checked online until the user clicks.
Object.assign(translations,{
 performanceLabel:['Performance','Performans'],
 gpuMemory:['GPU memory','GPU belleği'],gpuMemoryHint:['Auto fits as much of the model as the GPU can hold and keeps the rest in RAM, including the experts of large MoE models. All on GPU fails over to the CPU when the model does not fit.','Otomatik, modelin GPU’ya sığan kısmını GPU’ya, kalanını RAM’e koyar; büyük MoE modellerinin uzmanları dahil. Hepsi GPU’da seçeneği model sığmazsa CPU’ya düşer.'],
 gpuAuto:['Auto','Otomatik'],gpuAll:['All on GPU','Hepsi GPU’da'],gpuCpu:['CPU only','Yalnızca CPU'],
 fastGeneration:['Faster generation','Hızlı üretim'],fastGenerationHint:['Guesses upcoming text from the conversation and checks several tokens in one step. Answers stay the same. Most useful when the model repeats code or text you gave it.','Gelecek metni sohbetten tahmin eder ve birkaç token’ı tek adımda doğrular. Yanıtlar değişmez. En çok, model verdiğin kodu veya metni tekrar yazarken işe yarar.'],
 compactContext:['Compact context memory','Sıkıştırılmış context belleği'],compactContextHint:['Stores the context in fewer bits so longer contexts or larger models fit. 8-bit: about half the memory, practically no change. Tighter: keys stay 8-bit, values 4-bit, about 40% of the memory; measured near lossless on Qwen2.5 and Qwen3; slightly slower when everything already fits.','Context’i daha az bitle tutar; böylece daha uzun context veya daha büyük model sığar. 8 bit: yaklaşık yarı bellek, pratikte fark yok. Daha sıkı: anahtarlar 8, değerler 4 bit, belleğin yaklaşık %40’ı; Qwen2.5 ve Qwen3’te neredeyse kayıpsız ölçüldü; her şey zaten sığıyorsa biraz daha yavaştır.'],
 kvOff:['Off (16-bit)','Kapalı (16 bit)'],kvCompact:['8-bit','8 bit'],kvTight:['Tighter (8 + 4-bit)','Daha sıkı (8 + 4 bit)'],
 idleUnload:['Free memory when idle','Boştayken belleği boşalt'],idleUnloadHint:['Unloads the chat model from RAM and VRAM after it has not been used for this long. The next message loads it again, which takes a few seconds.','Sohbet modeli bu süre boyunca kullanılmazsa RAM ve VRAM’den çıkarılır. Sonraki mesaj modeli yeniden yükler; bu birkaç saniye sürer.'],idleNever:['Never','Hiçbir zaman'],idle5:['5 min','5 dk'],idle15:['15 min','15 dk'],idle30:['30 min','30 dk'],idle60:['1 hour','1 saat'],
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
segmentedIds.push('gpu-layers','idle-unload');
function paintPerformance(){
 const p=state.prefs;$('gpu-layers').value=['auto','gpu','cpu'].includes(p.gpuLayers)?p.gpuLayers:'auto';$('speculative').checked=p.speculative!==false;$('kv-cache').value=['q8_0','k8v4'].includes(p.kvCache)?p.kvCache:'f16';
 $('idle-unload').value=String([0,5,15,30,60].includes(Number(p.idleUnload))?Number(p.idleUnload):0);
 const noHost=toolsConfig&&!toolsConfig.hostReady;for(const id of ['gpu-layers','speculative','kv-cache'])$(id).disabled=!!noHost;
 $('performance-note').textContent=t(noHost?'performanceNoHost':'performanceNote');
 for(const wide of document.querySelectorAll('#context-size option[value="32768"],#context-size option[value="65536"]')){wide.disabled=!!noHost;wide.title=noHost?t('contextNeedsHost'):'';}
}
async function savePerformance(){
 try{state.prefs=await api.preferences({...state.prefs,gpuLayers:$('gpu-layers').value,speculative:$('speculative').checked,kvCache:$('kv-cache').value});}catch(e){toast(cleanError(e));}
 paintPerformance();syncSegmented();
}
for(const id of ['gpu-layers','speculative','kv-cache'])$(id).onchange=savePerformance;
$('idle-unload').onchange=async()=>{try{state.prefs=await api.preferences({...state.prefs,idleUnload:Number($('idle-unload').value)});}catch(e){toast(cleanError(e));}paintPerformance();syncSegmented();};
// The core unloaded the idle model (prefs.idleUnload): the engine and context shown are no longer in memory.
api.onEvent(e=>{if(e?.type!=='unloaded')return;state.activeBackend=null;renderBackend();state.contexts.clear();renderContext();});
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
