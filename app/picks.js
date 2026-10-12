'use strict';
// Explore: "For you" ranked for this computer with a one-line reason, clean model names, and what a model can do (thinking,
// photos, tool calls) shown before downloading. Capabilities come from the chat template on Hugging Face (main.cjs capsOf) and,
// once installed, from the file itself. Unknown stays unknown: no badge in the list, a "?" in the details.
Object.assign(translations,{
 pickInstalled:['Installed · ready to use','Kurulu · kullanıma hazır'],pickBest:['Largest that fits your GPU','GPU’na sığan en büyük model'],
 pickGpu:['Fits your GPU · quick replies','GPU’na sığar · hızlı yanıt'],pickHybrid:['Uses GPU and RAM · slower','GPU ve RAM kullanır · daha yavaş'],
 pickCpu:['Runs on the CPU · slow','CPU’da çalışır · yavaş'],pickStrain:['May not fit in memory','Belleğe sığmayabilir'],
 pickCode:['For code','Kod için'],pickSmall:['Small and quick','Küçük ve hızlı'],
 pickNote:['Sorted for this computer: installed first, then what fits your GPU, largest first.','Bu bilgisayara göre sıralandı: önce kurulu olanlar, sonra GPU’na sığanlar, büyükten küçüğe.'],
 capThinking:['Thinking','Düşünme'],capVision:['Photos','Fotoğraf'],capTools:['Tools','Araçlar'],capCode:['Code','Kod'],
 capThinkingHint:['Can reason before answering (Settings → Chat behavior or Run settings).','Yanıt vermeden önce düşünebilir (Ayarlar → Sohbet davranışı veya Çalıştırma ayarları).'],
 capThinkingAlways:['Always reasons before answering.','Her zaman yanıt vermeden önce düşünür.'],
 capVisionHint:['Can look at photos once its vision file is downloaded (Library → Vision).','Görme dosyası indirildiğinde fotoğraflara bakabilir (Kütüphane → Görme).'],
 capToolsHint:['Its chat template supports tool calls.','Sohbet şablonu araç çağrılarını destekliyor.'],
 capsHeading:['WHAT IT CAN DO','NELER YAPABİLİR'],capYes:['yes','var'],capNo:['no','yok'],capUnknown:['unknown','bilinmiyor'],
 capsSource:['From the model’s chat template on Hugging Face; after download, from the file.','Hugging Face’teki sohbet şablonundan; indirildikten sonra dosyanın kendisinden.'],
 capsNone:['Not known yet: this repository reports no chat template.','Henüz bilinmiyor: bu depo sohbet şablonu bildirmiyor.'],
});

// Installed files know their own template; otherwise the Hugging Face metadata of the repository.
function capsFor(repo){
 const info=modelInfo.get(repo)||hubMeta.get(repo),caps={...(info?.caps||{})};
 const installed=state.models.find(m=>m.Repo===repo&&m.Installed&&m.Meta?.thinking&&m.Meta.thinking.state!=='unknown');
 if(installed){caps.thinking=installed.Meta.thinking.state;caps.thinkingToggle=installed.Meta.thinking.toggle!==false;}
 return caps;
}
const isCoder=repo=>/coder|[-_]code[-_]|codestral|starcoder|devstral/i.test(repo);
function capChips(repo){
 const caps=capsFor(repo),chips=[];
 const chip=(key,hint)=>{const c=el('span','fact-chip cap-chip',t(key));c.title=t(hint);chips.push(c);};
 if(isCoder(repo))chip('capCode','pickCode');
 if(caps.thinking==='supported')chip('capThinking',caps.thinkingToggle===false?'capThinkingAlways':'capThinkingHint');
 if(caps.vision===true)chip('capVision','capVisionHint');
 if(caps.tools===true)chip('capTools','capToolsHint');
 return chips;
}
const picksExploreRow=exploreRow;exploreRow=function(repo,data){
 const row=picksExploreRow(repo,data),facts=row.querySelector('.row-facts');
 const chips=capChips(repo);if(chips.length){if(facts)facts.append(...chips);else{const f=el('span','row-facts');f.append(...chips);row.querySelector('div')?.append(f);}}
 return row;
};

