'use strict';
// Web research, agent activity, sources, the browser panel, tool settings and the download dock. Loaded last.
// Activity is painted only from real runtime events (phase/task/plan/note); streamed text reuses the chat's rAF batching.
Object.assign(paths,{globe:'M9 2a7 7 0 100 14A7 7 0 009 2zM2 9h14M9 2c2 2 3 4.5 3 7s-1 5-3 7c-2-2-3-4.5-3-7s1-5 3-7',tasks:'M3 4h2M3 9h2M3 14h2M8 4h7M8 9h7M8 14h7',back:'M11 4L6 9l5 5',forward:'M7 4l5 5-5 5',reload:'M14 9a5 5 0 11-1.5-3.5M14 3v3h-3',external:'M10 3h5v5M15 3L8 10M13 11v4H3V5h4'});
for(const node of document.querySelectorAll('[data-icon="globe"],[data-icon="tasks"],[data-icon="back"],[data-icon="forward"],[data-icon="reload"],[data-icon="external"]'))node.replaceChildren(icon(node.dataset.icon));
Object.assign(translations,{
 researchWeb:['Research on the web','Web’de araştır'],researchWebHint:['Search, read sources and combine findings','Ara, kaynakları oku ve bulguları birleştir'],researchChip:['Web research','Web araştırması'],removeResearch:['Turn off web research','Web araştırmasını kapat'],
 webConsentTitle:['Turn on web research?','Web araştırması açılsın mı?'],webConsentText:['Search queries will be sent to {provider}, and pages will be fetched from their own sites. Your conversation and files stay on this computer.','Arama sorguları {provider} hizmetine gönderilir, sayfalar kendi sitelerinden alınır. Sohbetin ve dosyaların bu bilgisayarda kalır.'],turnOnWeb:['Turn on web search','Web aramasını aç'],webQueriesNote:['queries go to {provider}','sorgular {provider} hizmetine gider'],
 toolsLabel:['TOOLS','ARAÇLAR'],agentsTitle:['Agents','Ajanlar'],searchTitle:['Search','Arama'],browserTitle:['Browser','Tarayıcı'],agentsIntro:['Split research into small tasks, then combine the results.','Araştırmayı küçük görevlere böl, sonra sonuçları birleştir.'],
 subtasksSetting:['Subtasks','Alt görevler'],subtasksHint:['The model may split a research request into separate tasks. They run one after another on this machine.','Model bir araştırma isteğini ayrı görevlere bölebilir. Görevler bu bilgisayarda sırayla çalışır.'],autoTools:['Use tools automatically','Araçları otomatik kullan'],autoToolsHint:['Messages that ask for current or sourced information can use web search without choosing Research. Requires web search.','Güncel veya kaynaklı bilgi isteyen mesajlar, Araştır seçilmeden web aramasını kullanabilir. Web araması açık olmalı.'],
 maxSubtasks:['Maximum subtasks','En fazla alt görev'],maxSubtasksHint:['Per research request. Subtasks cannot create more subtasks.','Araştırma isteği başına. Alt görevler yeni alt görev oluşturamaz.'],maxToolCalls:['Tool calls per task','Görev başına araç çağrısı'],maxToolCallsHint:['Searches and page reads a task may use before it must finish.','Bir görevin bitmeden önce kullanabileceği arama ve sayfa okuma sayısı.'],taskTime:['Time per task','Görev başına süre'],taskTimeHint:['A task that runs longer is stopped; other results are kept.','Daha uzun süren görev durdurulur; diğer sonuçlar korunur.'],
 searchIntro:['Off by default. Chat works offline either way.','Varsayılan olarak kapalı. Sohbet her durumda çevrimdışı çalışır.'],webSearch:['Web search and page reading','Web araması ve sayfa okuma'],searchProvider:['Provider','Sağlayıcı'],apiKey:['API key','API anahtarı'],saveKey:['Save key','Anahtarı kaydet'],removeKey:['Remove','Kaldır'],searxngAddress:['SearXNG address','SearXNG adresi'],searxngHint:['Your instance must allow JSON results. A self-hosted address on this computer is allowed here.','Sunucun JSON sonuçlarına izin vermeli. Bu bilgisayardaki kendi sunucun da kullanılabilir.'],saveAddress:['Save','Kaydet'],resultCount:['Results per search','Arama başına sonuç'],resultCountHint:['Fewer results keep prompts shorter.','Daha az sonuç istemleri kısa tutar.'],searchLanguage:['Search language','Arama dili'],searchLanguageHint:['Auto follows the interface language.','Otomatik, arayüz dilini izler.'],
 browserIntro:['Read pages for research and open sources inside Lumen.','Araştırma için sayfaları oku ve kaynakları Lumen içinde aç.'],renderPages:['Render JavaScript pages','JavaScript sayfalarını işle'],renderPagesHint:['Used only when the light reader finds almost no text. One hidden, sandboxed page at a time.','Yalnızca hafif okuyucu neredeyse hiç metin bulamazsa kullanılır. Aynı anda tek bir gizli, yalıtılmış sayfa.'],browserPanelSetting:['Open sources in Lumen','Kaynakları Lumen’de aç'],browserPanelHint:['Otherwise links open in your default browser.','Aksi halde bağlantılar varsayılan tarayıcında açılır.'],browserData:['Browsing data','Tarama verileri'],browserDataHint:['Cookies, cache and storage from pages opened in Lumen. Kept separate from Lumen itself.','Lumen’de açılan sayfaların çerezleri, önbelleği ve depolaması. Lumen’in kendi verilerinden ayrı tutulur.'],clearBrowserData:['Clear browsing data','Tarama verilerini temizle'],browserSafety:['Pages cannot reach Lumen’s files or settings. Downloads, pop-ups, camera, microphone and other permissions are blocked, as are local and private network addresses. Lumen never signs in, submits forms or posts for you.','Sayfalar Lumen’in dosyalarına veya ayarlarına erişemez. İndirmeler, açılır pencereler, kamera, mikrofon ve diğer izinler ile yerel ve özel ağ adresleri engellenir. Lumen senin yerine oturum açmaz, form göndermez veya paylaşım yapmaz.'],tryAgain:['Try again','Tekrar dene'],
 toolsReady:['Tool runtime ready. Model steps run one at a time on this computer.','Araç çalışma ortamı hazır. Model adımları bu bilgisayarda sırayla çalışır.'],toolsUnavailable:['Tool runtime unavailable, so research cannot run. Normal chat still works.','Araç çalışma ortamı kullanılamıyor; araştırma çalışamaz. Normal sohbet çalışmaya devam eder.'],
 searchPrivacy:['Queries are sent to {provider}; pages are fetched from their own sites. Nothing else leaves this computer.','Sorgular {provider} hizmetine gönderilir; sayfalar kendi sitelerinden alınır. Bunun dışında hiçbir şey bilgisayarından çıkmaz.'],
 hint_duckduckgo:['General web search with no account or key. Uses DuckDuckGo’s public results page, which may occasionally ask for a pause under heavy use; Tavily or Brave are steadier.','Hesap veya anahtar gerektirmeyen genel web araması. DuckDuckGo’nun herkese açık sonuç sayfasını kullanır; yoğun kullanımda ara sıra beklemeni isteyebilir. Tavily veya Brave daha istikrarlıdır.'],hint_wikipedia:['Free and needs no key. Finds Wikipedia articles only.','Ücretsizdir, anahtar gerekmez. Yalnızca Wikipedia maddelerini bulur.'],hint_brave:['General web search. Needs a Brave Search API key.','Genel web araması. Brave Search API anahtarı gerekir.'],hint_searxng:['Your own or a trusted SearXNG instance with JSON enabled.','JSON çıktısı açık, kendi veya güvendiğin bir SearXNG sunucusu.'],
 keyStored:['Stored encrypted on this computer.','Bu bilgisayarda şifreli saklanıyor.'],keyMissing:['No key saved. {provider} will not run until you add one.','Kayıtlı anahtar yok. Anahtar eklenene kadar {provider} çalışmaz.'],hint_tavily:['General web search built for AI tools. Needs a Tavily API key (the free plan includes 1,000 searches a month at the time of writing).','Yapay zekâ araçları için genel web araması. Tavily API anahtarı gerekir (yazıldığı tarihte ücretsiz plan ayda 1.000 arama içeriyor).'],scopeWikipedia:['Wikipedia articles only','yalnızca Wikipedia maddeleri'],scopeWeb:['general web','genel web'],keySaved:['Key saved','Anahtar kaydedildi'],keyRemoved:['Key removed','Anahtar kaldırıldı'],browserCleared:['Browsing data cleared','Tarama verileri temizlendi'],addressSaved:['Address saved','Adres kaydedildi'],
 actPlanning:['Planning the research','Araştırma planlanıyor'],actSearching:['Searching the web','Web’de aranıyor'],actReading:['Reading a source','Kaynak okunuyor'],actTask:['Running a subtask','Alt görev yürütülüyor'],actSynth:['Combining results','Sonuçlar birleştiriliyor'],actLoading:['Loading the model','Model yükleniyor'],actDone:['Researched','Araştırıldı'],actStopped:['Research stopped','Araştırma durduruldu'],actDirect:['Answered without web search','Web araması yapılmadan yanıtlandı'],actWaiting:['Starting','Başlıyor'],
 taskOf:['task {n} of {total}','görev {n}/{total}'],tasksCount:['{n} tasks','{n} görev'],oneTask:['1 task','1 görev'],sourcesRead:['{n} sources read','{n} kaynak okundu'],oneSourceRead:['1 source read','1 kaynak okundu'],sequentialNote:['Tasks ran one at a time on this computer with {model}.','Görevler bu bilgisayarda {model} ile sırayla çalıştı.'],
 st_queued:['Waiting','Bekliyor'],st_running:['Running','Çalışıyor'],st_done:['Done','Tamamlandı'],st_failed:['Failed','Başarısız'],st_cancelled:['Stopped','Durduruldu'],st_skipped:['Not run','Çalıştırılmadı'],
 opSearch:['Searched “{q}”','“{q}” arandı'],opResults:['{n} results','{n} sonuç'],opRead:['Read {title}','Okundu: {title}'],opRendered:['rendered page','işlenmiş sayfa'],opInvalid:['Rejected an invalid tool call','Geçersiz bir araç çağrısı reddedildi'],opFailed:['failed','başarısız'],
 sourcesTitle:['Sources','Kaynaklar'],sourceRead:['read','okundu'],sourceSnippet:['snippet only','yalnızca özet'],sourceUpdated:['updated','güncellendi'],openExternal:['Open in your browser','Tarayıcında aç'],
 noteWebOff:['Web search is off, so this was answered without tools.','Web araması kapalı olduğu için araç kullanılmadan yanıtlandı.'],notePlanFallback:['The model could not plan in the expected format, so one task was used.','Model planı beklenen biçimde üretemedi; tek görev kullanıldı.'],
 researchStopped:['Research stopped before an answer.','Araştırma yanıt üretilmeden durduruldu.'],webOffToast:['Turn on web search in Settings → Search.','Ayarlar → Arama’dan web aramasını aç.'],
 dl_downloading:['Downloading','İndiriliyor'],dl_paused:['Paused','Duraklatıldı'],dl_verifying:['Verifying','Doğrulanıyor'],dl_completed:['Ready','Hazır'],dl_failed:['Download failed','İndirme başarısız'],dl_cancelled:['Cancelled','İptal edildi'],dlPause:['Pause','Duraklat'],dlResume:['Resume','Devam et'],dlRetry:['Retry','Yeniden dene'],dlLeft:['{t} left','{t} kaldı'],dlConnections:['{n} connections','{n} bağlantı'],dlOneConnection:['1 connection','1 bağlantı'],dlChecking:['Checking SHA-256 of {size}','{size} için SHA-256 denetleniyor'],
 browserBlocked:['This address is blocked','Bu adres engellendi'],browserBlockedText:['Local and private network addresses cannot be opened from Lumen.','Yerel ve özel ağ adresleri Lumen’den açılamaz.'],browserFailed:['The page could not be loaded','Sayfa yüklenemedi'],webOnLabel:['Local · web on','Yerel · web açık']
});
const tf=(key,vars={})=>t(key).replace(/\{(\w+)\}/g,(_,name)=>vars[name]??'');
// Electron prefixes errors thrown in the main process; show only the message written for people.
const cleanError=error=>String(error?.message||error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
let toolsConfig=null,researchMode=false,agentRun=null,browserState={open:false},boundsFrame=0,dockState=null,dockFrame=0,dockTimer=null;
const listen=(channel,fn)=>api.onChannel?api.onChannel(channel,fn):()=>{};

// ---------- Settings ----------
async function loadToolsConfig(){try{toolsConfig=await api.tools('get');}catch(e){toolsConfig=null;}paintToolSettings();renderToolChips();paintLocalLabel();return toolsConfig;}
async function updateTools(patch){try{toolsConfig=await api.tools('update',patch);}catch(e){toast(cleanError(e));}paintToolSettings();renderToolChips();paintLocalLabel();}
function providerName(){return toolsConfig?.providers?.[toolsConfig.search.provider]?.label||'Wikipedia';}
function paintToolSettings(){
 const c=toolsConfig;if(!c)return;
 $('tools-engine-status').textContent=t(c.hostReady?'toolsReady':'toolsUnavailable');$('tools-engine-status').classList.toggle('warning',!c.hostReady);
 $('agent-enabled').checked=c.agent.enabled;$('agent-auto').checked=c.agent.auto;$('agent-max-subtasks').value=String(c.agent.maxSubtasks);$('agent-max-tools').value=String([2,4,6,8].includes(c.agent.maxToolCalls)?c.agent.maxToolCalls:4);$('agent-task-seconds').value=String(c.agent.taskSeconds);
 $('agent-max-subtasks').disabled=!c.agent.enabled;
 $('search-enabled').checked=c.search.enabled;$('search-provider').value=c.search.provider;$('search-results').value=String([3,5,8].includes(c.search.results)?c.search.results:5);$('search-language').value=c.search.language;
 $('search-privacy').textContent=tf('searchPrivacy',{provider:providerName()});$('search-provider-hint').textContent=t('hint_'+c.search.provider);
 $('search-key-row').hidden=!c.providers?.[c.search.provider]?.needsKey;$('search-endpoint-row').hidden=c.search.provider!=='searxng';
 const stored=!!c.search.keys?.[c.search.provider];$('search-key-status').textContent=stored?t('keyStored'):tf('keyMissing',{provider:providerName()});$('search-key-clear').hidden=!stored;$('search-key').placeholder=stored?'••••••••••••':'';
 if(document.activeElement!==$('search-endpoint'))$('search-endpoint').value=c.search.endpoint||'';
 $('browser-render').checked=c.browser.render;$('browser-panel-setting').checked=c.browser.panel;
}
function paintLocalLabel(){const label=document.querySelector('.local-label [data-i18n="private"]');if(label)label.textContent=t(toolsConfig?.search.enabled?'webOnLabel':'private');}
$('agent-enabled').onchange=()=>updateTools({agent:{enabled:$('agent-enabled').checked}});$('agent-auto').onchange=()=>updateTools({agent:{auto:$('agent-auto').checked}});
$('agent-max-subtasks').onchange=()=>updateTools({agent:{maxSubtasks:Number($('agent-max-subtasks').value)}});$('agent-max-tools').onchange=()=>updateTools({agent:{maxToolCalls:Number($('agent-max-tools').value)}});$('agent-task-seconds').onchange=()=>updateTools({agent:{taskSeconds:Number($('agent-task-seconds').value)}});
$('search-enabled').onchange=()=>{if(!$('search-enabled').checked)researchMode=false;updateTools({search:{enabled:$('search-enabled').checked}});};
$('search-provider').onchange=()=>updateTools({search:{provider:$('search-provider').value}});$('search-results').onchange=()=>updateTools({search:{results:Number($('search-results').value)}});$('search-language').onchange=()=>updateTools({search:{language:$('search-language').value}});
$('search-key-form').onsubmit=async event=>{event.preventDefault();const key=$('search-key').value;$('search-key').value='';try{toolsConfig=await api.tools('set-key',{provider:toolsConfig.search.provider,key});toast(t('keySaved'));}catch(e){toast(cleanError(e));}paintToolSettings();};
$('search-key-clear').onclick=async()=>{try{toolsConfig=await api.tools('clear-key',{provider:toolsConfig.search.provider});toast(t('keyRemoved'));}catch(e){toast(cleanError(e));}paintToolSettings();};
$('search-endpoint-form').onsubmit=async event=>{event.preventDefault();await updateTools({search:{endpoint:$('search-endpoint').value.trim()}});if(toolsConfig?.search.endpoint||!$('search-endpoint').value.trim())toast(t('addressSaved'));};
$('browser-render').onchange=()=>updateTools({browser:{render:$('browser-render').checked}});$('browser-panel-setting').onchange=()=>updateTools({browser:{panel:$('browser-panel-setting').checked}});
$('browser-clear').onclick=async()=>{try{await api.tools('clear-browser');closeBrowser();toast(t('browserCleared'));}catch(e){toast(cleanError(e));}};
Object.assign(sectionNames,{agents:'agentsTitle',search:'searchTitle',browser:'browserTitle'});
const toolsOpenSettings=openSettings;openSettings=function(section,animate){toolsOpenSettings(section,animate);$('agents-panel').hidden=state.setting!=='agents';$('search-panel').hidden=state.setting!=='search';$('browser-settings-panel').hidden=state.setting!=='browser';if(['agents','search','browser'].includes(state.setting))loadToolsConfig();syncBrowserBounds();};

// ---------- Composer: research mode ----------
function renderToolChips(){
 const box=$('tool-chips');box.replaceChildren();const on=researchMode&&toolsConfig?.search.enabled;box.hidden=!on;if(!on)return;
 const chip=el('div','skill-chip tool-chip'),name=el('span','skill-chip-name',t('researchChip')),note=el('small','tool-chip-note',(toolsConfig?.providers?.[toolsConfig.search.provider]?.scope==='wikipedia'?t('scopeWikipedia')+' · ':'')+tf('webQueriesNote',{provider:providerName()})),remove=el('button','skill-chip-remove','×');
 remove.type='button';remove.title=t('removeResearch');remove.setAttribute('aria-label',t('removeResearch'));remove.disabled=state.busy;remove.onclick=()=>{researchMode=false;renderToolChips();$('prompt').focus();};
 chip.append(icon('globe'),name,note,remove);box.append(chip);
}
function showConsent(){$('web-consent-text').textContent=tf('webConsentText',{provider:providerName()});$('web-consent').hidden=false;if(motionAllowed())$('web-consent').animate([{opacity:0,transform:'translateY(4px)'},{opacity:1,transform:'none'}],{duration:160,easing:'cubic-bezier(.22,1,.36,1)'});$('web-consent-allow').focus();}
$('use-research').onclick=async()=>{closeComposerMenus();if(state.busy)return;if(!toolsConfig)await loadToolsConfig();if(!toolsConfig?.hostReady){toast(t('toolsUnavailable'));return;}if(!toolsConfig.search.enabled){showConsent();return;}researchMode=!researchMode;renderToolChips();$('prompt').focus();};
$('web-consent-allow').onclick=async()=>{$('web-consent').hidden=true;await updateTools({search:{enabled:true}});researchMode=!!toolsConfig?.search.enabled;renderToolChips();$('prompt').focus();};
$('web-consent-cancel').onclick=()=>{$('web-consent').hidden=true;$('prompt').focus();};
$('web-consent').addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();$('web-consent').hidden=true;$('prompt').focus();}});

