'use strict';
// Image generation (imagegen.cjs): Settings → Images (engine, models, cloud image models, defaults, the create_image tool),
// "+ → Create image" in the composer, a live preview while the picture is made, and pictures under the reply with
// Save / Copy / full size. Local pictures never leave this computer; with a cloud image model the prompt goes to that provider.
Object.assign(paths,{image:'M3 4h12v10H3zM3 12l3.5-3.5 3 3 2-2L15 13M11.5 7.2h.01'});
Object.assign(translations,{
 imagesTitle:['Images','Görseller'],imagesIntro:['Create pictures from text, on this computer or with a cloud provider.','Metinden görsel oluştur; bu bilgisayarda ya da bir bulut sağlayıcısıyla.'],
 imagesPrivacy:['Local image models run on this computer; nothing is uploaded. With a cloud image model, the prompt is sent to that provider and the picture comes back.','Yerel görsel modelleri bu bilgisayarda çalışır, hiçbir şey yüklenmez. Bulut görsel modelinde istem o sağlayıcıya gider ve görsel geri gelir.'],
 imgEngine:['IMAGE ENGINE','GÖRSEL MOTORU'],imgEngineHint:['stable-diffusion.cpp {tag}, official build, checked with SHA-256.','stable-diffusion.cpp {tag}, resmi derleme, SHA-256 ile doğrulanır.'],
 imgEngine_vulkan:['Any recent GPU (NVIDIA, AMD, Intel). Recommended.','Güncel her GPU (NVIDIA, AMD, Intel). Önerilen.'],imgEngine_cuda12:['NVIDIA only; large download.','Yalnızca NVIDIA; büyük indirme.'],imgEngine_cpu:['No GPU. Works everywhere, much slower.','GPU yok. Her yerde çalışır, çok daha yavaş.'],
 imgInstall:['Install','Kur'],imgInstalled:['Installed','Kurulu'],imgInUse:['In use','Kullanılıyor'],imgUse:['Use','Kullan'],imgRemove:['Remove','Kaldır'],imgChecking:['Checking…','Denetleniyor…'],
 imgModels:['IMAGE MODELS','GÖRSEL MODELLERİ'],imgDownload:['Download · {size}','İndir · {size}'],imgReady:['Ready','Hazır'],imgDownloading:['Downloading…','İndiriliyor…'],imgDefault:['Default','Varsayılan'],
 imgPackageNote:['{by} · {license} · {steps} steps · three files (image model, text encoder, decoder)','{by} · {license} · {steps} adım · üç dosya (görsel modeli, metin kodlayıcı, çözücü)'],
 imgFitGpu:['Fits your GPU memory ({vram}).','GPU belleğine sığar ({vram}).'],imgFitMixed:['Larger than your free GPU memory ({vram}); parts run from RAM, slower.','Boş GPU belleğinden ({vram}) büyük; bir kısmı RAM’den çalışır, daha yavaş.'],
 imgCloud:['CLOUD IMAGE MODELS','BULUT GÖRSEL MODELLERİ'],imgCloudOff:['Turn on cloud models and add a key in Settings → Cloud models to use them here.','Burada kullanmak için Ayarlar → Bulut modelleri’nden bulut modellerini aç ve anahtar ekle.'],
 imgCloudAdd:['Image model ID, e.g. {example}','Görsel model kimliği, ör. {example}'],imgAdd:['Add','Ekle'],
 imgDefaults:['DEFAULTS','VARSAYILANLAR'],imgShape:['Shape','Biçim'],shape_square:['Square','Kare'],shape_landscape:['Landscape','Yatay'],shape_portrait:['Portrait','Dikey'],
 imgFast:['Faster, smaller pictures','Daha hızlı, daha küçük görseller'],imgFastHint:['About ¾ of the size; local models only.','Yaklaşık ¾ boyut; yalnızca yerel modeller.'],imgSteps:['Steps','Adım'],imgStepsHint:['Empty uses the model’s own (8 for Z-Image Turbo).','Boş bırakırsan modelin kendi değeri (Z-Image Turbo için 8).'],
 imgTool:['Let models create images','Modeller görsel oluşturabilsin'],imgToolHint:['Adds “create_image” to Connected tools. Each picture asks for approval unless you turn off the switch below.','Bağlı araçlara “create_image” ekler. Aşağıdaki anahtarı kapatmadıkça her görsel onay ister.'],
 imgToolAsk:['Ask before each picture','Her görselden önce sor'],
 imgMenu:['Create image','Görsel oluştur'],imgMenuHint:['Describe a picture; made with {model}','Bir görsel tarif et; {model} ile yapılır'],imgMenuNone:['Set up an image model in Settings → Images','Ayarlar → Görseller’den bir görsel modeli kur'],
 imgChip:['Image · {model}','Görsel · {model}'],imgChipNote:['{shape} · {count}','{shape} · {count}'],imgOne:['1 picture','1 görsel'],imgMany:['{n} pictures','{n} görsel'],imgRemoveChip:['Stop creating images','Görsel oluşturmayı kapat'],
 imgPlaceholder:['Describe the picture…','Görseli tarif et…'],imgOptions:['Image options','Görsel seçenekleri'],imgModel:['Model','Model'],imgCount:['Pictures','Görsel sayısı'],imgSeed:['Seed (empty = random)','Seed (boş = rastgele)'],imgNegative:['Avoid (negative prompt, local only)','Kaçınılacaklar (negatif istem, yalnızca yerel)'],
 imgLoading:['Loading the image model…','Görsel modeli yükleniyor…'],imgStep:['Making the picture · step {step} of {total}','Görsel yapılıyor · adım {step}/{total}'],imgCloudWait:['Waiting for {provider}…','{provider} bekleniyor…'],imgStarting:['Starting…','Başlıyor…'],
 imgDone:['{n} picture(s) in {s} s','{n} görsel, {s} sn'],imgSave:['Save','Kaydet'],imgCopy:['Copy','Kopyala'],imgCopied:['Copied','Kopyalandı'],imgSaved:['Saved','Kaydedildi'],imgOpen:['Full size','Tam boyut'],
 imgCaption:['{label} · {size}{seed}','{label} · {size}{seed}'],imgPrompt:['Prompt','İstem'],imgUsePrompt:['Use this prompt again','Bu istemi tekrar kullan'],imgByTool:['Created by create_image','create_image ile oluşturuldu'],
 imgNoModel:['Choose an image model in Settings → Images first.','Önce Ayarlar → Görseller’den bir görsel modeli seç.'],imgBusy:['Busy','Meşgul'],
 imgEngineFirst:['Install the image engine first.','Önce görsel motorunu kur.'],imgInstallFailed:['Image engine: {error}','Görsel motoru: {error}'],
});
let imagesState=null,imageMode=false,imageOptions={count:1,seed:'',negative:''},imageRun=null;
async function loadImages(){try{imagesState=await api.images('status');}catch{imagesState=null;}return imagesState;}
const gb=bytes=>bytes<1073741824?Math.round(bytes/1048576).toLocaleString(state.prefs.language==='tr'?'tr-TR':'en-US')+' MB':(bytes/1073741824).toLocaleString(state.prefs.language==='tr'?'tr-TR':'en-US',{maximumFractionDigits:1})+' GB';
function imageModelLabel(id){if(!imagesState)return '';if(id.startsWith('local:')){const p=imagesState.packages.find(x=>'local:'+x.id===id);return p?p.name+' · '+p.variant:id;}const m=/^cloud:([a-z]+)\/(.+)$/.exec(id);return m?m[2]+' · '+(connectionsState?.cloud.providers[m[1]]?.label||m[1]):id;}
// Models that can be used right now.
function imageChoices(){
 if(!imagesState)return [];const out=[];const engine=imagesState.engines.some(e=>e.installed);
 for(const p of imagesState.packages)if(p.ready&&engine)out.push({id:'local:'+p.id,label:p.name+' · '+p.variant,local:true});
 const c=connectionsState?.cloud;if(c?.enabled)for(const [prov,list] of Object.entries(imagesState.cloudModels||{}))if(c.providers[prov]?.key||prov==='custom')for(const m of list)out.push({id:'cloud:'+prov+'/'+m,label:m+' · '+c.providers[prov].label,local:false});
 return out;
}
function currentImageModel(){const choices=imageChoices();const want=imagesState?.settings.model;return choices.find(c=>c.id===want)||choices[0]||null;}

