'use strict';
// Connections (connections.cjs): cloud models, MCP servers and the local API — all off until turned on in Settings.
// Composer: "+ → Connected tools" sends the message through the tool loop (agent.cjs runTools) with an approval card for each
// call; a cloud model shows where the conversation goes instead of "Local response".
Object.assign(paths,{cloud:'M5 14h8a3 3 0 00.4-6A4.5 4.5 0 004.7 6.6 3.2 3.2 0 005 14z',plug:'M7 2v4M11 2v4M5 6h8v3a4 4 0 01-8 0V6zM9 13v3',server:'M3 3h12v5H3zM3 10h12v5H3zM6 5.5h.01M6 12.5h.01'});
Object.assign(translations,{
 connectionsLabel:['CONNECTIONS','BAĞLANTILAR'],cloudTitle:['Cloud models','Bulut modelleri'],mcpTitle:['MCP servers','MCP sunucuları'],apiTitle:['Local API','Yerel API'],
 cloudIntro:['Optional. Use models from a provider with your own API key.','İsteğe bağlı. Kendi API anahtarınla bir sağlayıcının modellerini kullan.'],
 cloudPrivacy:['Off by default. Only conversations where you pick a cloud model are sent, and only to that provider: the messages, the conversation’s instructions, selected skills and document excerpts. Photos go as their recognized text. Research, project folders and connected tools always run on local models. Keys are encrypted on this computer.','Varsayılan olarak kapalı. Yalnızca bulut modeli seçtiğin sohbetler, yalnızca o sağlayıcıya gönderilir: mesajlar, sohbetin talimatı, seçili skill’ler ve belge alıntıları. Fotoğraflar tanınan metin olarak gider. Araştırma, proje klasörü ve bağlı araçlar her zaman yerel modellerle çalışır. Anahtarlar bu bilgisayarda şifrelenir.'],
 cloudEnable:['Use cloud models','Bulut modellerini kullan'],cloudEnableHint:['Adds the models you choose below to the model menu.','Aşağıda seçtiğin modelleri model menüsüne ekler.'],
 cloudConsentTitle:['Send conversations to a cloud provider?','Sohbetler bir bulut sağlayıcısına gönderilsin mi?'],cloudConsentYes:['Turn on','Aç'],cloudConsentNo:['Cancel','Vazgeç'],
 cloudKey:['API key','API anahtarı'],cloudKeySaved:['Key saved (encrypted)','Anahtar kayıtlı (şifreli)'],cloudKeyNone:['No key','Anahtar yok'],cloudKeySave:['Save key','Anahtarı kaydet'],cloudKeyRemove:['Remove key','Anahtarı kaldır'],
 cloudModels:['Models in the menu','Menüdeki modeller'],cloudModelsNone:['None yet.','Henüz yok.'],cloudLoad:['Load models','Modelleri getir'],cloudAddModel:['Add','Ekle'],cloudModelId:['Model ID, e.g. gpt-4o-mini','Model kimliği, ör. gpt-4o-mini'],
 cloudTest:['Test','Dene'],cloudTestOk:['{provider} answered: “{reply}”','{provider} yanıt verdi: “{reply}”'],cloudBase:['Address (OpenAI-compatible, ending in /v1)','Adres (OpenAI uyumlu, /v1 ile biten)'],cloudLabel:['Name','Ad'],cloudSaveBase:['Save address','Adresi kaydet'],
 cloudLoaded:['{n} models found. Pick the ones to show in the menu.','{n} model bulundu. Menüde görünecekleri seç.'],cloudFilter:['Filter models','Modelleri süz'],cloudKeyFirst:['Save an API key first.','Önce bir API anahtarı kaydet.'],
 cloudModelTag:['Cloud','Bulut'],cloudReply:['Cloud · {provider}','Bulut · {provider}'],cloudReplyTitle:['This conversation is sent to {provider}.','Bu sohbet {provider} sağlayıcısına gönderilir.'],
 cloudLocalOnly:['Research, project folders and connected tools run on local models. Choose a local model for this message.','Araştırma, proje klasörü ve bağlı araçlar yerel modellerle çalışır. Bu mesaj için yerel bir model seç.'],
 cloudPhotos:['Cloud models get the recognized text of photos (OCR), not the image.','Bulut modellerine fotoğrafların görüntüsü değil, tanınan metni (OCR) gider.'],
 cloudContext:['Counted by {provider}','{provider} tarafından sayıldı'],cloudContextNone:['{provider} did not report token counts.','{provider} token sayısı bildirmedi.'],
 mcpIntro:['Let local models use tools from MCP servers you connect.','Yerel modellerin bağladığın MCP sunucularındaki araçları kullanmasına izin ver.'],
 mcpRules:['Lumen connects by address (Streamable HTTP) and never starts programs: run a local server yourself and add its address. Tools are off until you turn them on. Each call shows its arguments and waits for your approval unless you choose “Always allow” for that tool. What a tool does is up to its server.','Lumen adresle bağlanır (Streamable HTTP) ve hiçbir program başlatmaz: yerel bir sunucuyu kendin çalıştırıp adresini ekle. Araçlar sen açana kadar kapalıdır. Her çağrı argümanlarını gösterir ve o araç için “Her zaman izin ver” seçmediysen onayını bekler. Aracın ne yaptığı sunucusuna bağlıdır.'],
 mcpAdd:['Add server','Sunucu ekle'],mcpName:['Name','Ad'],mcpUrl:['Address, e.g. http://127.0.0.1:8000/mcp','Adres, ör. http://127.0.0.1:8000/mcp'],mcpToken:['Access token (optional)','Erişim jetonu (isteğe bağlı)'],
 mcpNone:['No servers yet.','Henüz sunucu yok.'],mcpTools:['{n} tools','{n} araç'],mcpToolsOn:['{on} of {n} tools on','{n} aracın {on} tanesi açık'],mcpRefresh:['Refresh tools','Araçları yenile'],mcpRemove:['Remove','Kaldır'],
 mcpAsk:['Ask every time','Her seferinde sor'],mcpAlways:['Always allow','Her zaman izin ver'],mcpReadOnly:['read-only','salt okunur'],mcpServerOn:['Use this server','Bu sunucuyu kullan'],mcpTokenSet:['Token saved','Jeton kayıtlı'],
 mcpChangeToken:['Change token','Jetonu değiştir'],mcpChecked:['Checked {time}','Denetlendi {time}'],mcpAdded:['Server added.','Sunucu eklendi.'],mcpError:['Could not list tools: {error}','Araçlar listelenemedi: {error}'],
 toolsMenu:['Connected tools','Bağlı araçlar'],toolsMenuHint:['Let the model use tools you turned on','Modelin açtığın araçları kullanmasına izin ver'],
 toolsChip:['Tools · {n} on','Araçlar · {n} açık'],toolsChipNote:['asks before each call','her çağrıdan önce sorar'],toolsChipAlways:['some run without asking','bazıları sormadan çalışır'],toolsRemove:['Stop using tools','Araç kullanmayı kapat'],
 toolsNoneOn:['No tools are on. Turn tools on in Settings → MCP servers.','Açık araç yok. Ayarlar → MCP sunucuları’ndan araç aç.'],
 approvalTitle:['Allow {tool}?','{tool} çalışsın mı?'],approvalServer:['on {server}','{server} üzerinde'],approvalArgs:['Arguments','Argümanlar'],
 approvalAllow:['Allow once','Bir kez izin ver'],approvalAlways:['Always allow this tool','Bu araca hep izin ver'],approvalDeny:['Deny','Reddet'],approvalTimeout:['No answer within 2 minutes; the call was not made.','2 dakika içinde yanıt yok; çağrı yapılmadı.'],
 actTools:['Using connected tools','Bağlı araçlar kullanılıyor'],actToolsDone:['Used connected tools','Bağlı araçlar kullanıldı'],actWaiting:['Waiting for your approval · {tool}','Onayın bekleniyor · {tool}'],
 opMcp:['{tool} · {server}','{tool} · {server}'],opMcpDeclined:['{tool} · declined','{tool} · reddedildi'],opMcpWaiting:['{tool} · waiting for approval','{tool} · onay bekliyor'],
 toolResults:['{n} tool results','{n} araç sonucu'],toolResultTitle:['{tool} · {server}','{tool} · {server}'],toolResultArgs:['Arguments','Argümanlar'],toolResultText:['Result given to the model','Modele verilen sonuç'],toolResultError:['The tool reported an error.','Araç bir hata bildirdi.'],
 apiIntro:['Let other programs on this computer use your local models.','Bu bilgisayardaki diğer programların yerel modellerini kullanmasına izin ver.'],
 apiRules:['OpenAI-compatible: GET /v1/models and POST /v1/chat/completions (streaming too). Listens on 127.0.0.1 only and needs the token below. Requests share the engine with your chats, one at a time. Cloud models are not offered here.','OpenAI uyumlu: GET /v1/models ve POST /v1/chat/completions (akış dahil). Yalnızca 127.0.0.1’de dinler ve aşağıdaki jetonu ister. İstekler motoru sohbetlerinle paylaşır, sırayla çalışır. Bulut modelleri burada sunulmaz.'],
 apiEnable:['Local API server','Yerel API sunucusu'],apiEnableHint:['Off by default.','Varsayılan olarak kapalı.'],apiPort:['Port','Port'],apiSavePort:['Save port','Portu kaydet'],apiAddress:['Address','Adres'],apiToken:['API key','API anahtarı'],
 apiCopy:['Copy','Kopyala'],apiCopied:['Copied','Kopyalandı'],apiNewToken:['New key','Yeni anahtar'],apiNewTokenDone:['A new key was made; the old one no longer works.','Yeni anahtar oluşturuldu; eskisi artık çalışmaz.'],
 apiRunning:['Running · {n} requests','Çalışıyor · {n} istek'],apiStopped:['Off','Kapalı'],apiExample:['Example','Örnek'],apiShow:['Show','Göster'],apiHide:['Hide','Gizle'],
});
let connectionsState=null,toolsMode=false,cloudLoaded=new Map();
const isCloudModel=name=>/^cloud:/.test(String(name||''));
const cloudOf=name=>state.models.find(m=>m.Name===name)?.Cloud||null;
async function loadConnections(){try{connectionsState=await api.connections('get');}catch(e){connectionsState=null;}return connectionsState;}

