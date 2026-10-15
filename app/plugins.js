'use strict';
// Plugins (plugins.cjs): Settings → Plugins. Install from a folder, a plugin.json file or an https address; a review shows
// everything first. Tools a plugin's servers offer stay off, and assistants can only ask for them.
Object.assign(paths,{puzzle:'M7 3h4v2a1.5 1.5 0 003 0V3h1v4h-2a1.5 1.5 0 000 3h2v5H11v-2a1.5 1.5 0 00-3 0v2H3v-5h2a1.5 1.5 0 000-3H3V3z'});
Object.assign(translations,{
 pluginsTitle:['Plugins','Plugin’ler'],pluginsIntro:['Packages of skills, assistants and tool servers.','Skill, asistan ve araç sunucusu paketleri.'],
 pluginsRules:['A plugin can add skills (instructions only), assistants and MCP server addresses. It cannot turn tools on, start programs or run scripts: tools from its servers stay off, and an assistant can only ask you to turn them on. You review everything before it is installed.','Bir plugin skill (yalnızca talimat), asistan ve MCP sunucu adresi ekleyebilir. Araç açamaz, program başlatamaz, betik çalıştıramaz: sunucularının araçları kapalı kalır, asistan yalnızca açmanı isteyebilir. Kurulmadan önce her şeyi incelersin.'],
 pluginFolder:['Install from folder…','Klasörden kur…'],pluginFile:['Install plugin.json…','plugin.json kur…'],pluginUrl:['https address of a plugin.json','Bir plugin.json’un https adresi'],pluginFromUrl:['Review','İncele'],
 pluginsNone:['No plugins installed.','Kurulu plugin yok.'],pluginRemove:['Remove','Kaldır'],pluginBy:['by {author}','{author}'],
 pluginSkills:['Skills','Skill’ler'],pluginAssistants:['Assistants','Asistanlar'],pluginServers:['Tool servers','Araç sunucuları'],pluginToolsOn:['{on} of {n} tools on','{n} aracın {on} tanesi açık'],
 pluginReview:['Review plugin','Plugin’i incele'],pluginUpdate:['Updates the installed version {from}.','Kurulu {from} sürümünü günceller.'],pluginInstall:['Install','Kur'],pluginCancel:['Cancel','Vazgeç'],
 pluginWillAdd:['This plugin adds','Bu plugin şunları ekler'],pluginAsks:['asks for: {tools}','şunları istiyor: {tools}'],pluginToolsStayOff:['Tools stay off. You decide later, per tool; each call still asks for approval.','Araçlar kapalı kalır. Daha sonra araç araç sen karar verirsin; her çağrı yine onay ister.'],
 pluginServerConnect:['Lumen will connect to this address to list its tools.','Lumen araçlarını listelemek için bu adrese bağlanacak.'],pluginNotes:['Not used','Kullanılmayanlar'],pluginInstalled:['{name} installed.','{name} kuruldu.'],pluginSource:['Source: {origin}','Kaynak: {origin}'],
 pluginRefs:['{n} references','{n} referans'],
 assistantTools:['Tools it asks for','İstediği araçlar'],assistantToolsNone:['No tools available. Add an MCP server or set up Images.','Kullanılabilir araç yok. Bir MCP sunucusu ekle veya Görseller’i kur.'],
 assistantToolsCard:['{name} wants to use: {tools}','{name} şunları kullanmak istiyor: {tools}'],assistantToolsOn:['Turn on','Aç'],assistantToolsLater:['Not now','Şimdi değil'],
 assistantToolsMissing:['Some tools it asks for are not available: {tools}','İstediği bazı araçlar yok: {tools}'],assistantToolsEnabled:['Tools turned on. Each call still asks for approval.','Araçlar açıldı. Her çağrı yine onay ister.'],
 fromPlugin:['from {plugin}','{plugin} paketinden'],
 pluginCat_all:['All','Tümü'],pluginCat_docs:['Docs','Belgeler'],pluginCat_models:['Models','Modeller'],pluginCat_writing:['Writing','Yazı'],pluginCat_study:['Study','Ders'],pluginCat_images:['Images','Görseller'],
 pluginOneSkill:['1 skill','1 skill'],pluginSkillsN:['{n} skills','{n} skill'],pluginAssistantNamed:['assistant “{name}”','“{name}” asistanı'],
 pluginOnline:['Uses the internet: {host}','İnternet kullanır: {host}'],pluginOffline:['Works offline','İnternetsiz çalışır'],pluginNeedsImages:['Needs an image model (Settings → Images)','Bir görsel modeli gerekir (Ayarlar → Görseller)'],
 pluginInstalledBadge:['Added','Eklendi'],pluginStartChat:['Start a chat','Sohbet başlat'],pluginAdd:['Add','Ekle'],
 pluginAdvanced:['Install from a folder, file or address','Klasörden, dosyadan veya adresten kur'],pluginAdvancedHint:['For plugins you made or got from someone you trust.','Kendi yaptığın veya güvendiğin birinden aldığın plugin’ler için.'],pluginOthers:['OTHER INSTALLED PLUGINS','DİĞER KURULU PLUGIN’LER'],
});