// ---------- Settings → Images ----------
sectionNames.images='imagesTitle';
(function addSection(){
 if($('images-panel'))return;const after=document.querySelector('#settings-nav [data-setting="library"]');
 const nav=el('button');nav.dataset.setting='images';nav.append(icon('image'),el('span','',t('imagesTitle')));nav.onclick=()=>openSettings('images');after.after(nav);
 const panel=el('section','settings-panel connect-panel');panel.id='images-panel';panel.hidden=true;$('settings-page').append(panel);
})();
const imagesOpenSettings=openSettings;openSettings=function(section,animate){
 imagesOpenSettings(section,animate);$('images-panel').hidden=state.setting!=='images';
 if(state.setting==='images'){$('chat-title').textContent=t('imagesTitle');Promise.all([loadImages(),loadConnections(),api.modelsInfo('fit',{items:[]}).catch(()=>null)]).then(([,,fit])=>{imageHardware=fit?.hardware||null;paintImages();});}
};
let imageHardware=null;
function paintImages(){
 const panel=$('images-panel');if(panel.hidden||!imagesState)return;const s=imagesState;
 const head=el('div','settings-heading');head.append(el('h1','',t('imagesTitle')),el('p','',t('imagesIntro')));
 // Engine
 const engine=el('div','connect-card');engine.append(el('span','connect-subhead',t('imgEngine')),el('small','quiet',tf('imgEngineHint',{tag:s.tag})));
 for(const e of s.engines){
  const row=el('div','img-row'),info=el('div','img-row-info');info.append(el('strong','',e.label+' · '+gb(e.size)),el('small','quiet',t('imgEngine_'+e.id)));
  const actions=el('div','connect-inline');const using=s.settings.engine===e.id&&e.installed;
  if(s.install?.kind===e.id){const bar=el('progress');bar.max=s.install.total||1;bar.value=s.install.bytes||0;actions.append(el('small','quiet',s.install.phase==='checking'?t('imgChecking'):Math.round((s.install.bytes||0)/(s.install.total||1)*100)+'%'),bar);const stop=el('button','text-button',t('cancel'));stop.type='button';stop.onclick=()=>api.images('cancel');actions.append(stop);}
  else if(e.installed){actions.append(el('span','connect-badge',t(using?'imgInUse':'imgInstalled')));if(!using){const use=el('button','secondary',t('imgUse'));use.type='button';use.onclick=()=>imgAction('install',{kind:e.id});actions.append(use);}const rm=el('button','text-button danger',t('imgRemove'));rm.type='button';rm.onclick=()=>imgAction('remove-engine',{kind:e.id});actions.append(rm);}
  else{const b=el('button',e.id==='vulkan'?'primary':'secondary',t('imgInstall'));b.type='button';b.dataset.engine=e.id;b.disabled=!!s.install;b.onclick=()=>imgAction('install',{kind:e.id});actions.append(b);}
  row.append(info,actions);engine.append(row);
 }
 // Models
 const models=el('div','connect-card');models.append(el('span','connect-subhead',t('imgModels')));
 const free=imageHardware?.vramFree||0;
 for(const p of s.packages){
  const row=el('div','img-row'),info=el('div','img-row-info');const id='local:'+p.id;
  info.append(el('strong','',p.name+' · '+p.variant+' · '+gb(p.size)),el('small','quiet',tf('imgPackageNote',{by:p.by,license:p.license,steps:p.steps})));
  if(free)info.append(el('small','quiet',tf((p.peak||p.size)<=free?'imgFitGpu':'imgFitMixed',{vram:gb(free)})));
  const actions=el('div','connect-inline');
  if(p.ready){actions.append(el('span','connect-badge',t(s.settings.model===id?'imgDefault':'imgReady')));if(s.settings.model!==id){const use=el('button','secondary',t('imgUse'));use.type='button';use.onclick=()=>imgSettings({model:id});actions.append(use);}const rm=el('button','text-button danger',t('imgRemove'));rm.type='button';rm.onclick=()=>imgAction('remove-model',{id:p.id});actions.append(rm);}
  else if(p.downloading)actions.append(el('small','quiet',t('imgDownloading')));
  else{const b=el('button','primary',tf('imgDownload',{size:gb(p.missing)}));b.type='button';b.dataset.package=p.id;b.onclick=()=>imgAction('download',{id:p.id});actions.append(b);}
  row.append(info,actions);models.append(row);
 }
 // Cloud
 const cloudCard=el('div','connect-card');cloudCard.append(el('span','connect-subhead',t('imgCloud')));
 const c=connectionsState?.cloud,examples={openai:'gpt-image-1',gemini:'gemini-2.5-flash-image',openrouter:'',custom:'gpt-image-1'};
 const usable=c?.enabled?Object.entries(c.providers).filter(([id,p])=>(p.key||id==='custom'&&p.base)&&['openai','gemini','custom'].includes(id)):[];
 if(!usable.length)cloudCard.append(el('small','quiet',t('imgCloudOff')));
 for(const [prov,p] of usable){
  const list=s.cloudModels[prov]||[];const row=el('div','connect-models');row.append(el('strong','',p.label));const chips=el('div','connect-chips');
  for(const m of list){const chip=el('span','connect-chip'),x=el('button','skill-chip-remove','×');x.type='button';x.onclick=()=>imgSettings({cloudModels:{...s.cloudModels,[prov]:list.filter(v=>v!==m)}});const use=el('button','text-button',s.settings.model==='cloud:'+prov+'/'+m?t('imgDefault'):t('imgUse'));use.type='button';use.onclick=()=>imgSettings({model:'cloud:'+prov+'/'+m});chip.append(el('code','',m),use,x);chips.append(chip);}
  const input=el('input');input.placeholder=tf('imgCloudAdd',{example:examples[prov]||'model-id'});input.spellcheck=false;const add=el('button','secondary',t('imgAdd'));add.type='button';add.onclick=()=>{const v=input.value.trim();if(v)imgSettings({cloudModels:{...s.cloudModels,[prov]:[...list,v]}});};input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();add.click();}};
  const line=el('div','connect-inline');line.append(input,add);row.append(chips,line);cloudCard.append(row);
 }
 // Defaults and the tool
 const defaults=el('div','connect-card');defaults.append(el('span','connect-subhead',t('imgDefaults')));
 const shapes=el('div','img-shapes');for(const sh of ['square','landscape','portrait']){const b=el('button','img-shape'+(s.settings.shape===sh?' active':''),t('shape_'+sh));b.type='button';b.setAttribute('aria-pressed',String(s.settings.shape===sh));b.onclick=()=>imgSettings({shape:sh});shapes.append(b);}
 const shapeRow=el('div','img-row');shapeRow.append(el('strong','',t('imgShape')),shapes);
 const steps=el('input');steps.id='img-steps';steps.inputMode='numeric';steps.placeholder='8';steps.value=s.settings.steps??'';steps.onchange=()=>{const v=steps.value.trim();imgSettings({steps:v?Number(v):null});};
 const stepsRow=el('div','img-row');const si=el('div','img-row-info');si.append(el('strong','',t('imgSteps')),el('small','quiet',t('imgStepsHint')));stepsRow.append(si,steps);
 defaults.append(shapeRow,switchRow('imgFast','imgFastHint',s.settings.fast,on=>imgSettings({fast:on})),stepsRow,switchRow('imgTool','imgToolHint',s.settings.tool,on=>imgSettings({tool:on}),'img-tool'));
 if(s.settings.tool)defaults.append(switchRow('imgToolAsk','imgToolHint',s.settings.toolAsk,on=>imgSettings({toolAsk:on})));
 panel.replaceChildren(head,el('p','connect-rules',t('imagesPrivacy')),engine,models,cloudCard,defaults);
}
async function imgAction(action,args){try{imagesState=await api.images(action,args);}catch(e){if(!/Cancelled/.test(e.message))toast(tf('imgInstallFailed',{error:cleanError(e)}));await loadImages();}paintImages();renderToolChips();}
async function imgSettings(patch){try{imagesState=await api.images('settings',patch);}catch(e){toast(cleanError(e));}paintImages();renderToolChips();}
api.onChannel('image-event',e=>{
 if(e.type==='install'){if(imagesState)imagesState.install=['done','failed','cancelled'].includes(e.phase)?null:{kind:e.kind,phase:e.phase,bytes:e.bytes,total:e.total};if(e.error)toast(tf('imgInstallFailed',{error:e.error}));if(['done','failed','cancelled'].includes(e.phase))loadImages().then(paintImages);else paintImages();return;}
 if(e.type==='models'){if(e.error&&!/Cancelled/.test(e.error))toast(e.error);loadImages().then(()=>{paintImages();renderToolChips();});return;}
 if(e.type==='progress'&&imageRun)paintImageProgress(e);
});
api.onChannel('download-event',e=>{if(state.page==='settings'&&state.setting==='images'&&['completed','failed','cancelled','paused'].includes(e.phase))loadImages().then(paintImages);});

