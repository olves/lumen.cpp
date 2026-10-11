'use strict';
// Response controls (thinking, response length, creativity), the thinking block, extra browser settings and panel tools.
// Loaded after tools.js. Thinking text is painted with rAF batching like the answer stream; nothing animates while idle.
Object.assign(paths,{home:'M3 9l6-5 6 5M5 8v7h8V8',up:'M5 11l4-4 4 4',down:'M5 7l4 4 4-4'});
for(const node of document.querySelectorAll('[data-icon="home"],[data-icon="up"],[data-icon="down"]'))node.replaceChildren(icon(node.dataset.icon));
Object.assign(translations,{
 responseLabel:['RESPONSES','YANITLAR'],optOff:['Off','Kapalı'],optOn:['On','Açık'],
 thinkingSetting:['Thinking','Düşünme'],thinkingHint:['Models that support it (for example Qwen3 or DeepSeek R1) reason before answering. Slower, often better on hard questions. Applies to chat and research.','Destekleyen modeller (ör. Qwen3, DeepSeek R1) yanıt vermeden önce düşünür. Daha yavaştır, zor sorularda çoğu zaman daha iyidir. Sohbet ve araştırmada geçerlidir.'],
 showThinking:['Show thinking','Düşünmeyi göster'],showThinkingHint:['Shows the model’s reasoning above its answer, collapsed. It is saved with the conversation but never sent back to the model.','Modelin akıl yürütmesini yanıtın üstünde, kapalı olarak gösterir. Sohbetle kaydedilir ama modele geri gönderilmez.'],
 responseLength:['Response length','Yanıt uzunluğu'],responseLengthHint:['Most tokens a reply may use. Longer replies leave less room for history.','Bir yanıtın kullanabileceği en fazla token. Uzun yanıtlar geçmişe daha az yer bırakır.'],responseLengthThinking:['Most tokens a reply may use. With thinking on, at least 2,048 are reserved, up to half the context window.','Bir yanıtın kullanabileceği en fazla token. Düşünme açıkken en az 2.048 ayrılır; en fazla context penceresinin yarısı.'],
 creativitySetting:['Creativity','Yaratıcılık'],creativityHint:['Precise is steadier for code and facts; Creative varies more. Research answers stay at most Balanced.','Kesin, kod ve bilgi için daha tutarlıdır; Yaratıcı daha çok çeşitlenir. Araştırma yanıtları en fazla Dengeli olur.'],creativityPrecise:['Precise','Kesin'],creativityBalanced:['Balanced','Dengeli'],creativityCreative:['Creative','Yaratıcı'],
 responseRuntimeNote:['The tool runtime is unavailable, so replies use the defaults: 512 tokens, Balanced, no thinking.','Araç çalışma ortamı kullanılamıyor; yanıtlar varsayılanları kullanır: 512 token, Dengeli, düşünme kapalı.'],
 thinkingLive:['Thinking…','Düşünüyor…'],thoughtFor:['Thought for {n} s','{n} sn düşündü'],thoughtShort:['Thought for a moment','Kısa bir süre düşündü'],thinkingNoAnswer:['The model used the whole response length while thinking. Raise Response length or turn thinking off.','Model tüm yanıt uzunluğunu düşünürken kullandı. Yanıt uzunluğunu artır veya düşünmeyi kapat.'],
 browsingLabel:['BROWSING','GEZİNME'],privacyLabel:['PRIVACY','GİZLİLİK'],
 searchEngine:['Address bar search','Adres çubuğu araması'],searchEngineHint:['Words typed in the address bar are searched here. Research searches use the provider under Search.','Adres çubuğuna yazılan kelimeler burada aranır. Araştırma aramaları Arama altındaki sağlayıcıyı kullanır.'],
 homePage:['Home page','Ana sayfa'],homePageHint:['Opened by the home button. Empty uses the search engine’s page.','Ana sayfa düğmesiyle açılır. Boş bırakılırsa arama motorunun sayfası kullanılır.'],homeSaved:['Home page saved','Ana sayfa kaydedildi'],homeInvalid:['Enter a web address that starts with http or https.','http veya https ile başlayan bir web adresi gir.'],
 defaultZoom:['Default zoom','Varsayılan yakınlaştırma'],defaultZoomHint:['Ctrl + plus / minus changes it for the open page; Ctrl + 0 resets.','Ctrl + artı / eksi açık sayfa için değiştirir; Ctrl + 0 sıfırlar.'],
 panelWidth:['Panel width','Panel genişliği'],panelWidthHint:['Space the browser takes next to the chat.','Tarayıcının sohbetin yanında kapladığı alan.'],widthNarrow:['Narrow','Dar'],widthMedium:['Medium','Orta'],widthWide:['Wide','Geniş'],
 pageJavascript:['JavaScript on pages','Sayfalarda JavaScript'],pageJavascriptHint:['Off makes pages simpler and quieter; some sites will not work. Applies to the panel.','Kapalıyken sayfalar daha sade ve sessizdir; bazı siteler çalışmaz. Panelde geçerlidir.'],
 popupsSetting:['Pop-ups','Açılır pencereler'],popupsHint:['New windows never open. Links that ask for one can open in the panel instead.','Yeni pencere hiçbir zaman açılmaz. Yeni pencere isteyen bağlantılar bunun yerine panelde açılabilir.'],popupsPanel:['Open here','Burada aç'],popupsBlock:['Block','Engelle'],
 privacySignals:['Ask sites not to track','Sitelerden izlememelerini iste'],privacySignalsHint:['Sends Global Privacy Control and Do Not Track. Sites decide whether to honor them.','Global Privacy Control ve Do Not Track gönderir. Uyup uymamak sitelere bağlıdır.'],
 clearOnExit:['Clear browsing data on exit','Çıkışta tarama verilerini temizle'],clearOnExitHint:['Cookies, storage and cache from the panel are removed when Lumen closes. Sign-ins will not be remembered.','Lumen kapanırken paneldeki çerezler, depolama ve önbellek silinir. Oturumlar hatırlanmaz.'],
 askPage:['Ask about page','Sayfayı sor'],askPageTitle:['Put this address in your message and research it','Bu adresi mesaja ekle ve araştır'],openBrowser:['Open browser','Tarayıcıyı aç'],findNone:['No matches','Eşleşme yok'],findCount:['{n} of {total}','{n}/{total}'],zoomReset:['Reset zoom','Yakınlaştırmayı sıfırla']
});