// ---------- Settings sections ----------
Object.assign(sectionNames,{cloud:'cloudTitle',mcp:'mcpTitle',api:'apiTitle'});
(function addSections(){
 if($('cloud-panel'))return;
 const after=document.querySelector('#settings-nav [data-setting="browser"]');
 const label=el('div','settings-label',t('connectionsLabel'));label.id='connections-label';
 const buttons=[['cloud','cloud','cloudTitle'],['mcp','plug','mcpTitle'],['api','server','apiTitle']].map(([id,ic,key])=>{const b=el('button');b.dataset.setting=id;b.append(icon(ic),el('span','',t(key)));b.onclick=()=>openSettings(id);return b;});
 after.after(label,...buttons);
 for(const id of ['cloud','mcp','api']){const panel=el('section','settings-panel connect-panel');panel.id=id+'-panel';panel.hidden=true;$('settings-page').append(panel);}
})();
const connectOpenSettings=openSettings;openSettings=function(section,animate){
 connectOpenSettings(section,animate);for(const id of ['cloud','mcp','api'])$(id+'-panel').hidden=state.setting!==id;
 if(['cloud','mcp','api'].includes(state.setting)){$('chat-title').textContent=t(sectionNames[state.setting]);loadConnections().then(paintConnections);}
};
function paintConnections(){if(!connectionsState)return;if(state.setting==='cloud')paintCloud();else if(state.setting==='mcp')paintMcp();else if(state.setting==='api')paintApi();}
function connHeading(title,intro){const head=el('div','settings-heading');head.append(el('h1','',t(title)),el('p','',t(intro)));return head;}
function switchRow(title,hint,checked,onchange,id){const row=el('div','setting-row'),text=el('div'),sw=el('label','switch'),box=el('input');box.type='checkbox';box.checked=checked;if(id)box.id=id;box.onchange=()=>onchange(box.checked,box);text.append(el('h3','',t(title)),el('p','',t(hint)));sw.append(box,el('span'));row.append(text,sw);return row;}
async function connAction(action,args,success){try{connectionsState=await api.connections(action,args);if(success)toast(success);paintConnections();await refreshCloudModels();return true;}catch(e){toast(cleanError(e));paintConnections();return false;}}
// The model menu: cloud models come from main with the model list.
async function refreshCloudModels(){try{state.models=await api.request('models');renderPickers();renderToolChips();}catch{}}

