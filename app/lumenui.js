'use strict';
// v1.2 renderer pieces (ROADMAP-v1.2.md): the "Introduce Lumen to the model" switch in Settings → Chat behavior (capabilities.cjs
// in the core builds the text; "Preview active instructions" shows it).
Object.assign(translations,{
 introduceLumen:['Introduce Lumen to the model','Lumen’i modele tanıt'],
 introduceLumenHint:['Tells the model it runs in Lumen and what it can do here: which tools are on, which are off and where to turn them on. Without it models often say they have no internet or cannot read files. About 150 tokens per reply.','Modele Lumen’de çalıştığını ve burada neler yapabildiğini söyler: hangi araçlar açık, hangileri kapalı ve nereden açılır. Bu olmadan modeller çoğu zaman internetleri olmadığını veya dosya okuyamadıklarını söyler. Yanıt başına yaklaşık 150 token.'],
});
(function introduceRow(){
 const panel=$('agent-panel'),anchor=panel?.querySelector('.settings-heading');if(!anchor||$('introduce-lumen'))return;
 const row=el('div','setting-row'),text=el('div'),h=el('h3','',t('introduceLumen')),p=el('p','',t('introduceLumenHint'));h.dataset.i18n='introduceLumen';p.dataset.i18n='introduceLumenHint';text.append(h,p);
 const sw=el('label','switch'),box=el('input'),knob=el('span');box.type='checkbox';box.id='introduce-lumen';sw.append(box,knob);row.append(text,sw);anchor.after(row);
 box.onchange=async()=>{try{state.prefs=await api.preferences({...state.prefs,introduceLumen:box.checked});}catch(e){box.checked=!box.checked;toast(cleanError(e));}};
})();
const lumenOpenSettings=openSettings;openSettings=function(section,animate){const r=lumenOpenSettings(section,animate);const b=$('introduce-lumen');if(b)b.checked=state.prefs?.introduceLumen!==false;return r;};

// ---------- The web card (ROADMAP-v1.2 §4B) ----------
// A message that wants the web (a link, "research", "araştır"…) while the web is off for it gets a card instead of an answer that
// pretends there is no internet: allow it once (no setting changes), turn it on, or answer without the web.
Object.assign(translations,{
 webCardTitle:['This message needs the web','Bu mesaj web gerektiriyor'],
 webCardCloud:['Web research is off for cloud models. Search queries and the pages read would be handled by Lumen; the findings go to {provider}.','Bulut modelleri için web araştırması kapalı. Aramaları ve sayfa okumayı Lumen yapar; bulgular {provider} sağlayıcısına gider.'],
 webCardOff:['Web search is turned off in Settings → Search.','Web araması Ayarlar → Arama’da kapalı.'],
 webCardAuto:['Automatic research is off, so Lumen would answer from the model’s own knowledge.','Otomatik araştırma kapalı; Lumen yalnızca modelin kendi bilgisiyle yanıt verirdi.'],
 webOnce:['Allow once','Bu seferlik izin ver'],webResearchNow:['Research','Araştır'],webAlways:['Turn on','Hep aç'],webAutoAlways:['Always research automatically','Hep otomatik araştır'],webWithout:['Answer without the web','Web’siz yanıtla'],
});
const lumenSend=send;send=async function(){
 if(state.busy||state.chat?.Project||(typeof imageMode!=='undefined'&&imageMode)||(typeof toolsMode!=='undefined'&&toolsMode)||document.querySelector('.web-card'))return lumenSend();
 const text=composeText();if(!text||!state.ready)return lumenSend();
 let route=null;try{route=await api.agent('route',{prompt:text,mode:typeof researchMode!=='undefined'&&researchMode?'research':'auto',model:$('model-picker').value});}catch{}
 if(!route||route.route==='agent'||!route.wants||!['cloud','web-off','auto-off'].includes(route.reason))return lumenSend();
 showWebCard(route.reason,text);
};
function showWebCard(reason,text){
 document.querySelector('.web-card')?.remove();
 const provider=state.models.find(m=>m.Name===$('model-picker').value)?.Cloud?.label||'';
 const card=el('div','approval-card web-card');card.setAttribute('role','group');card.setAttribute('aria-label',t('webCardTitle'));
 card.append(el('strong','',t('webCardTitle')),el('p','',reason==='cloud'?tf('webCardCloud',{provider}):reason==='web-off'?t('webCardOff'):t('webCardAuto')));
 const actions=el('div','approval-actions');
 const without=el('button','secondary web-without',t('webWithout')),always=el('button','secondary web-always',t(reason==='auto-off'?'webAutoAlways':'webAlways')),once=el('button','primary web-once',t(reason==='auto-off'?'webResearchNow':'webOnce'));
 [without,always,once].forEach(b=>b.type='button');
 const done=()=>card.remove();
 once.onclick=async()=>{done();await sendWithAgent(text,reason==='auto-off'?{}:{webOnce:true});};
 always.onclick=async()=>{always.disabled=true;try{
   if(reason==='cloud'){await api.connections('cloud',{webResearch:true});if(typeof loadConnections==='function')await loadConnections();}
   else if(reason==='web-off'){await api.tools('update',{search:{enabled:true}});}
   else await api.tools('update',{agent:{auto:true}});
   if(typeof loadToolsConfig==='function')await loadToolsConfig().catch(()=>{});
   done();await sendWithAgent(text);}catch(e){always.disabled=false;toast(cleanError(e));}};
 // The earlier send function never shows this card: it is the normal chat path.
 without.onclick=async()=>{done();await lumenSend();};
 actions.append(without,always,once);card.append(actions);$('messages').append(card);once.focus();
 $('chat-scroll').scrollTop=$('chat-scroll').scrollHeight;
}