// ---------- Response settings ----------
segmentedIds.push('thinking-mode','response-tokens','creativity','browser-engine','browser-zoom','browser-width','browser-popups');
const responseIds=['thinking-mode','show-thinking','response-tokens','creativity'];
function paintResponseSettings(){
 const p=state.prefs;$('thinking-mode').value=p.thinking?'on':'off';$('show-thinking').checked=p.showThinking!==false;$('response-tokens').value=String(p.responseTokens||512);$('creativity').value=p.creativity||'balanced';
 $('response-length-hint').textContent=t(p.thinking?'responseLengthThinking':'responseLengthHint');
 const unavailable=toolsConfig&&!toolsConfig.hostReady;$('response-runtime-note').hidden=!unavailable;$('response-runtime-note').textContent=t('responseRuntimeNote');
 for(const id of ['thinking-mode','response-tokens','creativity'])$(id).disabled=!!unavailable;
}
async function saveResponseSettings(){
 try{state.prefs=await api.preferences({...state.prefs,thinking:$('thinking-mode').value==='on',showThinking:$('show-thinking').checked,responseTokens:Number($('response-tokens').value),creativity:$('creativity').value});}catch(e){toast(cleanError(e));}
 paintResponseSettings();syncSegmented();renderContext();if(!state.busy)renderMessages();
}
for(const id of responseIds)$(id).onchange=saveResponseSettings;
const controlsOpenSettings=openSettings;openSettings=function(section,animate){controlsOpenSettings(section,animate);if(state.setting==='agent'){paintResponseSettings();if(!toolsConfig)loadToolsConfig().then(paintResponseSettings,()=>{});}};
const controlsLocalize=localize;localize=function(){controlsLocalize();if(state.ready)paintResponseSettings();};
// What the next reply reserves (mirrors main and lumen-host); the engine's own number wins once a request ran.
function expectedReserve(){const p=state.prefs,ctx=p.contextSize||4096;if(toolsConfig&&!toolsConfig.hostReady)return 512;const n=p.responseTokens||512;return Math.min(p.thinking?Math.max(n,2048):n,Math.floor(ctx/2));}
const controlsRenderContext=renderContext;renderContext=function(){controlsRenderContext();const c=state.contexts.get(state.chat?.Id);$('reserved-tokens').textContent=fmt(c?.Reserved||expectedReserve());};