function paintCloud(){
 const c=connectionsState.cloud,panel=$('cloud-panel');
 const consent=el('div','connect-consent');consent.hidden=true;consent.id='cloud-consent';
 const yes=el('button','primary',t('cloudConsentYes')),no=el('button','secondary',t('cloudConsentNo'));yes.type=no.type='button';
 consent.append(el('strong','',t('cloudConsentTitle')),el('p','',t('cloudPrivacy')),(()=>{const a=el('div','dialog-actions');a.append(no,yes);return a;})());
 const toggle=switchRow('cloudEnable','cloudEnableHint',c.enabled,(on,box)=>{if(on&&!c.consented){box.checked=false;consent.hidden=false;yes.focus();return;}connAction('cloud',{enabled:on});},'cloud-enabled');
 yes.onclick=()=>connAction('cloud',{enabled:true,consented:true});no.onclick=()=>{consent.hidden=true;};
 const providers=el('div','connect-list');
 for(const [id,p] of Object.entries(c.providers))providers.append(providerCard(id,p));
 providers.hidden=!c.enabled;
 panel.replaceChildren(connHeading('cloudTitle','cloudIntro'),el('p','connect-rules',t('cloudPrivacy')),toggle,consent,providers);
}
function providerCard(id,p){
 const card=el('div','connect-card'),head=el('div','connect-card-head');
 head.append(el('strong','',p.label),el('small','quiet',p.key?t('cloudKeySaved'):(id==='custom'?'':t('cloudKeyNone'))));card.append(head);
 if(id==='custom'){
  const label=el('input');label.placeholder=t('cloudLabel');label.value=p.label==='Custom'?'':p.label;label.maxLength=40;
  const base=el('input');base.placeholder=t('cloudBase');base.value=p.base||'';base.spellcheck=false;
  const save=el('button','secondary',t('cloudSaveBase'));save.type='button';save.onclick=()=>connAction('provider',{provider:id,base:base.value,label:label.value||'Custom'});
  const row=el('div','connect-inline');row.append(label,base,save);card.append(row);
 }
 const key=el('input');key.type='password';key.autocomplete='off';key.spellcheck=false;key.placeholder=t('cloudKey')+(p.keyHint?' · '+p.keyHint:'');key.dataset.provider=id;
 const saveKey=el('button','secondary',t('cloudKeySave'));saveKey.type='button';saveKey.onclick=()=>{if(!key.value.trim())return;connAction('provider',{provider:id,key:key.value},null);key.value='';};
 const keyRow=el('div','connect-inline');keyRow.append(key,saveKey);
 if(p.key){const remove=el('button','text-button',t('cloudKeyRemove'));remove.type='button';remove.onclick=()=>connAction('provider',{provider:id,key:''});keyRow.append(remove);}
 card.append(keyRow);
 const models=el('div','connect-models');models.append(el('span','connect-subhead',t('cloudModels')));
 const chips=el('div','connect-chips');if(!p.models.length)chips.append(el('small','quiet',t('cloudModelsNone')));
 for(const m of p.models){const chip=el('span','connect-chip'),x=el('button','skill-chip-remove','×');x.type='button';x.setAttribute('aria-label',t('mcpRemove')+' '+m);x.onclick=()=>connAction('provider',{provider:id,models:p.models.filter(n=>n!==m)});
  const test=el('button','text-button',t('cloudTest'));test.type='button';test.onclick=async()=>{test.disabled=true;try{const r=await api.connections('provider-test',{provider:id,model:m});toast(tf('cloudTestOk',{provider:p.label,reply:r.reply.slice(0,60)}));}catch(e){toast(cleanError(e));}finally{test.disabled=false;}};
  chip.append(el('code','',m),test,x);chips.append(chip);}
 models.append(chips);
 const add=el('input');add.placeholder=t('cloudModelId');add.spellcheck=false;add.dataset.provider=id;
 const addButton=el('button','secondary',t('cloudAddModel'));addButton.type='button';addButton.onclick=()=>{const v=add.value.trim();if(!v)return;connAction('provider',{provider:id,models:[...p.models,v]});};
 add.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();addButton.click();}};
 const load=el('button','text-button',t('cloudLoad'));load.type='button';
 load.onclick=async()=>{if(!p.key&&id!=='custom'){toast(t('cloudKeyFirst'));return;}load.disabled=true;try{const r=await api.connections('provider-models',{provider:id});cloudLoaded.set(id,r.models);toast(tf('cloudLoaded',{n:fmt(r.models.length)}));paintCloud();}catch(e){toast(cleanError(e));}finally{load.disabled=false;}};
 const addRow=el('div','connect-inline');addRow.append(add,addButton,load);models.append(addRow);
 const loaded=cloudLoaded.get(id);
 if(loaded?.length){
  const filter=el('input');filter.placeholder=t('cloudFilter');filter.spellcheck=false;const box=el('div','connect-loaded');
  const paint=()=>{box.replaceChildren();const q=filter.value.trim().toLowerCase();for(const m of loaded.filter(x=>x.toLowerCase().includes(q)).slice(0,80)){const b=el('button','connect-pick'+(p.models.includes(m)?' chosen':''),m);b.type='button';b.disabled=p.models.includes(m);b.onclick=()=>connAction('provider',{provider:id,models:[...p.models,m]});box.append(b);}};
  filter.oninput=paint;paint();models.append(filter,box);
 }
 card.append(models);return card;
}

