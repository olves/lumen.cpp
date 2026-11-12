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
 // Only what the user typed decides whether the message wants the web: text read from photos or attached files must not open the
 // card (a photo's OCR text or a date in a file is not a request to search).
 const typed=$('prompt').value.trim();if(!typed)return lumenSend();
 let route=null;try{route=await api.agent('route',{prompt:typed,mode:typeof researchMode!=='undefined'&&researchMode?'research':'auto',model:$('model-picker').value});}catch{}
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

// ---------- Photos and cloud models (ROADMAP-v1.2 §4C) ----------
// A cloud model that can see photos gets them once the user agreed for that provider (prefs.cloudPhotos, checked again in the
// core); one that cannot see gets only the text read from them, and says so. Local models keep vision.js's projector offer.
Object.assign(translations,{
 cloudPhotoSees:['{provider} can see these photos. They are sent to {provider} with your message.','{provider} bu fotoğrafları görebilir. Mesajınla birlikte {provider} sağlayıcısına gönderilirler.'],
 cloudPhotoAsk:['This model can see photos. Sending them means the images go to {provider}.','Bu model fotoğrafları görebilir. Göndermek, görüntülerin {provider} sağlayıcısına gitmesi demek.'],
 cloudPhotoMaybe:['{provider} may be able to see photos; if it cannot, Lumen sends only the text read from them and tells you.','{provider} fotoğrafları görebilir de göremeyebilir de; göremezse Lumen yalnızca okunan metni gönderir ve sana söyler.'],
 cloudPhotoAllow:['Send photos to {provider}','Fotoğrafları {provider} sağlayıcısına gönder'],
 cloudPhotoNo:['This cloud model cannot see photos: only the text read from them is sent.','Bu bulut modeli fotoğrafları göremez: yalnızca içlerinden okunan metin gönderilir.'],
 cloudPhotoDropped:['{provider} did not accept the photos; only their text was sent.','{provider} fotoğrafları kabul etmedi; yalnızca metinleri gönderildi.'],
});
const lumenPaintVision=paintVisionOffer;paintVisionOffer=function(){
 const model=state.models.find(m=>m.Name===visionModel()),cloud=model?.Cloud,hint=$('photo-mode-hint');
 if(!cloud||hint.hidden)return lumenPaintVision();
 const provider=cloud.label,allowed=(state.prefs.cloudPhotos||[]).includes(cloud.provider);visionOffer.replaceChildren();visionOffer.hidden=false;
 if(cloud.sees==='no'){hint.textContent=t('cloudPhotoNo');visionOffer.hidden=true;return;}
 if(allowed){hint.textContent=tf(cloud.sees==='yes'?'cloudPhotoSees':'cloudPhotoMaybe',{provider});visionOffer.hidden=true;return;}
 hint.textContent=tf(cloud.sees==='yes'?'cloudPhotoAsk':'cloudPhotoMaybe',{provider});
 const allow=el('button','text-button cloud-photo-allow',tf('cloudPhotoAllow',{provider}));allow.type='button';allow.disabled=state.busy;
 allow.onclick=async()=>{try{state.prefs=await api.preferences({...state.prefs,cloudPhotos:[...(state.prefs.cloudPhotos||[]),cloud.provider]});paintVisionOffer();}catch(e){toast(cleanError(e));}};
 visionOffer.append(allow);
};
api.onEvent(e=>{if(e?.type==='images-dropped')toast(tf('cloudPhotoDropped',{provider:e.data?.provider||''}));});

