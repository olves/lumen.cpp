'use strict';
// Explore: collections, family shortcuts, metadata-rich rows and quant guidance. Loaded after workspace.js.
Object.assign(translations,{
 forYou:['For you','Sana uygun'],popular:['Popular','Popüler'],coding:['Coding','Kodlama'],compact:['Compact','Küçük'],browseFamily:['Browse by family','Aileye göre göz at'],
 popularHeading:['Most downloaded GGUF','En çok indirilen GGUF'],codingHeading:['Coding models','Kodlama modelleri'],compactHeading:['Under 4.5B parameters','4,5B parametrenin altında'],
 noRepos:['No GGUF models found.','GGUF model bulunamadı.'],hubOffline:['Hugging Face could not be reached. Recommended models are still available.','Hugging Face’e ulaşılamadı. Önerilen modeller kullanılabilir.'],retry:['Try again','Tekrar dene'],
 downloadsLabel:['Downloads','İndirme'],likesLabel:['Likes','Beğeni'],updatedLabel:['Updated','Güncellendi'],bestFit:['Best fit','En uygun'],bestFitHint:['Estimated from file size and this computer’s memory.','Dosya boyutu ve bu bilgisayarın belleğine göre tahmin edildi.'],
 quantGuide:['Smaller files use less memory; larger ones keep more quality.','Küçük dosyalar daha az bellek kullanır; büyükler kaliteyi daha iyi korur.'],estimateHint:['Size estimated for a Q4 file','Q4 dosyası için tahmini boyut'],
 qTiny:['Smallest · noticeable quality loss','En küçük · belirgin kalite kaybı'],qSmall:['Small · lower quality','Küçük · düşük kalite'],qBalanced:['Balanced','Dengeli'],qHigh:['Higher quality','Daha yüksek kalite'],qVeryHigh:['Very high quality','Çok yüksek kalite'],qNear:['Close to original','Orijinale yakın'],qFull:['Full precision','Tam hassasiyet']
});
const hubMeta=new Map(),exploreFamilies=[['qwen','Qwen'],['llama','Llama'],['gemma','Gemma'],['mistral','Mistral'],['phi','Phi'],['deepseek','DeepSeek']];
let exploreView={kind:'recommended',query:''},hubTicket=0,hubRepos=[],detailRepoShown='';
const legacyOpenSettings=openSettings,legacyExploreLocalize=localize,legacyExploreBusy=setBusy;

function locale(){return state.prefs.language==='tr'?'tr-TR':'en-US';}
function compactNumber(n){return new Intl.NumberFormat(locale(),{notation:'compact',maximumFractionDigits:1}).format(n);}
function paramLabel(n){return n?(n<1e10?(n/1e9).toFixed(1):Math.round(n/1e9))+'B':'';}
function estimateQ4(params){return params?params*0.61:0;}
function fitLevel(bytes){if(!state.hardware||!bytes)return null;const need=bytes/1073741824*1.2+1;return need>state.hardware.Available?'over':need<=state.hardware.Vram?'gpu':'mixed';}
function fitDot(bytes){const level=fitLevel(bytes);if(!level)return null;const dot=el('span','fit-dot fit-'+level);dot.title=fit({Bytes:bytes});dot.setAttribute('role','img');dot.setAttribute('aria-label',dot.title);return dot;}
function quantQuality(code){if(/^(?:BF|FP?)(?:16|32)/i.test(code))return t('qFull');const bits=Number(/^I?Q(\d)/i.exec(code)?.[1]);if(!bits)return '';return t(bits<=2?'qTiny':bits===3?'qSmall':bits===4?'qBalanced':bits===5?'qHigh':bits===6?'qVeryHigh':'qNear');}
function bestQuant(files){if(files.length<2)return null;let pool=files.filter(f=>fitLevel(f.Bytes)==='gpu');if(!pool.length)pool=files.filter(f=>fitLevel(f.Bytes)==='mixed');if(!pool.length)return null;return pool.find(f=>quant(f)==='Q4_K_M')||[...pool].reverse().find(f=>/^I?Q[4-6]/.test(quant(f)))||pool[pool.length-1];}
// Draft (multi-token prediction) heads and projectors ship beside the weights but cannot run as a chat model on their own.
function auxiliaryFile(file=''){return /(?:^|\/)(?:mtp[-_.\/]|mmproj)/i.test(file);}
function rememberMeta(item){if(hubMeta.has(item.repo))hubMeta.delete(item.repo);else if(hubMeta.size>=200)hubMeta.delete(hubMeta.keys().next().value);hubMeta.set(item.repo,item);}