function paintMcp(){
 const panel=$('mcp-panel'),servers=connectionsState.mcp.servers;
 const form=el('form','connect-card connect-add');form.noValidate=true;
 const name=el('input');name.placeholder=t('mcpName');name.maxLength=60;const url=el('input');url.placeholder=t('mcpUrl');url.spellcheck=false;url.id='mcp-url';
 const token=el('input');token.type='password';token.autocomplete='off';token.placeholder=t('mcpToken');
 const add=el('button','primary',t('mcpAdd'));add.type='submit';
 form.onsubmit=async e=>{e.preventDefault();if(!url.value.trim())return;add.disabled=true;await connAction('mcp-add',{name:name.value,url:url.value,token:token.value},t('mcpAdded'));add.disabled=false;};
 const row=el('div','connect-inline');row.append(name,url,token,add);form.append(el('span','connect-subhead',t('mcpAdd')),row);
 const list=el('div','connect-list');if(!servers.length)list.append(el('p','quiet',t('mcpNone')));
 for(const s of servers)list.append(serverCard(s));
 panel.replaceChildren(connHeading('mcpTitle','mcpIntro'),el('p','connect-rules',t('mcpRules')),form,list);
}
function serverCard(s){
 const card=el('div','connect-card mcp-server'+(s.enabled?'':' off'));card.dataset.server=s.id;
 const head=el('div','connect-card-head'),title=el('div');title.append(el('strong','',s.name),el('code','connect-url',s.url));
 const on=s.tools.filter(x=>x.enabled).length;const status=s.error?el('small','connect-error',tf('mcpError',{error:s.error})):el('small','quiet',tf('mcpToolsOn',{on:fmt(on),n:fmt(s.tools.length)})+(s.checked?' · '+tf('mcpChecked',{time:new Date(s.checked).toLocaleString(state.prefs.language==='tr'?'tr-TR':'en-GB',{dateStyle:'short',timeStyle:'short'})}):''));
 title.append(status);
 const sw=el('label','switch'),box=el('input');box.type='checkbox';box.checked=s.enabled;box.title=t('mcpServerOn');box.onchange=()=>connAction('mcp-update',{id:s.id,enabled:box.checked});sw.append(box,el('span'));
 head.append(title,sw);card.append(head);
 const actions=el('div','connect-inline');
 const refresh=el('button','secondary',t('mcpRefresh'));refresh.type='button';refresh.onclick=async()=>{refresh.disabled=true;await connAction('mcp-refresh',{id:s.id});};
 const tokenButton=el('button','text-button',s.token?t('mcpChangeToken'):t('mcpToken'));tokenButton.type='button';
 tokenButton.onclick=()=>{const input=el('input');input.type='password';input.autocomplete='off';input.placeholder=t('mcpToken');const save=el('button','secondary',t('cloudKeySave'));save.type='button';save.onclick=()=>connAction('mcp-update',{id:s.id,token:input.value});tokenButton.replaceWith(input,save);input.focus();};
 const remove=el('button','text-button danger',t('mcpRemove'));remove.type='button';remove.onclick=()=>connAction('mcp-remove',{id:s.id});
 actions.append(refresh,tokenButton,remove);card.append(actions);
 const tools=el('div','mcp-tools');
 for(const tool of s.tools){
  const row=el('div','mcp-tool'),info=el('div','mcp-tool-info');info.append(el('strong','',tool.title||tool.name),...(tool.title&&tool.title!==tool.name?[el('code','',tool.name)]:[]),...(tool.readOnly?[el('span','connect-badge',t('mcpReadOnly'))]:[]),el('small','quiet',tool.description||''));
  const mode=el('select');mode.append(new Option(t('mcpAsk'),'ask'),new Option(t('mcpAlways'),'always'));mode.value=tool.ask?'ask':'always';mode.disabled=!tool.enabled;mode.onchange=()=>connAction('mcp-update',{id:s.id,tool:{name:tool.name,ask:mode.value==='ask'}});
  const tsw=el('label','switch'),tbox=el('input');tbox.type='checkbox';tbox.checked=tool.enabled;tbox.dataset.tool=tool.name;tbox.onchange=()=>connAction('mcp-update',{id:s.id,tool:{name:tool.name,enabled:tbox.checked}});tsw.append(tbox,el('span'));
  row.append(info,mode,tsw);tools.append(row);
 }
 card.append(tools);return card;
}