// ---------- Activity ----------
function statusLabel(status){return t('st_'+(status||'queued'));}
function opText(op){if(op.kind==='invalid')return t('opInvalid');if(op.kind==='search')return tf('opSearch',{q:op.label})+(op.status==='done'?' · '+tf('opResults',{n:op.detail||0}):op.status==='failed'?' · '+t('opFailed'):'');return tf('opRead',{title:op.label})+(op.detail==='rendered'?' · '+t('opRendered'):'')+(op.status==='failed'?' · '+t('opFailed')+(op.detail?': '+op.detail:''):'');}
function activityView(record=null){
 const root=el('div','activity'),summary=el('button','activity-summary'),details=el('div','activity-details');summary.type='button';summary.setAttribute('aria-expanded','false');details.hidden=true;
 const dot=el('span','activity-dot'),label=el('span','activity-label'),meta=el('span','activity-meta'),chevron=el('span','activity-chevron','⌄');summary.append(dot,label,meta,chevron);
 summary.onclick=()=>{details.hidden=!details.hidden;summary.setAttribute('aria-expanded',String(!details.hidden));root.classList.toggle('expanded',!details.hidden);if(!details.hidden&&motionAllowed())details.animate([{opacity:0,transform:'translateY(-3px)'},{opacity:1,transform:'none'}],{duration:160,easing:'cubic-bezier(.22,1,.36,1)'});};
 root.append(summary,details);
 const view={root,label,meta,details,frame:0,data:{phase:'start',tasks:[],notes:[],model:record?.tasks?.[0]?.model||state.chat?.Model||'',provider:record?.provider||'',ended:!!record,cancelled:false,route:record?.route||null,sources:record?.sources||[]}};
 if(record){view.data.tasks=record.tasks||[];root.classList.add('finished');}
 paintActivity(view);return view;
}
function scheduleActivity(view){if(view.frame)return;view.frame=requestAnimationFrame(()=>{view.frame=0;paintActivity(view);});}
function paintActivity(view){
 const d=view.data,tasks=d.tasks,running=tasks.find(task=>task.status==='running'),doneCount=tasks.filter(task=>['done','failed','cancelled','skipped'].includes(task.status)).length;
 let text;const lastOp=running?.ops?.[running.ops.length-1];
 if(d.ended){const readCount=(d.sources||[]).filter(s=>s.read).length;text=d.cancelled?t('actStopped'):d.route==='direct'?t('actDirect'):t('actDone');view.meta.textContent=d.route==='direct'||d.cancelled&&!tasks.length?'':[tasks.length===1?t('oneTask'):tf('tasksCount',{n:tasks.length}),readCount?(readCount===1?t('oneSourceRead'):tf('sourcesRead',{n:readCount})):''].filter(Boolean).join(' · ');}
 else{
  if(d.phase==='loading')text=t('actLoading');
  else if(d.phase==='planning')text=t('actPlanning');
  else if(d.phase==='synthesizing')text=t('actSynth');
  else if(running&&lastOp?.status==='running')text=lastOp.kind==='search'?t('actSearching')+' · “'+short(lastOp.label,48)+'”':t('actReading')+' · '+short(siteName(lastOp.label),40);
  else if(running)text=t('actTask')+' · '+running.title;
  else text=t('actWaiting');
  view.meta.textContent=tasks.length&&d.phase!=='planning'?tf('taskOf',{n:Math.min(tasks.length,doneCount+(running?1:0))||1,total:tasks.length}):'';
 }
 view.label.textContent=text;view.root.dataset.state=d.ended?(d.cancelled?'stopped':'done'):'running';
 const list=el('ol','activity-tasks');
 for(const task of tasks){
  const item=el('li','activity-task'),head=el('div','task-head');item.dataset.status=task.status;
  head.append(el('span','task-status-dot'),el('strong','',task.title),el('span','task-model',task.model||d.model),el('span','task-status',statusLabel(task.status)));item.append(head);
  if(task.ops?.length){const ops=el('ul','task-ops');for(const op of task.ops){const li=el('li','',opText(op));li.dataset.status=op.status;ops.append(li);}item.append(ops);}
  if(task.result)item.append(el('p','task-result',task.result));if(task.error)item.append(el('p','task-error',task.error));
  list.append(item);
 }
 const children=[];if(tasks.length)children.push(list,el('p','activity-note',tf('sequentialNote',{model:d.model})));
 for(const note of d.notes)children.push(el('p','activity-note warning',t(note==='web-off'?'noteWebOff':'notePlanFallback')));
 view.details.replaceChildren(...children);view.root.querySelector('.activity-summary').disabled=!children.length;
}
function short(text,n){text=String(text||'');return text.length>n?text.slice(0,n-1)+'…':text;}
function siteName(url){try{return new URL(url).hostname.replace(/^www\./,'');}catch{return url;}}
function sourcesView(sources){
 const wrap=el('div','sources'),list=el('ol','source-list');wrap.append(el('div','sources-heading',t('sourcesTitle')),list);
 for(const s of sources){
  const item=el('li','source-item'),open=el('button','source-open'),external=el('button','icon-button source-external');open.type='button';external.type='button';
  const meta=[s.site,s.published?(s.dateKind==='updated'?t('sourceUpdated')+' ':'')+new Date(s.published).toLocaleDateString(state.prefs.language==='tr'?'tr-TR':'en-US',{year:'numeric',month:'short',day:'numeric'}):'',t(s.read?'sourceRead':'sourceSnippet')].filter(Boolean).join(' · ');
  open.append(el('span','source-id',s.id),el('span','source-title',s.title),el('span','source-meta',meta));open.title=s.url;open.onclick=()=>openSource(s.url);
  external.append(icon('external'));external.title=t('openExternal');external.setAttribute('aria-label',t('openExternal')+': '+s.title);external.onclick=()=>api.browser('external',{url:s.url}).catch(e=>toast(cleanError(e)));
  item.append(open,external);list.append(item);
 }
 return wrap;
}
// Turn [S#] markers that match a real source into small buttons; unknown markers were already removed by the runtime.
function linkCitations(body,sources){
 const byId=new Map(sources.map(s=>[s.id,s]));if(!byId.size)return;
 const walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())if(/\[S\d+\]/.test(walker.currentNode.data)&&!walker.currentNode.parentElement.closest('pre,code'))nodes.push(walker.currentNode);
 for(const node of nodes){const fragment=document.createDocumentFragment();let last=0;for(const match of node.data.matchAll(/\[(S\d+)\]/g)){const source=byId.get(match[1]);if(!source)continue;fragment.append(node.data.slice(last,match.index));const cite=el('button','citation',match[1].slice(1));cite.type='button';cite.title=source.title+' — '+source.site;cite.setAttribute('aria-label',t('sourcesTitle')+' '+match[1]+': '+source.title);cite.onclick=()=>openSource(source.url);fragment.append(cite);last=match.index+match[0].length;}fragment.append(node.data.slice(last));node.replaceWith(fragment);}
}
const toolsMessageNode=messageNode;messageNode=function(message,index,stream=false){
 const result=toolsMessageNode(message,index,stream);
 if(message.Role==='assistant'&&message.Activity){const view=activityView(message.Activity);result.node.insertBefore(view.root,result.body);const sources=message.Activity.sources||[];if(sources.length){linkCitations(result.body,sources);result.body.after(sourcesView(sources));}}
 return result;
};

