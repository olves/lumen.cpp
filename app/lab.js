'use strict';
// Speed lab through lumen-host: a fixed Standard profile for comparable numbers and a Current-settings profile that uses the
// chat's engine options and context. Loading, first token, prompt reading and generation are reported separately, together
// with the engine and settings that actually ran. Results persist in benchmarks.json. Not a quality score.
Object.assign(translations,{
 benchProfile:['Profile','Profil'],profileStandard:['Standard','Standart'],profileCurrent:['Current settings','Mevcut ayarlar'],
 protocolStandard:['Standard: 2,048 context · every layer on the GPU · no compact cache or speculation · 192 tokens · temperature 0 · seed 42. Comparable between models and computers. Not a quality score.','Standart: 2.048 context · tüm katmanlar GPU’da · sıkıştırma ve spekülatif üretim yok · 192 token · sıcaklık 0 · seed 42. Modeller ve bilgisayarlar arasında karşılaştırılabilir. Kalite puanı değildir.'],
 protocolCurrent:['Current settings: the engine options and context your chats use right now (Runtime → Performance, Chat behavior). 192 tokens · temperature 0 · seed 42. Not a quality score.','Mevcut ayarlar: sohbetlerinin şu an kullandığı motor ayarları ve context (Runtime → Performance, Chat behavior). 192 token · sıcaklık 0 · seed 42. Kalite puanı değildir.'],
 protocolNoHost:['The engine host is unavailable, so the older built-in test runs (fixed prompt format, no engine details).','Motor host’u kullanılamıyor; eski yerleşik test çalışır (sabit istem biçimi, motor ayrıntısı yok).'],
 r_generation:['Generation','Üretim'],r_prompt:['Prompt reading','İstem okuma'],r_first:['First token','İlk token'],r_load:['Model load','Model yükleme'],r_tokens:['{n} tokens','{n} token'],
 r_profile_standard:['Standard','Standart'],r_profile_current:['Current settings','Mevcut ayarlar'],r_profile_legacy:['Older test','Eski test'],
 r_engine:['Engine {engine} · GPU layers {layers} · context {ctx} · cache {kv} · speculation {spec}{draft}','Motor {engine} · GPU katmanı {layers} · context {ctx} · önbellek {kv} · spekülatif {spec}{draft}'],
 r_weights:['Weights: {gpu} on the GPU, {cpu} in RAM','Ağırlıklar: {gpu} GPU’da, {cpu} RAM’de'],
 r_on:['on','açık'],r_off:['off','kapalı'],r_draft:[' · MTP draft',' · MTP taslağı'],r_drafted:['{accepted} of {drafted} drafted tokens accepted','{drafted} taslak token’dan {accepted} tanesi kabul edildi'],
 r_legacy:['Built-in test of the original engine (Qwen-style prompt, fixed settings).','Orijinal motorun yerleşik testi (Qwen tarzı istem, sabit ayarlar).']
});
(function addProfile(){
 if($('bench-profile'))return;const select=el('select');select.id='bench-profile';
 for(const [value,key] of [['standard','profileStandard'],['current','profileCurrent']]){const option=el('option','',t(key));option.value=value;option.dataset.i18n=key;select.append(option);}
 const label=el('label','',t('benchProfile'));label.htmlFor='bench-profile';label.dataset.i18n='benchProfile';
 $('bench-model').after(label,select);select.onchange=paintProtocol;
})();
segmentedIds.push('bench-profile');
function paintProtocol(){const note=document.querySelector('#lab-page [data-i18n="protocol"]');if(!note)return;const noHost=toolsConfig&&!toolsConfig.hostReady;$('bench-profile').disabled=!!noHost;note.textContent=t(noHost?'protocolNoHost':$('bench-profile').value==='current'?'protocolCurrent':'protocolStandard');}
$('run-bench').onclick=async()=>{
 if(state.busy)return;setBusy(true,'bench');$('bench-output').replaceChildren();$('bench-output').hidden=false;
 try{state.results.unshift(await api.request('bench',{name:$('bench-model').value,profile:$('bench-profile').value}));renderResults();}
 catch(e){if(!e.message.includes('Cancelled'))toast(cleanError(e));}
 finally{setBusy(false);}
};
function benchValue(value,unit){return value>=0?value+unit:'—';}
renderResults=function(){
 const box=$('bench-results');box.replaceChildren();
 for(const r of state.results){
  const row=el('div','result-row'),head=el('div','result-head');head.append(el('h3','',displayName(r.Model)),el('span','format-tag',t('r_profile_'+(r.Protocol==='current'?'current':r.Protocol==='legacy'||!r.Protocol?'legacy':'standard'))));
  if(r.Date){const date=new Date(r.Date);if(!isNaN(date))head.append(el('small','quiet',date.toLocaleString(state.prefs.language==='tr'?'tr-TR':'en-US',{dateStyle:'medium',timeStyle:'short'})));}
  row.append(head);const vals=el('div','result-values');
  const cells=r.Protocol&&r.Protocol!=='legacy'?[
   [benchValue(r.TokensPerSecond,' tok/s'),t('r_generation')+' · '+tf('r_tokens',{n:fmt(r.Tokens)})],
   [benchValue(r.PromptPerSecond,' tok/s'),t('r_prompt')+' · '+tf('r_tokens',{n:fmt(r.PromptTokens)})],
   [benchValue(r.FirstTokenSeconds,' s'),t('r_first')],
   [benchValue(r.LoadSeconds,' s'),t('r_load')]
  ]:[[Number(r.TokensPerSecond).toFixed(1)+' tok/s',t('r_generation')],[Number(r.FirstTokenSeconds).toFixed(2)+' s',t('r_first')],[String(r.Tokens),tf('r_tokens',{n:''}).trim()]];
  for(const [value,label] of cells){const cell=el('div');cell.append(el('strong','',value),el('span','',label));vals.append(cell);}
  row.append(vals);
  if(r.Protocol&&r.Protocol!=='legacy'){
   row.append(el('p','quiet result-settings',tf('r_engine',{engine:String(r.Backend||'?').toUpperCase(),layers:r.GpuLayers,ctx:fmt(r.Context),kv:r.Kv,spec:t(r.Speculative?'r_on':'r_off'),draft:r.Draft?t('r_draft'):''})));
   if(r.GpuWeightsMiB>0||r.CpuWeightsMiB>0)row.append(el('p','quiet result-settings',tf('r_weights',{gpu:modelSize(r.GpuWeightsMiB*1048576),cpu:modelSize(r.CpuWeightsMiB*1048576)})));
   if(r.DraftTokens>0)row.append(el('p','quiet result-settings',tf('r_drafted',{accepted:fmt(r.DraftAccepted),drafted:fmt(r.DraftTokens)})));
  }else row.append(el('p','quiet result-settings',t('r_legacy')));
  box.append(row);
 }
};
async function loadBenchmarks(){try{state.results=await api.modelsInfo('benchmarks');renderResults();}catch{}}
const labOpenSettings=openSettings;openSettings=function(section,animate){labOpenSettings(section,animate);if(state.setting==='performance'){paintProtocol();loadBenchmarks();if(!toolsConfig)loadToolsConfig().then(paintProtocol,()=>{});}};
const labLocalize=localize;localize=function(){labLocalize();if(state.ready){paintProtocol();renderResults();}};