function paintApi(){
 const a=connectionsState.api,panel=$('api-panel');
 const toggle=switchRow('apiEnable','apiEnableHint',a.enabled,on=>connAction('api',{enabled:on}),'api-enabled');
 const card=el('div','connect-card');card.hidden=!a.enabled;
 const status=el('p',a.running?'connect-ok':'connect-error',a.running?tf('apiRunning',{n:fmt(a.requests||0)}):(a.lastError||t('apiStopped')));status.id='api-status';
 const port=el('input');port.inputMode='numeric';port.value=String(a.port);port.maxLength=5;port.id='api-port';
 const savePort=el('button','secondary',t('apiSavePort'));savePort.type='button';savePort.onclick=()=>connAction('api',{port:Number(port.value)});
 const portRow=el('div','connect-inline');portRow.append(el('span','connect-subhead',t('apiPort')),port,savePort);
 const address=a.address||('http://127.0.0.1:'+a.port+'/v1');
 const copy=(text,button)=>{api.copy(text).then(()=>{const old=button.textContent;button.textContent=t('apiCopied');setTimeout(()=>button.textContent=old,1200);}).catch(()=>{});};
 const addrRow=el('div','connect-inline'),addrCopy=el('button','text-button',t('apiCopy'));addrCopy.type='button';addrCopy.onclick=()=>copy(address,addrCopy);addrRow.append(el('span','connect-subhead',t('apiAddress')),el('code','connect-url',address),addrCopy);
 const tokenCode=el('code','connect-url','•'.repeat(24));tokenCode.id='api-token';let shown=false;
 const show=el('button','text-button',t('apiShow'));show.type='button';show.onclick=()=>{shown=!shown;tokenCode.textContent=shown?a.token:'•'.repeat(24);show.textContent=t(shown?'apiHide':'apiShow');};
 const tokCopy=el('button','text-button',t('apiCopy'));tokCopy.type='button';tokCopy.onclick=()=>copy(a.token,tokCopy);
 const renew=el('button','text-button',t('apiNewToken'));renew.type='button';renew.onclick=()=>connAction('api',{newToken:true},t('apiNewTokenDone'));
 const tokRow=el('div','connect-inline');tokRow.append(el('span','connect-subhead',t('apiToken')),tokenCode,show,tokCopy,renew);
 const sample=`curl ${address}/chat/completions -H "Authorization: Bearer $LUMEN_KEY" -H "Content-Type: application/json" -d "{\\"model\\":\\"${state.models.find(m=>m.Installed&&!m.Cloud)?.Name||'model'}\\",\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"Hello\\"}]}"`;
 const example=el('details','connect-example');example.append(el('summary','',t('apiExample')),(()=>{const pre=el('pre');pre.append(el('code','',sample));return pre;})());
 card.append(status,portRow,addrRow,tokRow,example);
 panel.replaceChildren(connHeading('apiTitle','apiIntro'),el('p','connect-rules',t('apiRules')),toggle,card);
}