// ---------- Sending ----------
const toolsSend=send;
send=async function(){
 if(state.busy){if(state.operation==='agent'&&agentRun){api.agent('cancel',{runId:agentRun.runId}).catch(()=>{});return;}return toolsSend();}
 if(typeof photosAdding!=='undefined'&&photosAdding)return;
 const text=composeText();if(!text||!state.ready)return;
 const chosen=state.models.find(m=>m.Name===$('model-picker').value);
 if(chosen&&!chosen.Installed&&!await download(chosen.Name))return;
 let route={route:'chat'};
 if(researchMode||toolsConfig?.search.enabled){try{route=await api.agent('route',{prompt:text,mode:researchMode?'research':'auto',model:$('model-picker').value});}catch{}}
 if(route.route!=='agent'){if(researchMode){toast(t(route.reason==='unavailable'?'toolsUnavailable':'webOffToast'));return;}return toolsSend();}
 return sendWithAgent(text);
};
async function sendWithAgent(text,options={}){
 if(text.length>90000){toast(state.prefs.language==='tr'?'Mesaj ve dosyalar toplamda 90.000 karakteri aşamaz.':'The message and files must total at most 90,000 characters.');return;}
 const chat=state.chat;chat.Model=$('model-picker').value;if(!chat.Messages.length&&!chat.CustomTitle)chat.Title=text.slice(0,56).replace(/\s+/g,' ');
 const photos=typeof draftPhotos!=='undefined'&&draftPhotos.length?{Images:draftPhotos.map(photo=>({...photo})),DisplayText:$('prompt').value.trim()}:{};
 if(!options.regenerate){chat.Messages.push({Role:'user',Content:text,Interrupted:false,...photos});upsert(chat);$('prompt').value='';draftFiles=[];if(typeof draftPhotos!=='undefined')draftPhotos=[];renderAttachments();resizePrompt();}
 setBusy(true,'agent');renderMessages();
 const streaming=messageNode({Role:'assistant',Content:''},chat.Messages.length,true);streamBody=streaming.body;streamNode=document.createTextNode('');streamBody.append(streamNode);
 const view=activityView();streaming.node.insertBefore(view.root,streaming.body);$('messages').append(streaming.node);streamText='';pendingChunk='';$('chat-scroll').scrollTop=$('chat-scroll').scrollHeight;
 const runId=crypto.randomUUID(),chatId=chat.Id;agentRun={runId,view,chatId};
 let result=null,failure=null;
 try{result=await api.agent('run',{runId,chat,prompt:text,mode:options.mode||(researchMode?'research':'auto'),research:options.mode==='project'&&researchMode&&!!toolsConfig?.search.enabled,contextSize:state.prefs.contextSize});}catch(error){failure=error;}
 if(flushId)cancelAnimationFrame(flushId);flushStream();agentRun=null;
 try{
  if(state.chat?.Id===chatId){
   if(result){
    const interrupted=!!result.cancelled,content=interrupted?(streamText.trim()||t('researchStopped')):result.content;
    chat.Messages.push({Role:'assistant',Content:content,Interrupted:interrupted});
    const saved=await api.request('save',{chat});const index=saved.Messages.length-1;
    const record={route:result.route,provider:result.provider,sources:result.sources||[],tasks:result.tasks||[]};
    const thought=typeof liveReasoning==='function'?liveReasoning(result.reasoning):null;
    if(record.tasks.length||record.sources.length||record.route==='direct'||thought)saved.Messages[index].Activity=await api.agent('record',{chatId,index,record,...(thought?{reasoning:thought}:{})});
    if(thought)saved.Messages[index].Reasoning=thought;
    if(result.generated?.length){try{const g=await api.images('attach',{chatId,index,items:result.generated});if(g)saved.Messages[index].Generated=g;}catch{}}
    upsert(saved);
    if(result.usage)state.contexts.set(chatId,{Prompt:result.usage.prompt,Generated:result.usage.generated,Capacity:result.usage.capacity,ModelCapacity:0,OmittedMessages:0});
   }else{upsert(await api.request('save',{chat}));if(failure)toast(cleanError(failure));}
  }
 }catch(error){toast(cleanError(error));}
 finally{streamBody=null;streamNode=null;setBusy(false);renderMessages();renderContext();state.models=await api.request('models').catch(()=>state.models);renderPickers();}
}
listen('agent-event',event=>{
 const run=agentRun;if(!run||(event.runId&&event.runId!==run.runId))return;const d=run.view.data;
 if(event.type==='chunk'){pendingChunk+=event.text;if(!flushId)flushId=requestAnimationFrame(flushStream);if(d.phase!=='synthesizing'){d.phase='synthesizing';scheduleActivity(run.view);}return;}
 if(event.type==='start'){d.model=event.model;d.provider=event.provider;}
 else if(event.type==='phase')d.phase=event.phase;
 else if(event.type==='progress'){if(/Engine|Model|Loading|GPU|CPU/i.test(event.label||''))d.phase=d.phase==='start'?'loading':d.phase;}
 else if(event.type==='plan'){d.route=event.route;d.tasks=event.tasks;}
 else if(event.type==='task'){const i=d.tasks.findIndex(task=>task.id===event.task.id);if(i>=0)d.tasks[i]=event.task;else d.tasks.push(event.task);}
 else if(event.type==='note'){if(!d.notes.includes(event.code))d.notes.push(event.code);}
 else if(event.type==='end'){d.ended=true;}
 scheduleActivity(run.view);
});
const toolsSetBusy=setBusy;setBusy=function(busy,operation){
 toolsSetBusy(busy,operation);
 if(busy&&operation==='agent'){$('send').disabled=false;$('send').classList.add('stopping');$('send').replaceChildren(icon('stop'));$('send').setAttribute('aria-label',t('stop'));}
 $('use-research').disabled=busy;renderToolChips();
};