// ---------- For you ----------
const pickRank={gpu:0,hybrid:1,cpu:2,strain:3,unknown:4};let picksFetching=false;
function pickModel(repo){const models=state.models.filter(m=>m.Repo===repo);return models.find(m=>m.Installed)||[...models].sort((a,b)=>a.Bytes-b.Bytes)[0];}
function pickFit(m){const e=fitEstimate(m.Bytes,m.Installed?m.Name:null);return e?.placement||null;}
renderCurated=function(){
 hubTicket++;exploreView={kind:'recommended',query:''};syncExploreControls();
 const repos=[...new Set(state.models.map(m=>m.Repo))].filter(Boolean),items=repos.map(repo=>{const m=pickModel(repo);return {repo,m,fit:pickFit(m)};});
 const pending=items.some(x=>!x.fit);
 items.sort((a,b)=>(b.m.Installed-a.m.Installed)||((pickRank[a.fit]??4)-(pickRank[b.fit]??4))||(['gpu','hybrid'].includes(a.fit)?b.m.Bytes-a.m.Bytes:a.m.Bytes-b.m.Bytes));
 const best=items.find(x=>!x.m.Installed&&x.fit==='gpu');
 if(!items.some(x=>x.repo===selectedRepo)){selectedRepo=items[0]?.repo||'';selectedFiles=state.models.filter(m=>m.Repo===selectedRepo);}
 const rows=items.map(x=>{
  const meta=modelInfo.get(x.repo)||hubMeta.get(x.repo);
  const row=exploreRow(x.repo,{title:displayName(x.m),bytes:x.m.Bytes,params:meta?.parameters,downloads:meta?.downloads,installed:state.models.some(m=>m.Repo===x.repo&&m.Installed)});
  const reason=x.m.Installed?t('pickInstalled'):x===best?t('pickBest'):x.fit&&x.fit!=='unknown'?t({gpu:'pickGpu',hybrid:'pickHybrid',cpu:'pickCpu',strain:'pickStrain'}[x.fit]):'';
  const purpose=isCoder(x.repo)?t('pickCode'):(meta?.parameters?meta.parameters<=2.5e9:x.m.Bytes<1.6e9)?t('pickSmall'):'';
  const text=[purpose,reason].filter(Boolean).join(' · ');if(text){const line=el('small','pick-reason',text);row.querySelector('div')?.append(line);}
  return row;
 });
 const note=el('p','quiet explore-note',t('pickNote'));
 $('discover-list').replaceChildren(note,...rows);
 setExploreHeading(exploreHeading(),items.length);fadeList();loadInfo(selectedRepo);
 if(pending)flushFits().then(()=>{if(exploreView.kind==='recommended'&&state.setting==='explore'&&items.some(x=>!x.fit&&pickFit(x.m)))renderCurated();});
 fetchPickInfo(repos);
};
// Hugging Face metadata (capabilities, parameters, downloads) for the listed repositories, a few at a time, then one repaint.
async function fetchPickInfo(repos){
 if(picksFetching)return;const missing=repos.filter(r=>!modelInfo.has(r)).slice(0,12);if(!missing.length)return;picksFetching=true;
 try{
  for(let i=0;i<missing.length;i+=4)await Promise.all(missing.slice(i,i+4).map(repo=>api.modelInfo(repo).then(info=>{if(modelInfo.size>=24)modelInfo.delete(modelInfo.keys().next().value);modelInfo.set(repo,info);}).catch(()=>{})));
 }finally{picksFetching=false;}
 if(exploreView.kind==='recommended'&&state.page==='settings'&&state.setting==='explore')renderCurated();
}

// ---------- Details ----------
const picksRenderDetails=renderModelDetails;renderModelDetails=function(){
 picksRenderDetails();const panel=$('model-details');if(!selectedRepo||!panel)return;
 const caps=capsFor(selectedRepo),known=['thinking','vision','tools'].some(k=>caps[k]!==undefined&&caps[k]!==null&&caps[k]!=='unknown');
 const box=el('div','caps-box');box.append(el('div','caps-heading',t('capsHeading')));
 const list=el('div','caps-list');
 const value=v=>v===true||v==='supported'?'yes':v===false||v==='unsupported'?'no':'unknown';
 for(const [key,v,hint] of [['capThinking',caps.thinking,caps.thinkingToggle===false?'capThinkingAlways':'capThinkingHint'],['capVision',caps.vision,'capVisionHint'],['capTools',caps.tools,'capToolsHint']]){
  const state_=value(v),item=el('span','cap-item cap-'+state_);item.append(el('strong','',t(key)),el('span','',t({yes:'capYes',no:'capNo',unknown:'capUnknown'}[state_])));if(state_==='yes')item.title=t(hint);list.append(item);
 }
 box.append(list,el('p','quiet caps-source',t(known?'capsSource':'capsNone')));
 const facts=panel.querySelector('.model-facts'),anchor=facts||panel.querySelector('.model-detail-header');anchor?.after(box);
};