// ---------- Composer: connected tools ----------
(function addMenuItem(){
 if($('use-tools'))return;const button=el('button');button.id='use-tools';button.type='button';button.setAttribute('role','menuitem');
 const text=el('span');text.append(el('strong','',t('toolsMenu')),el('small','',t('toolsMenuHint')));button.append(icon('plug'),text);
 ($('use-research')||$('attach-files')).after(button);
 button.onclick=async()=>{closeComposerMenus();if(state.busy)return;if(toolsMode){toolsMode=false;renderToolChips();return;}await loadConnections();const on=activeToolCount();if(!on){toast(t('toolsNoneOn'));openSettings('mcp');return;}toolsMode=true;if(typeof imageMode!=='undefined')imageMode=false;renderToolChips();$('prompt').focus();};
})();
function activeToolCount(){const image=typeof imagesState!=='undefined'&&imagesState?.settings.tool&&typeof imageChoices==='function'&&imageChoices().length?1:0;return image+(connectionsState?.mcp.servers||[]).filter(s=>s.enabled).reduce((n,s)=>n+s.tools.filter(x=>x.enabled).length,0);}
function anyAlways(){return (connectionsState?.mcp.servers||[]).some(s=>s.enabled&&s.tools.some(x=>x.enabled&&!x.ask));}
const connectRenderChips=renderToolChips;renderToolChips=function(){
 connectRenderChips();if(!toolsMode)return;const box=$('tool-chips');box.hidden=false;
 const chip=el('div','skill-chip tool-chip tools-chip'),remove=el('button','skill-chip-remove','×');remove.type='button';remove.title=t('toolsRemove');remove.setAttribute('aria-label',t('toolsRemove'));remove.disabled=state.busy;remove.onclick=()=>{toolsMode=false;renderToolChips();$('prompt').focus();};
 chip.append(icon('plug'),el('span','skill-chip-name',tf('toolsChip',{n:fmt(activeToolCount())})),el('small','tool-chip-note',t(anyAlways()?'toolsChipAlways':'toolsChipNote')),remove);box.append(chip);
};
const connectSend=send;send=async function(){
 if(state.busy)return connectSend();
 const model=$('model-picker').value;
 if(isCloudModel(model)&&(toolsMode||(typeof researchMode!=='undefined'&&researchMode)||state.chat?.Project)){toast(t('cloudLocalOnly'));return;}
 if(!toolsMode||isCloudModel(model))return connectSend();
 if(typeof photosAdding!=='undefined'&&photosAdding)return;const text=composeText();if(!text||!state.ready)return;
 const chosen=state.models.find(m=>m.Name===model);if(chosen&&!chosen.Installed&&!await download(chosen.Name))return;
 await loadConnections();if(!activeToolCount()){toast(t('toolsNoneOn'));return;}
 return sendWithAgent(text,{mode:'tools'});
};