// ---------- Browser panel ----------
function openSource(url){if(toolsConfig&&!toolsConfig.browser.panel){api.browser('external',{url}).catch(e=>toast(cleanError(e)));return;}openBrowser(url);}
async function openBrowser(url){
 const panel=$('browser-panel'),wasHidden=panel.hidden;panel.hidden=false;document.body.classList.add('browser-open');
 if(wasHidden&&motionAllowed())panel.animate([{opacity:0,transform:'translateX(10px)'},{opacity:1,transform:'none'}],{duration:200,easing:'cubic-bezier(.22,1,.36,1)'}).finished.then(syncBrowserBounds,()=>{});
 try{browserState=await api.browser('open',{url});}catch(e){const message=cleanError(e);browserState={open:true,url,error:{blocked:/blocked/i.test(message),description:message}};}
 paintBrowser();syncBrowserBounds();
}
function closeBrowser(){if($('browser-panel').hidden)return;$('browser-panel').hidden=true;document.body.classList.remove('browser-open');api.browser('close').catch(()=>{});browserState={open:false};}
function syncBrowserBounds(){
 if(boundsFrame)return;
 boundsFrame=requestAnimationFrame(()=>{boundsFrame=0;const panel=$('browser-panel');const visible=!panel.hidden&&state.page==='chat'&&!document.querySelector('dialog[open]')&&$('welcome').hidden&&!browserState.error;const r=$('browser-viewport').getBoundingClientRect();api.browser('bounds',{rect:visible?{x:r.left,y:r.top,width:r.width,height:r.height}:null}).catch(()=>{});});
}
function paintBrowser(){
 const s=browserState;if(document.activeElement!==$('browser-address'))$('browser-address').value=s.url||'';
 $('browser-back').disabled=!s.canGoBack;$('browser-forward').disabled=!s.canGoForward;
 $('browser-reload').replaceChildren(s.loading?icon('stop'):icon('reload'));$('browser-reload').setAttribute('aria-label',s.loading?t('stop'):'Reload');
 const bar=$('browser-progress');if(s.loading&&bar.hidden){bar.hidden=false;bar.classList.remove('done');void bar.offsetWidth;bar.classList.add('loading');}else if(!s.loading&&!bar.hidden){bar.classList.add('done');setTimeout(()=>{if(!browserState.loading){bar.hidden=true;bar.classList.remove('loading','done');}},220);}
 const message=$('browser-message');message.hidden=!s.error;if(s.error){$('browser-message-title').textContent=t(s.error.blocked?'browserBlocked':'browserFailed');$('browser-message-text').textContent=s.error.blocked?t('browserBlockedText'):(s.error.description||'')+(s.error.url?' · '+s.error.url:'');}
 $('browser-panel').setAttribute('aria-busy',String(!!s.loading));
}
listen('browser-event',next=>{browserState=next;if(!next.open&&!$('browser-panel').hidden){$('browser-panel').hidden=true;document.body.classList.remove('browser-open');}paintBrowser();syncBrowserBounds();});
$('browser-form').onsubmit=event=>{event.preventDefault();openBrowser($('browser-address').value);};
$('browser-back').onclick=()=>api.browser('back');$('browser-forward').onclick=()=>api.browser('forward');$('browser-reload').onclick=()=>api.browser(browserState.loading?'stop':'reload');
$('browser-external').onclick=()=>{if(browserState.url)api.browser('external',{url:browserState.url}).catch(e=>toast(cleanError(e)));};
$('browser-close').onclick=closeBrowser;$('browser-retry').onclick=()=>{browserState={...browserState,error:null};paintBrowser();api.browser('reload');syncBrowserBounds();};
$('browser-panel').addEventListener('keydown',event=>{if(event.key==='Escape'&&document.activeElement!==$('browser-address')){event.stopPropagation();closeBrowser();$('prompt').focus();}});
new ResizeObserver(syncBrowserBounds).observe($('browser-viewport'));window.addEventListener('resize',syncBrowserBounds);
const dialogWatcher=new MutationObserver(syncBrowserBounds);document.querySelectorAll('dialog').forEach(dialog=>dialogWatcher.observe(dialog,{attributes:true,attributeFilter:['open']}));dialogWatcher.observe($('welcome'),{attributes:true,attributeFilter:['hidden']});
const toolsSetPage=setPage;setPage=function(page,animate){toolsSetPage(page,animate);syncBrowserBounds();};