// ---------- Lasting memory (ROADMAP-v1.2 M6-E; core memory.cjs) ----------
// Settings → Memory: what Lumen remembers about the user (edit, remove, add), whether memory is used, and whether it may go to
// cloud models (off by default). A message such as "Remember: …" / "Bunu hatırla: …" offers a card; nothing is stored without it.
Object.assign(translations,{
 memoryTitle:['Memory','Hafıza'],memoryIntro:['Short facts Lumen remembers about you and gives to the model in every conversation. Nothing is added without your approval.','Lumen’in senin hakkında hatırladığı ve her sohbette modele verdiği kısa bilgiler. Onayın olmadan hiçbir şey eklenmez.'],
 memoryOn:['Use memory','Hafızayı kullan'],memoryOnHint:['Local models get these facts with every message.','Yerel modeller bu bilgileri her mesajla birlikte alır.'],
 memoryCloud:['Share memory with cloud models','Hafızayı bulut modelleriyle paylaş'],memoryCloudHint:['Off: cloud providers never receive these facts.','Kapalıyken bulut sağlayıcıları bu bilgileri hiç almaz.'],
 memoryEmpty:['Nothing yet. Write “Remember: …” in a message, or add a fact here.','Henüz bir şey yok. Bir mesajda “Bunu hatırla: …” yaz ya da buradan ekle.'],
 memoryAdd:['Add','Ekle'],memoryAddPlaceholder:['A fact to remember, e.g. “I prefer short answers”','Hatırlanacak bir bilgi; ör. “Kısa yanıtları tercih ederim”'],
 memorySave:['Save','Kaydet'],memoryRemove:['Remove','Sil'],memoryClear:['Forget everything','Hepsini unut'],memoryClearConfirm:['Forget everything Lumen remembers?','Lumen’in hatırladığı her şey silinsin mi?'],
 memoryCardTitle:['Remember this?','Bunu hatırlayayım mı?'],memoryRemember:['Remember','Hatırla'],memoryNo:['Not now','Şimdi değil'],memoryAdded:['Lumen will remember this.','Lumen bunu hatırlayacak.'],memoryDuplicate:['Lumen already remembers this.','Lumen bunu zaten hatırlıyor.'],
});
sectionNames.memory='memoryTitle';
(function memorySection(){
 if($('memory-panel'))return;const after=document.querySelector('#settings-nav [data-setting="agent"]');if(!after)return;
 const nav=el('button');nav.dataset.setting='memory';nav.append(icon('book'),el('span','',t('memoryTitle')));nav.onclick=()=>openSettings('memory');after.after(nav);
 const panel=el('section','settings-panel');panel.id='memory-panel';panel.hidden=true;$('settings-page').append(panel);
})();
const memoryOpenSettings=openSettings;openSettings=function(section,animate){const r=memoryOpenSettings(section,animate);$('memory-panel').hidden=state.setting!=='memory';if(state.setting==='memory'){$('chat-title').textContent=t('memoryTitle');paintMemory();}return r;};
async function paintMemory(){
 const panel=$('memory-panel');if(panel.hidden)return;let items=[];try{items=await api.memory('list',{});}catch{}
 const head=el('div','settings-heading');head.append(el('h1','',t('memoryTitle')),el('p','',t('memoryIntro')));
 const sw=(id,label,hint,on,save)=>{const row=el('div','setting-row'),text=el('div'),s=el('label','switch'),box=el('input'),knob=el('span');box.type='checkbox';box.id=id;box.checked=on;s.append(box,knob);text.append(el('h3','',t(label)),el('p','',t(hint)));row.append(text,s);box.onchange=async()=>{try{state.prefs=await api.preferences({...state.prefs,...save(box.checked)});}catch(e){box.checked=!box.checked;toast(cleanError(e));}};return row;};
 const list=el('div','memory-list');
 if(!items.length)list.append(el('p','quiet memory-empty',t('memoryEmpty')));
 for(const item of items){
  const row=el('div','memory-row'),input=el('input');input.value=item.text;input.maxLength=300;input.setAttribute('aria-label',t('memoryTitle'));
  const save=el('button','text-button',t('memorySave')),remove=el('button','text-button danger',t('memoryRemove'));[save,remove].forEach(b=>b.type='button');save.hidden=true;
  input.oninput=()=>{save.hidden=input.value.trim()===item.text;};
  save.onclick=async()=>{try{await api.memory('update',{id:item.id,text:input.value,language:state.prefs.language});paintMemory();}catch(e){toast(cleanError(e));}};
  remove.onclick=async()=>{try{await api.memory('remove',{id:item.id});paintMemory();}catch(e){toast(cleanError(e));}};
  row.dataset.id=item.id;row.append(input,save,remove);list.append(row);
 }
 const addRow=el('div','memory-row memory-new'),add=el('input'),addButton=el('button','secondary',t('memoryAdd'));add.id='memory-new';add.maxLength=300;add.placeholder=t('memoryAddPlaceholder');addButton.type='button';
 addButton.onclick=async()=>{if(!add.value.trim())return;try{await api.memory('add',{text:add.value,language:state.prefs.language});paintMemory();}catch(e){toast(cleanError(e));}};
 add.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();addButton.click();}};addRow.append(add,addButton);
 const clear=el('button','text-button danger memory-clear',t('memoryClear'));clear.type='button';clear.hidden=!items.length;
 clear.onclick=async()=>{if(!confirm(t('memoryClearConfirm')))return;await api.memory('clear',{});paintMemory();};
 panel.replaceChildren(head,sw('memory-on','memoryOn','memoryOnHint',state.prefs.memoryOn!==false,v=>({memoryOn:v})),sw('memory-cloud','memoryCloud','memoryCloudHint',state.prefs.memoryCloud===true,v=>({memoryCloud:v})),list,addRow,clear);
}
// "Remember: …" in a message: the message is sent as usual and a card offers to store the fact.
const memorySend=send;send=async function(){
 const typed=$('prompt').value.trim();let fact=null;
 if(!state.busy&&typed&&state.prefs.memoryOn!==false){try{fact=(await api.memory('check',{text:typed})).fact;}catch{}}
 const r=await memorySend();if(fact)showMemoryCard(fact);return r;
};
// ---------- Sensitive data before a cloud model (ROADMAP-v1.2 M6-G; sensitive.js) ----------
// Checked here, on this PC, only when the message goes to a cloud provider; a local model gets no warning.
Object.assign(translations,{
 sensTitle:['This message seems to contain private data','Bu mesajda özel bilgi var gibi görünüyor'],
 sensBody:['It goes to {provider}: {items}.','{provider} sağlayıcısına gidecek: {items}.'],
 sens_card:['card number {v}','kart numarası {v}'],sens_tckn:['Turkish ID number {v}','T.C. kimlik numarası {v}'],sens_iban:['IBAN {v}','IBAN {v}'],
 sens_key:['API key or token {v}','API anahtarı veya token {v}'],'sens_private-key':['a private key','özel anahtar'],sens_password:['a password','bir parola'],
 sensEdit:['Edit','Düzenle'],sensSend:['Send anyway','Yine de gönder'],
});
let sensitiveApproved=false;
const sensitiveSend=send;send=async function(){
 const model=state.models.find(m=>m.Name===$('model-picker').value);
 if(state.busy||sensitiveApproved||!model?.Cloud||typeof lumenSensitive==='undefined')return sensitiveSend();
 const found=lumenSensitive.findSensitive(composeText());if(!found.length)return sensitiveSend();
 document.querySelector('.sensitive-card')?.remove();
 const card=el('div','approval-card sensitive-card');card.setAttribute('role','alertdialog');card.setAttribute('aria-label',t('sensTitle'));
 const items=found.slice(0,4).map(f=>tf('sens_'+f.kind,{v:f.masked})).join(', ');
 const actions=el('div','approval-actions'),edit=el('button','secondary sens-edit',t('sensEdit')),go=el('button','primary sens-send',t('sensSend'));[edit,go].forEach(b=>b.type='button');
 edit.onclick=()=>{card.remove();$('prompt').focus();};
 go.onclick=async()=>{card.remove();sensitiveApproved=true;try{await send();}finally{sensitiveApproved=false;}};
 actions.append(edit,go);card.append(el('strong','',t('sensTitle')),el('p','',tf('sensBody',{provider:model.Cloud.label,items})),actions);$('messages').append(card);edit.focus();
 $('chat-scroll').scrollTop=$('chat-scroll').scrollHeight;
};
function showMemoryCard(fact){
 document.querySelector('.memory-card')?.remove();
 const card=el('div','approval-card memory-card');card.setAttribute('role','group');card.setAttribute('aria-label',t('memoryCardTitle'));
 const actions=el('div','approval-actions'),no=el('button','secondary memory-no',t('memoryNo')),yes=el('button','primary memory-yes',t('memoryRemember'));[no,yes].forEach(b=>b.type='button');
 no.onclick=()=>card.remove();
 yes.onclick=async()=>{try{const r=await api.memory('add',{text:fact,language:state.prefs.language});card.remove();toast(t(r.duplicate?'memoryDuplicate':'memoryAdded'));}catch(e){toast(cleanError(e));}};
 actions.append(no,yes);card.append(el('strong','',t('memoryCardTitle')),el('p','memory-fact',fact),actions);$('messages').append(card);$('chat-scroll').scrollTop=$('chat-scroll').scrollHeight;
}