function exploreRow(repo,data){
 const row=el('button','repo-row explore-row'+(selectedRepo===repo?' selected':''));row.type='button';row.dataset.repo=repo;row.title=repo;row.disabled=state.busy;
 const owner=repo.split('/')[0],info=el('div');info.append(el('strong','',data.title||repo.split('/').slice(1).join('/').replace(/-GGUF$/i,'')),el('small','',[owner,data.downloads?'↓ '+compactNumber(data.downloads):''].filter(Boolean).join(' · ')));
 const facts=el('span','row-facts'),bytes=data.bytes||estimateQ4(data.params),dot=fitDot(bytes);if(dot)facts.append(dot);
 if(data.params)facts.append(el('span','fact-chip',paramLabel(data.params)));
 if(bytes){const size=el('span','fact-chip',(data.bytes?'':'≈ ')+modelSize(bytes));if(!data.bytes)size.title=t('estimateHint');facts.append(size);}
 if(facts.childNodes.length)info.append(facts);
 row.append(modelLogo(repo,data.title||''),info);if(data.installed)row.append(el('span','format-tag installed-tag','✓'));row.onclick=()=>searchFiles(repo);return row;
}
function setExploreHeading(text,count){$('hub-summary').textContent=text;const tag=document.querySelector('.browser-list-heading .format-tag');if(tag)tag.textContent=count?fmt(count)+' · GGUF':'GGUF';}
function exploreHeading(){const {kind,query}=exploreView;if(kind==='search')return state.prefs.language==='tr'?`“${query}” için sonuçlar`:`Results for “${query}”`;return t({recommended:'recommendedModels',popular:'popularHeading',coding:'codingHeading',compact:'compactHeading'}[kind]);}
function syncExploreControls(){const family=exploreView.kind==='search'?exploreView.query.toLowerCase():'';document.querySelectorAll('[data-collection]').forEach(tab=>tab.setAttribute('aria-pressed',String(tab.dataset.collection===exploreView.kind)));document.querySelectorAll('[data-family]').forEach(chip=>chip.setAttribute('aria-pressed',String(chip.dataset.family===family)));}
function fadeList(){if(motionAllowed())$('discover-list').animate([{opacity:0,transform:'translateY(3px)'},{opacity:1,transform:'none'}],{duration:160,easing:'cubic-bezier(.22,1,.36,1)'});}
function loadInfo(repo){if(!repo||modelInfo.has(repo))return;api.modelInfo(repo).then(info=>{if(modelInfo.size>=24)modelInfo.delete(modelInfo.keys().next().value);modelInfo.set(repo,info);if(selectedRepo===repo)renderModelDetails();}).catch(()=>{modelInfoFailure=repo;if(selectedRepo===repo)renderModelDetails();});}