// ---------- Downloads ----------
function duration(seconds){if(seconds==null)return '';if(seconds<60)return seconds+' s';if(seconds<3600)return Math.floor(seconds/60)+' min '+String(seconds%60).padStart(2,'0')+' s';return Math.floor(seconds/3600)+' h '+Math.floor(seconds%3600/60)+' min';}
download=async function(name){
 try{const result=await api.downloads('start',{name});return result?.phase==='completed';}
 catch(error){if(!/Cancelled/.test(error.message))toast(cleanError(error));return false;}
 finally{state.models=await api.request('models').catch(()=>state.models);renderModels();renderPickers();if(typeof renderModelDetails==='function')renderModelDetails();}
};
// The header pill always shows the download; the detail card opens below the header (never over the composer).
let dockOpen=false,dockId=null;
function setDockOpen(open){
 const dock=$('download-dock');dockOpen=open;$('download-pill').setAttribute('aria-expanded',String(open));
 if(!open){dock.hidden=true;return;}
 const header=document.querySelector('.workspace-header').getBoundingClientRect();dock.style.top=Math.round(header.bottom+8)+'px';
 if(dock.hidden){dock.hidden=false;if(motionAllowed())dock.animate([{opacity:0,transform:'translateY(-4px)'},{opacity:1,transform:'none'}],{duration:160,easing:'cubic-bezier(.22,1,.36,1)'});}
}
function paintPill(s){
 const pill=$('download-pill'),show=['downloading','paused','verifying','failed','completed'].includes(s.phase);pill.hidden=!show;if(!show)return;
 pill.dataset.phase=s.phase;const percent=s.total>0?Math.floor(s.bytes/s.total*100):null;
 const text=s.phase==='downloading'?(percent!=null?percent+'%':modelSize(s.bytes))+(s.speed?' · '+(s.speed/1048576).toFixed(1)+' MB/s':''):s.phase==='paused'?t('dl_paused')+(percent!=null?' · '+percent+'%':''):t('dl_'+s.phase);
 const bar=el('span','pill-bar'),fill=el('span');fill.style.transform=`scaleX(${s.total>0?Math.min(1,s.bytes/s.total):0})`;bar.append(fill);
 pill.replaceChildren(...(s.phase==='downloading'||s.phase==='paused'?[bar]:[]),document.createTextNode(text));pill.title=s.name+' · '+t('dl_'+s.phase);pill.setAttribute('aria-label',pill.title);
}
function paintDock(){
 dockFrame=0;const s=dockState,dock=$('download-dock');if(!s)return;
 clearTimeout(dockTimer);paintPill(s);if(s.phase==='cancelled'){setDockOpen(false);$('download-pill').hidden=true;return;}
 if(s.id!==dockId){dockId=s.id;if(s.phase==='downloading')setDockOpen(true);}
 if(s.phase==='failed'&&!dockOpen)setDockOpen(true);
 dock.dataset.phase=s.phase;$('download-name').textContent=s.name;$('download-phase').textContent=t('dl_'+s.phase);
 const known=s.total>0;$('download-bar').hidden=!known;$('download-fill').style.transform=`scaleX(${known?Math.min(1,s.bytes/s.total):0})`;
 let meta='';
 if(s.phase==='downloading')meta=[known?modelSize(s.bytes)+' / '+modelSize(s.total):modelSize(s.bytes),s.speed?(s.speed/1048576).toFixed(1)+' MB/s':'',s.eta!=null?tf('dlLeft',{t:duration(s.eta)}):'',s.connections>1?tf('dlConnections',{n:s.connections}):''].filter(Boolean).join(' · ');
 else if(s.phase==='verifying')meta=tf('dlChecking',{size:modelSize(s.total)});
 else if(s.phase==='paused')meta=known?modelSize(s.bytes)+' / '+modelSize(s.total):'';
 else if(s.phase==='failed')meta=s.error||'';
 else if(s.phase==='completed')meta=modelSize(s.total);
 $('download-meta').textContent=meta;$('download-meta').title=meta;
 const toggle=$('download-toggle');toggle.hidden=!['downloading','paused','failed'].includes(s.phase);toggle.textContent=t(s.phase==='downloading'?'dlPause':s.phase==='paused'?'dlResume':'dlRetry');
 $('download-cancel').hidden=!['downloading','paused','failed'].includes(s.phase);
 if(s.phase==='completed')dockTimer=setTimeout(()=>{setDockOpen(false);$('download-pill').hidden=true;},5000);
}
$('download-pill').onclick=()=>setDockOpen(!dockOpen);
$('download-dock').addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();setDockOpen(false);$('download-pill').focus();}});
listen('download-event',event=>{if(event.models){state.models=event.models;renderPickers();renderModels();if(typeof renderModelDetails==='function')renderModelDetails();if(event.phase!=='completed')return;}dockState=event;if(!dockFrame)dockFrame=requestAnimationFrame(paintDock);});
$('download-toggle').onclick=()=>{const s=dockState;if(!s)return;if(s.phase==='downloading')api.downloads('pause',{id:s.id}).catch(e=>toast(cleanError(e)));else api.downloads('resume',{id:s.id}).catch(e=>{if(!/Cancelled/.test(e.message))toast(cleanError(e));});};
$('download-cancel').onclick=()=>{if(dockState)api.downloads('cancel',{id:dockState.id}).catch(e=>toast(cleanError(e)));};
$('download-dismiss').onclick=()=>setDockOpen(false);

