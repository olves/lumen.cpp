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