renderCurated=function(){
 hubTicket++;exploreView={kind:'recommended',query:''};syncExploreControls();const groups=[...new Set(state.models.map(m=>m.Repo))];
 if(!groups.includes(selectedRepo)){selectedRepo=groups[0]||'';selectedFiles=state.models.filter(m=>m.Repo===selectedRepo);}
 $('discover-list').replaceChildren(...groups.map(repo=>{const models=state.models.filter(m=>m.Repo===repo),meta=modelInfo.get(repo)||hubMeta.get(repo);return exploreRow(repo,{title:models[0].Name,bytes:models[0].Bytes,params:meta?.parameters,downloads:meta?.downloads,installed:models.some(m=>m.Installed)});}));
 setExploreHeading(exploreHeading(),groups.length);fadeList();loadInfo(selectedRepo);
};
function drawHubList(){
 const list=$('discover-list');setExploreHeading(exploreHeading(),hubRepos.length);
 if(!hubRepos.length){list.replaceChildren(el('p','library-empty',t('noRepos')));return;}
 list.replaceChildren(...hubRepos.map(item=>exploreRow(item.repo,{params:item.parameters,downloads:item.downloads,installed:state.models.some(m=>m.Repo===item.repo&&m.Installed)})));
}
async function loadCollection(kind,query=''){
 if(kind==='recommended'){$('search-query').value='';return renderCurated();}
 const ticket=++hubTicket;exploreView={kind,query};syncExploreControls();setExploreHeading(exploreHeading(),0);$('discover-list').replaceChildren(el('p','library-empty',t('loading')));
 try{hubRepos=await api.hub(kind,query);if(ticket!==hubTicket)return;hubRepos.forEach(rememberMeta);}
 catch(error){
  if(ticket!==hubTicket)return;hubRepos=[];
  if(kind==='search'){try{const repos=await api.request('search',{query});if(ticket!==hubTicket)return;hubRepos=repos.map(repo=>({repo}));}catch{}}
  if(!hubRepos.length){const box=el('div','hub-offline'),retry=el('button','text-button',t('retry'));retry.onclick=()=>loadCollection(kind,query);box.append(el('p','library-empty',t('hubOffline')),retry);$('discover-list').replaceChildren(box);return;}
 }
 drawHubList();fadeList();if(hubRepos.length&&!hubRepos.some(item=>item.repo===selectedRepo))searchFiles(hubRepos[0].repo);
}

renderModelDetails=function(){
 const panel=$('model-details');panel.replaceChildren();if(!selectedRepo){panel.append(el('div','detail-empty',t('selectRepo')));return;}
 const info=modelInfo.get(selectedRepo)||hubMeta.get(selectedRepo),head=el('div','model-detail-header'),names=el('div'),link=el('button','secondary detail-link',t('openSource')+' ↗');
 names.append(el('h1','',selectedRepo.split('/').slice(1).join('/').replace(/-GGUF$/i,'')),el('p','model-source',selectedRepo));link.onclick=()=>api.openModel(selectedRepo).catch(e=>toast(e.message));head.append(modelLogo(selectedRepo),names,link);panel.append(head);
 const facts=el('div','model-facts');
 for(const [label,value] of [[t('parameters'),paramLabel(info?.parameters)],[t('sourceContext'),info?.context?fmt(info.context):''],[t('architecture'),info?.architecture],[t('downloadsLabel'),info?.downloads?compactNumber(info.downloads):''],[t('likesLabel'),info?.likes?compactNumber(info.likes):''],[t('updatedLabel'),info?.updated?new Date(info.updated).toLocaleDateString(locale(),{year:'numeric',month:'short'}):'']]){if(!value)continue;const item=el('div');item.append(el('span','',label),el('strong','',String(value)));facts.append(item);}
 if(facts.childNodes.length)panel.append(facts);
 const heading=el('div','options-heading');heading.append(el('h2','',t('downloadOptions')));if(selectedFiles.length>1)heading.append(el('span','quiet',t('quantGuide')));panel.append(heading);
 const options=el('div','download-options'),sorted=selectedFiles.filter(f=>!auxiliaryFile(f.File)).sort((a,b)=>a.Bytes-b.Bytes),best=bestQuant(sorted);
 if(state.modelLoading&&!sorted.length)options.append(el('p','quiet options-note',t('loadingOptions')));if(!sorted.length&&!state.modelLoading)options.append(el('p','quiet options-note',t('noResults')));
 for(const model of sorted){
  const current=state.models.find(m=>m.Sha===model.Sha),row=el('div','quant-row'+(model===best?' recommended':'')),name=el('div','quant-name'),line=el('div','quant-line'),sub=el('span','fit-badge'),dot=fitDot(model.Bytes);
  line.append(el('strong','quant-code',quant(model)));if(model===best){const badge=el('span','best-badge',t('bestFit'));badge.title=t('bestFitHint');line.append(badge);}if(current?.Installed)line.append(el('span','device-badge',t('installed')));
  if(dot)sub.append(dot);sub.append(document.createTextNode([quantQuality(quant(model)),fit(model)].filter(Boolean).join(' · ')));name.append(line,sub);
  const button=el('button',current?.Installed?'secondary':'primary',t(current?.Installed?'useModel':'download'));button.disabled=state.busy;
  button.onclick=async()=>{if(state.busy)return;if(current?.Installed){state.chat.Model=current.Name;state.contexts.delete(state.chat.Id);renderPickers();renderContext();setPage('chat');return;}try{state.models=await api.request('register',{model});const item=state.models.find(m=>m.Sha===model.Sha);await download(item.Name);renderModelDetails();}catch(e){toast(e.message);}};
  row.title=model.File;row.append(name,el('span','model-size',modelSize(model.Bytes)),button);options.append(row);
 }
 panel.append(options,el('p','quiet',t('fitEstimate')));
 if(info?.readme){const body=el('div','model-readme');markdown(body,info.readme.replace(/^---[\s\S]*?---\s*/,''));panel.append(el('h2','',t('modelReadme')),body);}
 else if(modelInfoFailure===selectedRepo&&!info)panel.append(el('p','quiet',t('offlineDetails')));
 if(detailRepoShown!==selectedRepo){detailRepoShown=selectedRepo;if(motionAllowed())panel.animate([{opacity:0,transform:'translateY(4px)'},{opacity:1,transform:'none'}],{duration:180,easing:'cubic-bezier(.22,1,.36,1)'});}
};