// ---------- Export keeps the sources ----------
$('export-chat').onclick=async()=>{if(!state.chat.Messages.length)return;const text=`# ${state.chat.Title}\n\nModel: ${state.chat.Model}\n\n`+state.chat.Messages.map(m=>`## ${m.Role}\n\n${m.Content}\n`+(m.Activity?.sources?.length?'\n'+t('sourcesTitle')+':\n'+m.Activity.sources.map(s=>`- [${s.id}] ${s.title} — ${s.url}`).join('\n')+'\n':'')).join('\n');if(await api.export(text))toast(t('saved'));};

// ---------- Localization ----------
const toolsLocalize=localize;localize=function(){toolsLocalize();if(!state.ready)return;paintToolSettings();renderToolChips();paintLocalLabel();if(dockState&&!$('download-dock').hidden)paintDock();paintBrowser();for(const node of document.querySelectorAll('#browser-panel [aria-label]'))node.title=node.getAttribute('aria-label');};
function initializeTools(){document.querySelectorAll('[data-i18n]').forEach(node=>node.textContent=t(node.dataset.i18n));for(const node of document.querySelectorAll('#settings-nav [data-icon="globe"],#settings-nav [data-icon="tasks"],#settings-nav [data-icon="search"]'))node.replaceChildren(icon(node.dataset.icon));loadToolsConfig();api.downloads('list').then(list=>{const active=list.find(s=>['downloading','paused','failed','verifying'].includes(s.phase));if(active){dockState=active;paintDock();}}).catch(()=>{});}
window.addEventListener('lumen-ready',initializeTools,{once:true});if(state.ready)initializeTools();