// ---------- Approval cards ----------
const approvalCards=new Map();
listen('agent-event',event=>{
 const run=agentRun;if(!run||(event.runId&&event.runId!==run.runId))return;
 if(event.type==='approval'){
  const card=el('div','approval-card');card.setAttribute('role','group');card.setAttribute('aria-label',tf('approvalTitle',{tool:event.tool}));
  const head=el('div','approval-head');head.append(icon('plug'),el('strong','',tf('approvalTitle',{tool:event.tool})),el('small','quiet',tf('approvalServer',{server:event.server})+(event.readOnly?' · '+t('mcpReadOnly'):'')));
  const args=el('details','approval-args');args.open=true;const pre=el('pre');pre.append(el('code','',event.arguments||'{}'));args.append(el('summary','',t('approvalArgs')),pre);
  const actions=el('div','approval-actions');
  const decide=decision=>{actions.querySelectorAll('button').forEach(b=>b.disabled=true);api.agent('approve',{runId:run.runId,callId:event.callId,decision}).catch(e=>toast(cleanError(e)));};
  const deny=el('button','secondary',t('approvalDeny')),always=el('button','text-button',t('approvalAlways')),allow=el('button','primary',t('approvalAllow'));[deny,always,allow].forEach(b=>b.type='button');
  deny.onclick=()=>decide('deny');always.onclick=()=>decide('always');allow.onclick=()=>decide('allow');actions.append(always,deny,allow);
  if(event.description)card.append(head,el('p','approval-desc',event.description),args,actions);else card.append(head,args,actions);
  run.view.root.after(card);approvalCards.set(event.callId,card);allow.focus();
  if(state.chat)$('chat-scroll').scrollTop=$('chat-scroll').scrollHeight;
 }else if(event.type==='approval-done'){
  const card=approvalCards.get(event.callId);approvalCards.delete(event.callId);if(!card)return;
  if(event.decision==='timeout'){card.replaceChildren(el('small','quiet',t('approvalTimeout')));setTimeout(()=>card.remove(),4000);}else card.remove();
 }else if(event.type==='end'){for(const card of approvalCards.values())card.remove();approvalCards.clear();}
});

// ---------- Activity and sources for tool runs ----------
const connectOpText=opText;opText=function(op){
 if(op.kind!=='mcp')return connectOpText(op);
 if(op.status==='declined')return tf('opMcpDeclined',{tool:op.label});if(op.status==='waiting')return tf('opMcpWaiting',{tool:op.label});
 const server=String(op.detail||'').split(' · ')[0];const rest=String(op.detail||'').split(' · ').slice(1).join(' · ');
 return tf('opMcp',{tool:op.label,server})+(op.status==='failed'?' · '+t('opFailed')+(rest?': '+rest:''):'');
};
const connectPaintActivity=paintActivity;paintActivity=function(view){
 connectPaintActivity(view);const d=view.data;if(d.route!=='tools')return;
 const task=d.tasks[0],last=task?.ops?.[task.ops.length-1];
 if(d.ended){const n=(d.sources||[]).filter(s=>s.tool).length||(task?.ops||[]).filter(o=>o.kind==='mcp'&&o.status==='done').length;view.label.textContent=d.cancelled?t('actStopped'):t('actToolsDone');view.meta.textContent=n?tf('toolResults',{n:fmt(n)}):'';}
 else if(d.phase==='synthesizing')view.label.textContent=t('actSynth');
 else if(last?.kind==='mcp'&&last.status==='waiting')view.label.textContent=tf('actWaiting',{tool:last.label});
 else if(last?.kind==='mcp'&&last.status==='running')view.label.textContent=tf('opMcp',{tool:last.label,server:String(last.detail||'').split(' · ')[0]});
 else if(d.phase!=='planning'&&d.phase!=='loading')view.label.textContent=t('actTools');
 if(!d.ended)view.meta.textContent='';
 const note=view.details.querySelector('.activity-note:not(.warning)');if(note)note.remove();
};
const connectSourcesView=sourcesView;sourcesView=function(sources){
 const wrap=connectSourcesView(sources.filter(s=>!s.tool));const tools=sources.filter(s=>s.tool);if(!tools.length)return wrap;
 const list=wrap.querySelector('.source-list');
 for(const s of tools){const item=el('li','source-item tool-source'),open=el('button','source-open');open.type='button';open.append(el('span','source-id',s.id),el('span','source-title',s.title),el('span','source-meta',s.site+(s.error?' · '+t('opFailed'):'')));open.onclick=()=>showToolResult(s);item.append(open);list.append(item);}
 return wrap;
};
const connectLinkCitations=linkCitations;linkCitations=function(body,sources){
 connectLinkCitations(body,sources.filter(s=>!s.tool));const tools=new Map(sources.filter(s=>s.tool).map(s=>[s.id,s]));if(!tools.size)return;
 const walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())if(/\[T\d+\]/.test(walker.currentNode.data)&&!walker.currentNode.parentElement.closest('pre,code'))nodes.push(walker.currentNode);
 for(const node of nodes){const fragment=document.createDocumentFragment();let last=0;for(const match of node.data.matchAll(/\[(T\d+)\]/g)){const source=tools.get(match[1]);if(!source)continue;fragment.append(node.data.slice(last,match.index));const cite=el('button','citation tool-citation',match[1]);cite.type='button';cite.title=source.title+' · '+source.site;cite.onclick=()=>showToolResult(source);fragment.append(cite);last=match.index+match[0].length;}fragment.append(node.data.slice(last));node.replaceWith(fragment);}
};
const toolDialog=el('dialog','project-dialog tool-dialog');toolDialog.id='tool-dialog';document.body.append(toolDialog);
toolDialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();toolDialog.close();}});
function showToolResult(s){
 const head=el('div','project-dialog-head'),close=el('button','icon-button','×');close.type='button';close.setAttribute('aria-label',t('close'));close.onclick=()=>toolDialog.close();
 head.append(el('h2','',tf('toolResultTitle',{tool:s.title,server:s.site})),close);
 let args=s.args||'{}';try{args=JSON.stringify(JSON.parse(args),null,2);}catch{}
 const a=el('pre','excerpt');a.append(el('code','',args));const r=el('pre','excerpt tool-result');r.append(el('code','',s.text||''));
 toolDialog.replaceChildren(head,el('span','connect-subhead',t('toolResultArgs')),a,...(s.error?[el('p','connect-error',t('toolResultError'))]:[]),el('span','connect-subhead',t('toolResultText')),r);
 if(!toolDialog.open)toolDialog.showModal();
}