openSettings=function(section,animate){legacyOpenSettings(section,animate);$('explore-filters').hidden=state.setting!=='explore';};
localize=function(){legacyExploreLocalize();$('family-chips').setAttribute('aria-label',t('browseFamily'));$('collection-tabs').setAttribute('aria-label',t('explore'));if(!state.ready||state.page!=='settings'||state.setting!=='explore')return;if(exploreView.kind==='recommended')renderCurated();else{syncExploreControls();drawHubList();}};
setBusy=function(...args){legacyExploreBusy(...args);document.querySelectorAll('[data-collection],[data-family]').forEach(button=>button.disabled=state.busy);};
$('search-form').onsubmit=event=>{event.preventDefault();if(state.busy)return;const query=$('search-query').value.trim().slice(0,80);if(!query)return loadCollection('recommended');if(/^[\w.-]+\/[\w.-]+$/.test(query)){hubTicket++;exploreView={kind:'search',query};syncExploreControls();return searchFiles(query);}loadCollection('search',query);};
document.querySelectorAll('[data-collection]').forEach(tab=>tab.onclick=()=>{if(state.busy)return;$('search-query').value='';loadCollection(tab.dataset.collection);});
function initializeExplore(){const box=$('family-chips');box.setAttribute('aria-label',t('browseFamily'));box.replaceChildren(...exploreFamilies.map(([family,label])=>{const chip=el('button','family-chip');chip.type='button';chip.dataset.family=family;chip.setAttribute('aria-pressed','false');const img=el('img');img.src=modelLogoFiles[family];img.alt='';img.width=16;img.height=16;img.decoding='async';img.draggable=false;chip.append(img,el('span','',label));chip.onclick=()=>{if(state.busy)return;$('search-query').value=label;loadCollection('search',label);};return chip;}));syncExploreControls();}
window.addEventListener('lumen-ready',initializeExplore,{once:true});if(state.ready)initializeExplore();