// ---------- Segmented controls for short option lists ----------
// The real <select> stays in the DOM (hidden) and keeps its value and onchange logic; buttons only mirror it.
const segmentedIds=['language','interface-design','display-mode','text-size','context-size','search-results','search-language'];
function syncSegmented(){
 for(const id of segmentedIds){
  const select=$(id);if(!select)continue;let group=select.nextElementSibling?.classList.contains('segmented')?select.nextElementSibling:null;
  if(!group){group=el('div','segmented');group.setAttribute('role','radiogroup');select.after(group);select.classList.add('has-segmented');
   group.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const buttons=[...group.children],i=buttons.indexOf(document.activeElement),next=buttons[(i+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length];next.click();next.focus();});}
  const label=select.getAttribute('aria-label')||select.closest('.setting-row')?.querySelector('h3')?.textContent||'';group.setAttribute('aria-label',label);
  const options=[...select.options];
  if(group.children.length!==options.length)group.replaceChildren(...options.map(()=>{const b=el('button');b.type='button';b.setAttribute('role','radio');return b;}));
  options.forEach((option,i)=>{const b=group.children[i],on=option.value===select.value;b.textContent=option.textContent;b.setAttribute('aria-checked',String(on));b.tabIndex=on?0:-1;b.disabled=select.disabled;b.onclick=()=>{if(select.value===option.value)return;select.value=option.value;select.dispatchEvent(new Event('change'));syncSegmented();};});
 }
}
const segmentedLocalize=localize;localize=function(){segmentedLocalize();if(state.ready)syncSegmented();};
const segmentedApply=applyInterface;applyInterface=function(){segmentedApply();syncSegmented();};
const segmentedPaintTools=paintToolSettings;paintToolSettings=function(){segmentedPaintTools();syncSegmented();};
window.addEventListener('lumen-ready',()=>syncSegmented(),{once:true});if(state.ready)syncSegmented();