// ---------- Thinking block ----------
function thoughtLabel(seconds){return seconds>=1?tf('thoughtFor',{n:fmt(seconds)}):t('thoughtShort');}
function thinkingBlock(text,label,live=false){
 const box=el('details','thinking'+(live?' live':'')),summary=el('summary'),name=el('span','thinking-label',label),body=el('div','thinking-text');
 summary.append(name);body.textContent=text;box.append(summary,body);return {box,name,body,text:body.firstChild||body.appendChild(document.createTextNode(''))};
}
const controlsMessageNode=messageNode;messageNode=function(m,index,stream=false){
 const result=controlsMessageNode(m,index,stream);
 if(!stream&&m.Role==='assistant'&&m.Reasoning?.text&&state.prefs.showThinking!==false)result.node.insertBefore(thinkingBlock(m.Reasoning.text,thoughtLabel(m.Reasoning.seconds)).box,result.body);
 if(!stream&&m.Role==='assistant'&&!m.Content.trim()&&m.Reasoning?.text)result.body.replaceChildren(el('p','quiet',t('thinkingNoAnswer')));
 return result;
};
let liveThought=null;
function thoughtFor(body){
 if(liveThought?.owner===body)return liveThought;
 const view=thinkingBlock('',t('thinkingLive'),true);liveThought={owner:body,view,start:Date.now(),end:0,text:'',pending:'',frame:0};
 if(state.prefs.showThinking!==false&&body.parentNode)body.parentNode.insertBefore(view.box,body);
 return liveThought;
}
function addThought(text){
 if(!streamBody||!text)return;const live=thoughtFor(streamBody);if(live.end)return;live.text+=text;live.pending+=text;
 if(!live.frame)live.frame=requestAnimationFrame(()=>{live.frame=0;live.view.text.appendData(live.pending);live.pending='';if(live.view.box.open)live.view.body.scrollTop=live.view.body.scrollHeight;});
}
function endThought(){
 const live=liveThought;if(!live||live.end||live.owner!==streamBody)return;live.end=Date.now();
 if(live.frame){cancelAnimationFrame(live.frame);live.frame=0;live.view.text.appendData(live.pending);live.pending='';}
 live.view.box.classList.remove('live');live.view.name.textContent=thoughtLabel(Math.round((live.end-live.start)/1000));
}
// Used by tools.js to store the research answer's thinking with the turn.
function liveReasoning(text){const live=liveThought;const value=text||live?.text||'';if(!value)return null;const end=live?.end||Date.now();return {text:value.slice(0,30000),seconds:live?Math.max(0,Math.round((end-live.start)/1000)):null};}
api.onEvent(e=>{if(state.operation!=='send')return;if(e.type==='reasoning')addThought(e.data);else if(e.type==='chunk')endThought();});
listen('agent-event',event=>{if(!agentRun||(event.runId&&event.runId!==agentRun.runId))return;if(event.type==='reasoning')addThought(event.text);else if(event.type==='chunk')endThought();});