// ---------- Cloud model in the composer ----------
function paintCloudComposer(){
 const local=document.querySelector('.composer-local');if(!local)return;const c=cloudOf($('model-picker').value);
 local.classList.toggle('cloud',!!c);const label=local.querySelector('[data-i18n="localReply"]')||local.lastElementChild;
 if(c){local.querySelector('span[data-icon]')?.replaceChildren(icon('cloud'));if(label)label.textContent=tf('cloudReply',{provider:c.label});local.title=tf('cloudReplyTitle',{provider:c.label});}
 else{local.querySelector('span[data-icon]')?.replaceChildren(icon('lock'));if(label)label.textContent=t('localReply');local.removeAttribute('title');}
}
const connectModelLogo=modelLogo;modelLogo=function(repo,name=''){if(/^cloud\//.test(String(repo||''))){const box=el('span','family-mark model-logo generic-logo cloud-logo');box.setAttribute('aria-hidden','true');box.append(icon('cloud'));return box;}return connectModelLogo(repo,name);};
$('model-picker').addEventListener('change',()=>{paintCloudComposer();if(typeof paintVisionOffer==='function')paintVisionOffer();});
const connectRenderPickers=renderPickers;renderPickers=function(){connectRenderPickers();paintCloudComposer();};
if(typeof paintVisionOffer==='function'){const connectVision=paintVisionOffer;paintVisionOffer=function(){if(!cloudOf($('model-picker').value))return connectVision();const hint=$('photo-mode-hint');visionOffer.hidden=true;if(!hint.hidden)hint.textContent=t('cloudPhotos');};}
const connectRenderContext=renderContext;renderContext=function(){
 connectRenderContext();const c=state.contexts.get(state.chat?.Id);if(!c?.Cloud)return;
 $('context-text').textContent=c.Counted?`${fmt(c.Prompt+c.Generated)} · ${c.Cloud}`:c.Cloud;$('context-percent').textContent='—';$('mini-fill').style.width='0%';$('input-fill').style.width='0%';$('output-fill').style.width='0%';$('window-tokens').textContent='—';
 $('context-detail').textContent=c.Counted?tf('cloudContext',{provider:c.Cloud}):tf('cloudContextNone',{provider:c.Cloud});
};
const connectSetBusy=setBusy;setBusy=function(busy,operation){connectSetBusy(busy,operation);const b=$('use-tools');if(b)b.disabled=busy;};
const connectLocalize=localize;localize=function(){
 connectLocalize();const label=$('connections-label');if(label)label.textContent=t('connectionsLabel');
 for(const [id,key] of [['cloud','cloudTitle'],['mcp','mcpTitle'],['api','apiTitle']]){const s=document.querySelector(`#settings-nav [data-setting="${id}"] span:last-child`);if(s)s.textContent=t(key);}
 const b=$('use-tools');if(b){b.querySelector('strong').textContent=t('toolsMenu');b.querySelector('small').textContent=t('toolsMenuHint');}
 if(state.ready){paintCloudComposer();renderToolChips();if(state.page==='settings'&&['cloud','mcp','api'].includes(state.setting))paintConnections();}
};
loadConnections();