// ---------- Composer ----------
(function addMenuItem(){
 if($('create-image'))return;const button=el('button');button.id='create-image';button.type='button';button.setAttribute('role','menuitem');
 const text=el('span');text.append(el('strong','',t('imgMenu')),el('small','',t('imgMenuNone')));button.append(icon('image'),text);
 ($('use-tools')||$('attach-files')).after(button);
 button.onclick=async()=>{closeComposerMenus();if(state.busy)return;if(imageMode){imageMode=false;renderToolChips();return;}await Promise.all([loadImages(),loadConnections()]);if(!currentImageModel()){toast(t('imgNoModel'));openSettings('images');return;}imageMode=true;if(typeof toolsMode!=='undefined')toolsMode=false;renderToolChips();$('prompt').focus();};
})();
const imagesCloseMenus=closeComposerMenus;closeComposerMenus=function(...args){imagesCloseMenus(...args);const b=$('create-image');if(b&&imagesState){const m=currentImageModel();b.querySelector('small').textContent=m?tf('imgMenuHint',{model:m.label}):t('imgMenuNone');}};
const imagesRenderChips=renderToolChips;renderToolChips=function(){
 imagesRenderChips();$('prompt').placeholder=imageMode?t('imgPlaceholder'):($('prompt').dataset.placeholder||$('prompt').placeholder);
 if(!imageMode)return;const m=currentImageModel();if(!m){imageMode=false;return;}
 const box=$('tool-chips');box.hidden=false;const chip=el('div','skill-chip tool-chip image-chip'),open=el('button','project-chip-open'),remove=el('button','skill-chip-remove','×');
 open.type='button';open.title=t('imgOptions');open.append(icon('image'),el('span','skill-chip-name',tf('imgChip',{model:m.label})),el('small','tool-chip-note',tf('imgChipNote',{shape:t('shape_'+(imagesState.settings.shape||'square')),count:imageOptions.count>1?tf('imgMany',{n:imageOptions.count}):t('imgOne')})+(m.local?'':' · '+t('cloudModelTag'))));open.onclick=openImageOptions;
 remove.type='button';remove.title=t('imgRemoveChip');remove.setAttribute('aria-label',t('imgRemoveChip'));remove.disabled=state.busy;remove.onclick=()=>{imageMode=false;renderToolChips();$('prompt').focus();};
 chip.append(open,remove);box.append(chip);
};
if(!$('prompt').dataset.placeholder)$('prompt').dataset.placeholder=$('prompt').placeholder;
const imageDialog=el('dialog','project-dialog image-options');imageDialog.id='image-options';document.body.append(imageDialog);
imageDialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();imageDialog.close();}});
function openImageOptions(){
 const s=imagesState.settings,head=el('div','project-dialog-head'),close=el('button','icon-button','×');close.type='button';close.setAttribute('aria-label',t('close'));close.onclick=()=>imageDialog.close();head.append(el('h2','',t('imgOptions')),close);
 const field=(label,input)=>{const w=el('label','assistant-field');w.append(el('span','',label),input);return w;};
 const model=el('select');model.id='image-model';for(const c of imageChoices())model.append(new Option(c.label+(c.local?'':' · '+t('cloudModelTag')),c.id));model.value=currentImageModel()?.id||'';model.onchange=()=>imgSettings({model:model.value});
 const shape=el('select');shape.id='image-shape';for(const sh of ['square','landscape','portrait'])shape.append(new Option(t('shape_'+sh),sh));shape.value=s.shape;shape.onchange=()=>imgSettings({shape:shape.value});
 const count=el('select');count.id='image-count';for(const n of [1,2,3,4])count.append(new Option(String(n),String(n)));count.value=String(imageOptions.count);count.onchange=()=>{imageOptions.count=Number(count.value);renderToolChips();};
 const seed=el('input');seed.id='image-seed';seed.inputMode='numeric';seed.value=imageOptions.seed;seed.onchange=()=>{imageOptions.seed=seed.value.trim();};
 const negative=el('input');negative.id='image-negative';negative.value=imageOptions.negative;negative.onchange=()=>{imageOptions.negative=negative.value;};
 const grid=el('div','assistant-grid');grid.append(field(t('imgModel'),model),field(t('imgShape'),shape),field(t('imgCount'),count),field(t('imgSeed'),seed));
 imageDialog.replaceChildren(head,grid,field(t('imgNegative'),negative));if(!imageDialog.open)imageDialog.showModal();
}
// Sending in image mode: the message is the prompt; the reply is the picture.
const imagesSend=send;send=async function(){
 if(state.busy){if(state.operation==='image'){api.images('cancel').catch(()=>{});return;}return imagesSend();}
 if(!imageMode)return imagesSend();
 const prompt=$('prompt').value.trim();if(!prompt||!state.ready)return;
 const m=currentImageModel();if(!m){toast(t('imgNoModel'));return;}
 const chat=state.chat;if(!chat.Messages.length&&!chat.CustomTitle)chat.Title=prompt.slice(0,56).replace(/\s+/g,' ');
 chat.Messages.push({Role:'user',Content:prompt,Interrupted:false});upsert(chat);$('prompt').value='';resizePrompt();
 setBusy(true,'image');renderMessages();
 const view=el('article','message assistant image-progress'),label=el('div','img-progress-label',t('imgStarting')),bar=el('div','img-progress-bar'),fill=el('span'),preview=el('img','img-preview');preview.alt='';preview.hidden=true;bar.append(fill);view.append(label,bar,preview);
 $('messages').append(view);$('chat-scroll').scrollTop=$('chat-scroll').scrollHeight;imageRun={view,label,fill,preview,chatId:chat.Id};
 const seed=/^\d{1,10}$/.test(imageOptions.seed)?Number(imageOptions.seed):undefined;
 try{const r=await api.images('generate',{chat,prompt,options:{model:m.id,count:imageOptions.count,...(seed!==undefined?{seed}:{}),negative:imageOptions.negative}});if(state.chat?.Id===chat.Id||true)upsert(r.chat);}
 catch(e){toast(cleanError(e));}
 finally{imageRun=null;setBusy(false);renderMessages();$('chat-scroll').scrollTop=$('chat-scroll').scrollHeight;}
};
function paintImageProgress(e){
 const r=imageRun;if(!r)return;
 if(e.phase==='loading')r.label.textContent=t('imgLoading');
 else if(e.phase==='cloud')r.label.textContent=tf('imgCloudWait',{provider:e.provider});
 else if(e.phase==='generating'){r.label.textContent=e.total?tf('imgStep',{step:fmt(Math.max(1,e.step)),total:fmt(e.total)}):t('imgStarting');r.fill.style.width=(e.total?Math.min(100,e.step/e.total*100):0)+'%';if(e.preview){r.preview.src=e.preview;r.preview.hidden=false;}}
}
const imagesSetBusy=setBusy;setBusy=function(busy,operation){
 imagesSetBusy(busy,operation);const b=$('create-image');if(b)b.disabled=busy;
 if(busy&&operation==='image'){$('send').disabled=false;$('send').classList.add('stopping');$('send').replaceChildren(icon('stop'));$('send').setAttribute('aria-label',t('stop'));}
};