// ---------- Settings → Plugins ----------
sectionNames.plugins='pluginsTitle';
(function addSection(){
 if($('plugins-panel'))return;const after=document.querySelector('#settings-nav [data-setting="assistants"]');
 const nav=el('button');nav.dataset.setting='plugins';nav.append(icon('puzzle'),el('span','',t('pluginsTitle')));nav.onclick=()=>openSettings('plugins');after.after(nav);
 const panel=el('section','settings-panel connect-panel');panel.id='plugins-panel';panel.hidden=true;$('settings-page').append(panel);
})();
let pluginList=[],pluginCatalog=[],pluginFilter='all';
const pluginsOpenSettings=openSettings;openSettings=function(section,animate){
 pluginsOpenSettings(section,animate);$('plugins-panel').hidden=state.setting!=='plugins';
 if(state.setting==='plugins'){$('chat-title').textContent=t('pluginsTitle');loadPluginPage();}
};
async function loadPluginPage(){try{[pluginList,pluginCatalog]=await Promise.all([api.plugins('list'),api.plugins('catalog')]);}catch(e){toast(cleanError(e));}paintPlugins();}
const pluginLang=()=>state.prefs.language==='tr'?'tr':'en';
const pluginIcons={docs:'book',models:'models',writing:'pencil',study:'tasks',images:'image'};
function startPluginAssistant(name){const a=(typeof assistantList!=='undefined'?assistantList:[]).find(x=>x.name===name);if(!a)return;setPage('chat');startAssistant(a);}
function paintPlugins(){
 const panel=$('plugins-panel');if(panel.hidden)return;
 const head=el('div','settings-heading');head.append(el('h1','',t('pluginsTitle')),el('p','',t('pluginsIntro')));
 // Filters
 const cats=['all',...new Set(pluginCatalog.map(c=>c.category))],filters=el('div','img-shapes plugin-filters');
 for(const c of cats){const b=el('button','img-shape'+(pluginFilter===c?' active':''),t('pluginCat_'+c));b.type='button';b.setAttribute('aria-pressed',String(pluginFilter===c));b.onclick=()=>{pluginFilter=c;paintPlugins();};filters.append(b);}
 // Cards from the list that ships with Lumen
 const grid=el('div','plugin-grid');
 for(const c of pluginCatalog.filter(c=>pluginFilter==='all'||c.category===pluginFilter)){
  const card=el('div','plugin-tile'+(c.installed?' is-added':''));card.dataset.plugin=c.id;
  const top=el('div','plugin-tile-head');const mark=el('span','plugin-mark');mark.append(icon(pluginIcons[c.category]||'puzzle'));
  top.append(mark,el('strong','',c.title[pluginLang()]||c.title.en));
  const adds=[c.skills?tf(c.skills===1?'pluginOneSkill':'pluginSkillsN',{n:c.skills}):'',...c.assistants.map(a=>tf('pluginAssistantNamed',{name:a}))].filter(Boolean).join(' · ');
  const net=el('small',c.network?'plugin-net online':'plugin-net',c.network?tf('pluginOnline',{host:c.network}):t('pluginOffline'));
  const needs=c.image?el('small','plugin-net',t('pluginNeedsImages')):null;
  const actions=el('div','plugin-tile-actions');
  if(c.installed){
   actions.append(el('span','connect-badge',t('pluginInstalledBadge')));
   if(c.assistants[0]){const go=el('button','primary',t('pluginStartChat'));go.type='button';go.onclick=()=>startPluginAssistant(c.assistants[0]);actions.append(go);}
   const rm=el('button','text-button danger',t('pluginRemove'));rm.type='button';rm.onclick=async()=>{try{pluginList=await api.plugins('remove',{id:c.id});await refreshAfterPlugins();await loadPluginPage();}catch(e){toast(cleanError(e));}};actions.append(rm);
  }else{const add=el('button','primary',t('pluginAdd'));add.type='button';add.dataset.add=c.id;add.onclick=()=>reviewPlugin(api.plugins('catalog-review',{id:c.id}));actions.append(add);}
  card.append(top,el('p','',c.summary[pluginLang()]||c.summary.en),el('small','quiet',adds),net,...(needs?[needs]:[]),actions);grid.append(card);
 }
 // Plugins installed from elsewhere
 const others=pluginList.filter(p=>!pluginCatalog.some(c=>c.id===p.id));const list=el('div','connect-list');
 for(const p of others){
  const card=el('div','connect-card plugin-card');card.dataset.plugin=p.id;const top=el('div','connect-card-head'),title=el('div');
  title.append(el('strong','',p.name+(p.version?' · '+p.version:'')),el('small','quiet',[p.author?tf('pluginBy',{author:p.author}):'',p.description].filter(Boolean).join(' · ')));
  const rm=el('button','text-button danger',t('pluginRemove'));rm.type='button';rm.onclick=async()=>{try{pluginList=await api.plugins('remove',{id:p.id});await refreshAfterPlugins();await loadPluginPage();}catch(e){toast(cleanError(e));}};
  top.append(title,rm);card.append(top);const facts=el('div','plugin-facts');
  if(p.skills.length)facts.append(el('span','',t('pluginSkills')+': '+p.skills.map(s=>s.name).join(', ')));
  if(p.assistants.length)facts.append(el('span','',t('pluginAssistants')+': '+p.assistants.map(a=>a.name).join(', ')));
  for(const s of p.servers)facts.append(el('span','',t('pluginServers')+': '+s.name+' · '+tf('pluginToolsOn',{on:fmt(s.on),n:fmt(s.tools)})));
  card.append(facts);list.append(card);
 }
 // Advanced: folder, file or address
 const advanced=el('details','connect-card plugin-advanced');advanced.append(el('summary','',t('pluginAdvanced')));
 const row=el('div','connect-inline'),folder=el('button','secondary',t('pluginFolder')),file=el('button','secondary',t('pluginFile'));folder.type=file.type='button';folder.id='plugin-folder';
 folder.onclick=()=>reviewPlugin(api.plugins('pick',{folder:true}));file.onclick=()=>reviewPlugin(api.plugins('pick',{folder:false}));row.append(folder,file);
 const urlRow=el('div','connect-inline'),url=el('input');url.placeholder=t('pluginUrl');url.spellcheck=false;url.id='plugin-url';const go=el('button','secondary',t('pluginFromUrl'));go.type='button';
 go.onclick=()=>{if(url.value.trim())reviewPlugin(api.plugins('pick-url',{url:url.value.trim()}));};url.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();go.click();}};urlRow.append(url,go);
 advanced.append(el('small','quiet',t('pluginAdvancedHint')),row,urlRow);
 panel.replaceChildren(head,filters,grid,...(others.length?[el('span','connect-subhead plugin-subhead',t('pluginOthers')),list]:[]),el('p','connect-rules',t('pluginsRules')),advanced);
}
async function refreshAfterPlugins(){try{state.skills=await api.skills('list');}catch{}if(typeof loadAssistants==='function')await loadAssistants();if(typeof loadConnections==='function')await loadConnections();if(typeof renderSkillChips==='function')renderSkillChips();}
const pluginDialog=el('dialog','project-dialog plugin-dialog');pluginDialog.id='plugin-dialog';document.body.append(pluginDialog);
pluginDialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();pluginDialog.close();}});
async function reviewPlugin(pending){
 let d;try{d=await pending;}catch(e){toast(cleanError(e));return;}if(!d)return;
 const head=el('div','project-dialog-head'),close=el('button','icon-button','×');close.type='button';close.setAttribute('aria-label',t('close'));close.onclick=()=>pluginDialog.close();
 head.append(el('h2','',t('pluginReview')),close);
 const who=el('div','project-where');who.append(el('strong','',d.name+(d.version?' · '+d.version:'')),...(d.author?[el('small','quiet',tf('pluginBy',{author:d.author}))]:[]),...(d.description?[el('p','',d.description)]:[]),el('small','quiet',tf('pluginSource',{origin:d.origin})),...(d.update?[el('small','connect-ok',tf('pluginUpdate',{from:d.update.from||'—'}))]:[]));
 const body=el('div','plugin-review');body.append(el('span','connect-subhead',t('pluginWillAdd')));
 if(d.skills.length){const ul=el('ul');for(const s of d.skills){const li=el('li');li.append(el('strong','',s.name),document.createTextNode(s.description?' — '+s.description:''),...(s.references?[el('small','quiet',' · '+tf('pluginRefs',{n:s.references}))]:[]));for(const u of s.unsupported)li.append(el('small','plugin-note',u));ul.append(li);}body.append(el('h3','',t('pluginSkills')),ul);}
 if(d.assistants.length){const ul=el('ul');for(const a of d.assistants){const li=el('li');li.append(el('strong','',a.name),document.createTextNode(a.description?' — '+a.description:''));if(a.tools.length)li.append(el('small','quiet',' · '+tf('pluginAsks',{tools:a.tools.map(x=>x.builtin||x.tool).join(', ')})));ul.append(li);}body.append(el('h3','',t('pluginAssistants')),ul);}
 if(d.servers.length){const ul=el('ul');for(const s of d.servers){const li=el('li');li.append(el('strong','',s.name),el('code','connect-url',' '+s.url),el('small','quiet',' · '+t('pluginServerConnect')));ul.append(li);}body.append(el('h3','',t('pluginServers')),ul,el('p','connect-rules',t('pluginToolsStayOff')));}
 if(d.notes.length){const ul=el('ul');for(const n of d.notes)ul.append(el('li','plugin-note',n));body.append(el('h3','',t('pluginNotes')),ul);}
 const actions=el('div','dialog-actions'),cancel=el('button','secondary',t('pluginCancel')),install=el('button','primary',t('pluginInstall'));cancel.type=install.type='button';install.id='plugin-install';
 cancel.onclick=()=>pluginDialog.close();
 install.onclick=async()=>{install.disabled=true;try{const p=await api.plugins('install',{token:d.token});pluginDialog.close();toast(tf('pluginInstalled',{name:p.name}));await refreshAfterPlugins();await loadPluginPage();}catch(e){toast(cleanError(e));install.disabled=false;}};
 actions.append(cancel,install);pluginDialog.replaceChildren(head,who,body,actions);if(!pluginDialog.open)pluginDialog.showModal();install.focus();
}