// ---------- Browser settings ----------
const controlsPaintTools=paintToolSettings;paintToolSettings=function(){
 const b=toolsConfig?.browser;
 if(b){$('browser-engine').value=b.searchEngine;if(document.activeElement!==$('browser-home'))$('browser-home').value=b.homePage||'';$('browser-zoom').value=String(b.zoom);$('browser-width').value=b.panelWidth;$('browser-javascript').checked=b.javascript;$('browser-popups').value=b.popups;$('browser-privacy').checked=b.privacySignals;$('browser-clear-exit').checked=b.clearOnExit;document.body.dataset.browserWidth=b.panelWidth;}
 controlsPaintTools();
 if(state.setting==='agent')paintResponseSettings();
};
const browserSetting=(id,key,read)=>{$(id).onchange=()=>updateTools({browser:{[key]:read($(id))}});};
browserSetting('browser-engine','searchEngine',e=>e.value);browserSetting('browser-zoom','zoom',e=>Number(e.value));browserSetting('browser-width','panelWidth',e=>e.value);
browserSetting('browser-javascript','javascript',e=>e.checked);browserSetting('browser-popups','popups',e=>e.value);browserSetting('browser-privacy','privacySignals',e=>e.checked);browserSetting('browser-clear-exit','clearOnExit',e=>e.checked);
function validHome(value){try{const u=new URL(/^[a-z][a-z0-9+.-]*:/i.test(value)?value:'https://'+value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}}
$('browser-home-form').onsubmit=async event=>{event.preventDefault();const value=$('browser-home').value.trim();if(value&&!validHome(value)){toast(t('homeInvalid'));return;}await updateTools({browser:{homePage:value}});toast(t('homeSaved'));};
$('browser-width').addEventListener('change',()=>requestAnimationFrame(syncBrowserBounds));

// ---------- Browser panel tools ----------
const headerBrowser=el('button','icon-button');headerBrowser.id='open-browser';headerBrowser.type='button';headerBrowser.append(icon('globe'));$('export-chat').before(headerBrowser);
function labelHeaderBrowser(){headerBrowser.title=t('openBrowser');headerBrowser.setAttribute('aria-label',t('openBrowser'));$('browser-ask').title=t('askPageTitle');$('browser-zoom-level').title=t('zoomReset');}
const controlsLocalizeLabels=localize;localize=function(){controlsLocalizeLabels();labelHeaderBrowser();};labelHeaderBrowser();
async function showBrowserWith(action){
 const panel=$('browser-panel'),wasHidden=panel.hidden;panel.hidden=false;document.body.classList.add('browser-open');
 if(wasHidden&&motionAllowed())panel.animate([{opacity:0,transform:'translateX(10px)'},{opacity:1,transform:'none'}],{duration:200,easing:'cubic-bezier(.22,1,.36,1)'}).finished.then(syncBrowserBounds,()=>{});
 try{browserState=await action();}catch(e){browserState={open:true,url:'',error:{blocked:/blocked/i.test(cleanError(e)),description:cleanError(e)}};}
 paintBrowser();syncBrowserBounds();
}
headerBrowser.onclick=()=>{if(!$('browser-panel').hidden){closeBrowser();return;}if(!toolsConfig)loadToolsConfig().catch(()=>{});showBrowserWith(()=>api.browser('home'));};
$('browser-home-button').onclick=()=>showBrowserWith(()=>api.browser('home'));
$('browser-zoom-level').onclick=()=>api.browser('zoom',{step:0}).catch(()=>{});
$('browser-ask').onclick=async()=>{
 const url=browserState.url;if(!/^https?:/.test(url||''))return;const prompt=$('prompt'),current=prompt.value.trim();
 if(!current.includes(url))prompt.value=url+'\n'+current;resizePrompt();
 if(!toolsConfig)await loadToolsConfig().catch(()=>{});
 if(toolsConfig?.hostReady&&toolsConfig.search.enabled){researchMode=true;renderToolChips();}else if(toolsConfig?.hostReady)$('use-research').click();
 prompt.focus();prompt.setSelectionRange(prompt.value.length,prompt.value.length);
};
// Find in page
function openFind(){const bar=$('browser-find');if(bar.hidden){bar.hidden=false;if(motionAllowed())bar.animate([{opacity:0},{opacity:1}],{duration:120});}$('browser-find-input').focus();$('browser-find-input').select();}
function closeFind(){const bar=$('browser-find');if(bar.hidden)return;bar.hidden=true;$('browser-find-count').textContent='';api.browser('find-stop').catch(()=>{});}
function findStep(forward){const text=$('browser-find-input').value;if(text)api.browser('find',{text,forward,next:true}).catch(()=>{});}
$('browser-find-input').oninput=()=>{const text=$('browser-find-input').value;if(!text)$('browser-find-count').textContent='';api.browser('find',{text}).catch(()=>{});};
$('browser-find').onsubmit=event=>{event.preventDefault();findStep(true);};
$('browser-find-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&event.shiftKey){event.preventDefault();findStep(false);}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeFind();}});
$('browser-find-prev').onclick=()=>findStep(false);$('browser-find-next').onclick=()=>findStep(true);$('browser-find-close').onclick=closeFind;
function paintBrowserTools(){
 const s=browserState,find=s.find;
 if(!$('browser-find').hidden&&$('browser-find-input').value)$('browser-find-count').textContent=find?find.matches?tf('findCount',{n:fmt(find.active),total:fmt(find.matches)}):t('findNone'):'';
 const zoom=s.zoom||100,base=toolsConfig?.browser.zoom||100;$('browser-zoom-level').hidden=!s.open||zoom===base;$('browser-zoom-level').textContent=zoom+'%';
 $('browser-ask').disabled=!/^https?:/.test(s.url||'')||state.busy;
 headerBrowser.setAttribute('aria-pressed',String(!$('browser-panel').hidden));
}
const controlsPaintBrowser=paintBrowser;paintBrowser=function(){controlsPaintBrowser();paintBrowserTools();};
listen('browser-event',next=>{
 if(!next.open){$('browser-find').hidden=true;paintBrowserTools();return;}
 if(next.shortcut==='find')openFind();else if(next.shortcut==='find-close')closeFind();else if(next.shortcut==='address'){$('browser-address').focus();$('browser-address').select();}
});
// The same shortcuts while focus is in Lumen's own panel controls.
$('browser-panel').addEventListener('keydown',event=>{
 const mod=event.ctrlKey||event.metaKey,key=event.key.toLowerCase();
 if(mod&&key==='f'){event.preventDefault();openFind();}
 else if(mod&&key==='l'){event.preventDefault();$('browser-address').focus();$('browser-address').select();}
 else if(mod&&(key==='='||key==='+'||key==='-'||key==='0')&&document.activeElement!==$('browser-address')&&document.activeElement!==$('browser-find-input')){event.preventDefault();api.browser('zoom',{step:key==='0'?0:key==='-'?-1:1}).catch(()=>{});}
},true);
const controlsCloseBrowser=closeBrowser;closeBrowser=function(){$('browser-find').hidden=true;controlsCloseBrowser();paintBrowserTools();};
// Host error when thinking used the whole reply budget, shown in the interface language.
const controlsToast=toast;toast=function(message,...rest){return controlsToast(/ran out while the model was thinking/.test(String(message))?t('thinkingNoAnswer'):message,...rest);};
if(state.ready){paintResponseSettings();renderContext();}else window.addEventListener('lumen-ready',()=>{paintResponseSettings();renderContext();},{once:true});