// ---------- Pictures under replies ----------
const imagesMessageNode=messageNode;messageNode=function(m,index,stream=false){
 const result=imagesMessageNode(m,index,stream);const g=m.Generated;if(stream||!g||!g.images?.length)return result;
 const node=result.node||result;node.classList.add('has-images');
 const label=node.querySelector('.message-meta > span:nth-child(2)');if(label&&g.label){label.textContent=g.label;label.title=g.engine==='cloud'?t('cloudModelTag'):'';}
 // A picture reply cannot be regenerated as text; "Use this prompt again" is offered instead.
 node.querySelectorAll('.message-actions button').forEach(b=>{if([t('regenerate'),t('regenerateBranch')].includes(b.textContent))b.remove();});
 const body=node.querySelector('.message-body')||result.body;if(body)body.replaceChildren();
 const grid=el('div','gen-grid count-'+g.images.length);
 for(const img of g.images){
  const fig=el('figure','gen-item'),pic=el('img');pic.src='generated/'+img.sha+'.thumb.png';pic.alt=g.prompt.slice(0,200);pic.loading='lazy';pic.decoding='async';pic.width=img.width;pic.height=img.height;
  const open=el('button','gen-open');open.type='button';open.title=t('imgOpen');open.append(pic);open.onclick=()=>openGenerated(img,g);
  const bar=el('div','gen-actions'),save=el('button','text-button',t('imgSave')),copy=el('button','text-button',t('imgCopy'));save.type=copy.type='button';
  save.onclick=async()=>{try{if(await api.images('save',{sha:img.sha}))toast(t('imgSaved'));}catch(e){toast(cleanError(e));}};
  copy.onclick=async()=>{try{await api.images('copy',{sha:img.sha});copy.textContent=t('imgCopied');setTimeout(()=>copy.textContent=t('imgCopy'),1200);}catch(e){toast(cleanError(e));}};
  bar.append(save,copy);fig.append(open,bar);grid.append(fig);
 }
 const f=g.images[0],caption=el('div','gen-caption');
 caption.append(el('span','',tf('imgCaption',{label:g.label,size:f.width+'×'+f.height,seed:g.seed!=null?' · seed '+g.seed:''})+(g.seconds?' · '+fmt(g.seconds)+' s':'')+(g.tool?' · '+t('imgByTool'):'')));
 const again=el('button','text-button',t('imgUsePrompt'));again.type='button';again.onclick=()=>{$('prompt').value=g.prompt;resizePrompt();imageMode=true;renderToolChips();$('prompt').focus();};caption.append(again);
 if(g.tool){(body||node).append(grid,caption);}else{(body||node).append(grid,caption);}
 return result;
};
const genDialog=el('dialog','project-dialog gen-dialog');genDialog.id='gen-dialog';document.body.append(genDialog);
genDialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();genDialog.close();}});
function openGenerated(img,g){
 const head=el('div','project-dialog-head'),close=el('button','icon-button','×');close.type='button';close.setAttribute('aria-label',t('close'));close.onclick=()=>genDialog.close();head.append(el('h2','',g.label+' · '+img.width+'×'+img.height),close);
 const pic=el('img','gen-full');pic.src='generated/'+img.sha+'.png';pic.alt=g.prompt.slice(0,200);
 const prompt=el('p','gen-prompt');prompt.append(el('strong','',t('imgPrompt')+': '),document.createTextNode(g.prompt));
 const actions=el('div','dialog-actions'),save=el('button','secondary',t('imgSave')),copy=el('button','secondary',t('imgCopy'));save.type=copy.type='button';
 save.onclick=async()=>{try{if(await api.images('save',{sha:img.sha}))toast(t('imgSaved'));}catch(e){toast(cleanError(e));}};copy.onclick=async()=>{try{await api.images('copy',{sha:img.sha});toast(t('imgCopied'));}catch(e){toast(cleanError(e));}};
 actions.append(copy,save);genDialog.replaceChildren(head,pic,prompt,actions);if(!genDialog.open)genDialog.showModal();
}
const imagesLocalize=localize;localize=function(){
 imagesLocalize();const nav=document.querySelector('#settings-nav [data-setting="images"] span:last-child');if(nav)nav.textContent=t('imagesTitle');
 const b=$('create-image');if(b){b.querySelector('strong').textContent=t('imgMenu');}
 if(state.ready){renderToolChips();if(state.page==='settings'&&state.setting==='images')paintImages();}
};
loadImages();