// ---------- Assistants: tool requests ----------
// After an assistant starts, the tools it asks for are offered in one card; nothing is turned on without the click.
function paintAssistantTools(a,tools){
 document.querySelector('.assistant-tools-card')?.remove();if(!tools?.length)return;
 const missing=tools.filter(x=>!x.exists),off=tools.filter(x=>x.exists&&!x.enabled),names=list=>list.map(x=>x.title||x.name).join(', ');
 if(!off.length){if(typeof toolsMode!=='undefined'&&tools.some(x=>x.enabled)){toolsMode=true;imageMode=false;renderToolChips();}if(missing.length)toast(tf('assistantToolsMissing',{tools:names(missing)}));return;}
 const card=el('div','assistant-tools-card');card.append(icon('plug'),el('span','',tf('assistantToolsCard',{name:a.name,tools:names(off)})));
 const on=el('button','primary',t('assistantToolsOn')),later=el('button','text-button',t('assistantToolsLater'));on.type=later.type='button';
 on.onclick=async()=>{try{const r=await api.assistants('enable-tools',{id:a.id});card.remove();if(typeof loadConnections==='function')await loadConnections();if(typeof loadImages==='function')await loadImages();if(typeof toolsMode!=='undefined'&&r.tools.some(x=>x.enabled)){toolsMode=true;imageMode=false;}renderToolChips();toast(t('assistantToolsEnabled'));}catch(e){toast(cleanError(e));}};
 later.onclick=()=>card.remove();card.append(later,on);if(missing.length)card.append(el('small','quiet',tf('assistantToolsMissing',{tools:names(missing)})));
 $('tool-chips').before(card);
}
if(typeof startAssistant==='function'){const pluginsStart=startAssistant;startAssistant=async function(a){
 document.querySelector('.assistant-tools-card')?.remove();assistantStartResult=null;await pluginsStart(a);
 const r=assistantStartResult;if(a&&r?.assistant&&state.chat?.Assistant?.id===a.id)paintAssistantTools(r.assistant,r.tools);
};}
// The assistant editor lists the tools an assistant may ask for.
if(typeof assistantEditor==='function'){const pluginsEditor=assistantEditor;assistantEditor=function(a){
 const form=pluginsEditor(a);const known=[];
 if(typeof imagesState!=='undefined'&&imagesState)known.push({server:'lumen',name:'create_image',label:'create_image · Lumen'});
 for(const s of (typeof connectionsState!=='undefined'&&connectionsState?connectionsState.mcp.servers:[]))for(const tool of s.tools)known.push({server:s.id,name:tool.name,label:(tool.title||tool.name)+' · '+s.name});
 for(const x of a.tools||[])if(!known.some(k=>k.server===x.server&&k.name===x.name))known.push({...x,label:x.name});
 const box=el('div','assistant-skills assistant-tools');if(!known.length)box.append(el('small','quiet',t('assistantToolsNone')));
 for(const k of known){const row=el('label','assistant-skill');const c=el('input');c.type='checkbox';c.dataset.server=k.server;c.dataset.tool=k.name;c.checked=(a.tools||[]).some(x=>x.server===k.server&&x.name===k.name);row.append(c,el('span','',k.label));box.append(row);}
 const note=form.querySelector('.assistant-note');note.before(el('span','assistant-subhead',t('assistantTools')),box);
 if(a.plugin)note.after(el('p','quiet assistant-note',tf('fromPlugin',{plugin:a.plugin})));
 return form;
};}
const pluginsLocalize=localize;localize=function(){pluginsLocalize();const nav=document.querySelector('#settings-nav [data-setting="plugins"] span:last-child');if(nav)nav.textContent=t('pluginsTitle');if(state.ready&&state.page==='settings'&&state.setting==='plugins')paintPlugins();};
