'use strict';
// Run settings for the open conversation: a panel on the right, opened from the composer footer. Every control shows the value
// the next reply will use; changing one stores an override for this chat only (conversation-run.json), and "↺" next to it
// returns to the default. "Use for new chats" makes this chat's values the defaults; "Reset" drops this chat's overrides.
// Sampling values without an override are not sent, so llama.cpp and the model keep their own defaults.
Object.assign(paths,{sliders:'M3 5h7M13 5h2M3 13h2M8 13h7M10 3v4M5 11v4',close:'M5 5l8 8M13 5l-8 8'});
Object.assign(translations,{
 runSettings:['Run settings','Çalıştırma ayarları'],runScope:['This conversation · applies from the next reply','Bu sohbet · bir sonraki yanıttan itibaren geçerli'],
 runOpen:['Run settings for this conversation','Bu sohbetin çalıştırma ayarları'],runClose:['Close','Kapat'],runCustom:['Changed for this conversation','Bu sohbet için değiştirildi'],
 runResponse:['RESPONSE','YANIT'],runInstructions:['INSTRUCTIONS','TALİMATLAR'],runAdvanced:['Advanced sampling','Gelişmiş örnekleme'],runModel:['MODEL AND MEMORY','MODEL VE BELLEK'],
 runTemperature:['Temperature','Sıcaklık'],runTemperatureHint:['Lower is steadier and repeats the likeliest words; higher varies more and can drift.','Düşük değer daha tutarlıdır, en olası kelimeleri seçer; yüksek değer daha çok çeşitlenir ve dağılabilir.'],
 runThinkingHint:['Reason before answering, if the model supports it.','Model destekliyorsa yanıt vermeden önce düşünür.'],
 runInstructionsHint:['The system prompt of this conversation. {{current_date}} becomes today’s date, for example: {date}.','Bu sohbetin sistem talimatı. {{current_date}} bugünün tarihine dönüşür, örneğin: {date}.'],
 runSaveInstructions:['Save instructions','Talimatı kaydet'],runInstructionsSaved:['Instructions saved','Talimat kaydedildi'],
 runTopP:['Top P','Top P'],runTopPHint:['Only words in the top share of probability are considered. 1 turns it off.','Yalnızca olasılığın en üst payındaki kelimeler değerlendirilir. 1 kapatır.'],
 runTopK:['Top K','Top K'],runTopKHint:['Only the K likeliest words are considered. 0 turns it off.','Yalnızca en olası K kelime değerlendirilir. 0 kapatır.'],
 runMinP:['Min P','Min P'],runMinPHint:['Drops words far less likely than the best one. 0 turns it off.','En iyisinden çok daha düşük olasılıklı kelimeleri eler. 0 kapatır.'],
 runRepeat:['Repeat penalty','Tekrar cezası'],runRepeatHint:['Above 1 discourages repeating recent words. 1 turns it off.','1’in üstü son kelimeleri tekrarlamayı azaltır. 1 kapatır.'],
 runPresence:['Presence penalty','Varlık cezası'],runPresenceHint:['Positive values push toward new topics.','Pozitif değerler yeni konulara yönlendirir.'],
 runFrequency:['Frequency penalty','Sıklık cezası'],runFrequencyHint:['Positive values reduce words the reply already used often.','Pozitif değerler yanıtın sık kullandığı kelimeleri azaltır.'],
 runSeed:['Seed','Seed'],runSeedHint:['The same seed and settings give the same reply. −1 is random.','Aynı seed ve ayarlar aynı yanıtı verir. −1 rastgeledir.'],
 runEngineDefault:['Model default','Model varsayılanı'],runDefaultShort:['Default','Varsayılan'],runResetField:['Use the default','Varsayılanı kullan'],
 runContextLine:['Context window: {value}. Changing it reloads the model.','Context penceresi: {value}. Değiştirmek modeli yeniden yükler.'],runContextAuto:['Auto · {n} tokens','Otomatik · {n} token'],runContextManual:['{n} tokens','{n} token'],
 runOpenSettings:['Context and engine settings →','Context ve motor ayarları →'],
 runReset:['Reset this conversation','Bu sohbeti sıfırla'],runMakeDefault:['Use for new chats','Yeni sohbetlerde kullan'],
 runDefaultSaved:['These settings are now the defaults for new chats.','Bu ayarlar artık yeni sohbetlerin varsayılanı.'],runResetDone:['This conversation uses the defaults again.','Bu sohbet yeniden varsayılanları kullanıyor.'],
 runThinkingUnsupported:['This model does not support thinking.','Bu model düşünmeyi desteklemiyor.'],runThinkingAlways:['This model always thinks.','Bu model her zaman düşünür.'],
 runToggle:['{temp} · {tokens}','{temp} · {tokens}'],
});
for(const node of document.querySelectorAll('[data-icon="sliders"]'))node.replaceChildren(icon('sliders'));

// Ranges for the sliders; "fallback" is where an unset slider rests (llama.cpp's usual default).
const runFields=[
 {key:'topP',label:'runTopP',hint:'runTopPHint',min:0,max:1,step:0.01,fallback:0.95},
 {key:'topK',label:'runTopK',hint:'runTopKHint',min:0,max:200,step:1,fallback:40},
 {key:'minP',label:'runMinP',hint:'runMinPHint',min:0,max:1,step:0.01,fallback:0.05},
 {key:'repeatPenalty',label:'runRepeat',hint:'runRepeatHint',min:0.5,max:2,step:0.01,fallback:1},
 {key:'presencePenalty',label:'runPresence',hint:'runPresenceHint',min:-2,max:2,step:0.05,fallback:0},
 {key:'frequencyPenalty',label:'runFrequency',hint:'runFrequencyHint',min:-2,max:2,step:0.05,fallback:0},
];
const runPresets=[['precise',0.2,'creativityPrecise'],['balanced',0.7,'creativityBalanced'],['creative',1.0,'creativityCreative']];
let runView=null,runChatId=null,runSaveTimer=0,runTicket=0;

// ---------- Footer button ----------
(function addRunToggle(){
 const wrap=document.querySelector('.composer-foot .context-wrap');if(!wrap||$('run-toggle'))return;
 const button=el('button','run-toggle');button.id='run-toggle';button.type='button';button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','run-panel');
 button.append(icon('sliders'),el('span','run-toggle-text'),el('span','run-dot'));wrap.before(button);
 button.onclick=()=>$('run-panel').hidden?openRunPanel():closeRunPanel();
})();
function paintRunToggle(){
 const button=$('run-toggle');if(!button)return;const e=runView?.effective;const text=button.querySelector('.run-toggle-text');
 if(!e){text.textContent=t('runSettings');button.classList.remove('custom');return;}
 const preset=runPresets.find(p=>p[1]===e.temperature);
 text.textContent=tf('runToggle',{temp:preset?t(preset[2]):String(e.temperature),tokens:fmt(e.responseTokens)});
 const custom=Object.keys(runView.overrides||{}).length>0;button.classList.toggle('custom',custom);button.title=t('runOpen')+(custom?' · '+t('runCustom'):'');
}

// ---------- Panel ----------
function runRow(label,hint,control,key){
 const row=el('div','run-row');const head=el('div','run-row-head');const title=el('label','',t(label));head.append(title);
 if(key){const reset=el('button','run-reset-field','↺');reset.type='button';reset.dataset.key=key;reset.title=t('runResetField');reset.setAttribute('aria-label',t('runResetField')+' · '+t(label));reset.onclick=()=>setRunValue(key,null);head.append(reset);}
 row.append(head,control);if(hint)row.append(el('p','run-hint',t(hint)));return row;
}
function runSlider(field){
 const box=el('div','run-slider');const range=el('input');range.type='range';range.min=field.min;range.max=field.max;range.step=field.step;range.id='run-'+field.key;
 const value=el('input','run-number');value.type='text';value.inputMode='decimal';value.autocomplete='off';value.id='run-'+field.key+'-value';value.setAttribute('aria-label',t(field.label));
 range.setAttribute('aria-label',t(field.label));
 range.oninput=()=>{value.value=range.value;setRunValue(field.key,Number(range.value));};
 value.onchange=()=>{const n=Number(value.value.trim().replace(',','.'));if(value.value.trim()===''||!Number.isFinite(n))return setRunValue(field.key,null);setRunValue(field.key,Math.min(field.max,Math.max(field.min,n)));};
 box.append(range,value);return box;
}
function buildRunPanel(){
 const panel=el('aside','run-panel');panel.id='run-panel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby','run-title');
 const head=el('div','run-head');const titles=el('div');const h=el('h2','',t('runSettings'));h.id='run-title';const scope=el('p','run-scope',t('runScope'));scope.id='run-scope';titles.append(h,scope);
 const close=el('button','icon-button run-close');close.type='button';close.append(icon('close'));close.setAttribute('aria-label',t('runClose'));close.onclick=closeRunPanel;head.append(titles,close);
 const body=el('div','run-body');
 // Response
 body.append(el('div','run-label',t('runResponse')));
 const thinking=el('label','switch');const thinkingInput=el('input');thinkingInput.type='checkbox';thinkingInput.id='run-thinking';thinking.append(thinkingInput,el('span'));
 thinkingInput.onchange=()=>setRunValue('thinking',thinkingInput.checked);
 const thinkingRow=runRow('thinkingSetting','runThinkingHint',thinking,'thinking');thinkingRow.classList.add('run-inline');const thinkingNote=el('p','run-hint run-note');thinkingNote.id='run-thinking-note';thinkingRow.append(thinkingNote);body.append(thinkingRow);
 const tokens=el('div','segmented run-segmented');tokens.id='run-tokens';tokens.setAttribute('role','radiogroup');tokens.setAttribute('aria-label',t('responseLength'));
 for(const n of [512,1024,2048,4096]){const b=el('button','',fmt(n));b.type='button';b.dataset.value=n;b.setAttribute('role','radio');b.onclick=()=>setRunValue('responseTokens',n);tokens.append(b);}
 tokens.onkeydown=e=>segmentedKeys(e,tokens);
 body.append(runRow('responseLength','responseLengthHint',tokens,'responseTokens'));
 const temp=runSlider({key:'temperature',label:'runTemperature',min:0,max:2,step:0.05});const presets=el('div','run-presets');
 for(const [,value,label] of runPresets){const b=el('button','run-preset',t(label));b.type='button';b.dataset.value=value;b.onclick=()=>setRunValue('temperature',value);presets.append(b);}
 const tempControl=el('div');tempControl.append(temp,presets);body.append(runRow('runTemperature','runTemperatureHint',tempControl,'temperature'));
 // Instructions
 body.append(el('div','run-label',t('runInstructions')));
 const prompt=el('textarea','run-instructions');prompt.id='run-instructions';prompt.rows=5;prompt.maxLength=12000;prompt.setAttribute('aria-label',t('runInstructions'));
 const save=el('button','text-button',t('runSaveInstructions'));save.type='button';save.id='run-save-instructions';save.onclick=saveRunInstructions;
 const instr=el('div','run-row');const instrHint=el('p','run-hint');instrHint.id='run-instructions-hint';instr.append(prompt,instrHint,save);body.append(instr);
 // Advanced
 const details=el('details','run-advanced');details.id='run-advanced';const summary=el('summary','',t('runAdvanced'));details.append(summary);
 for(const field of runFields)details.append(runRow(field.label,field.hint,runSlider(field),field.key));
 const seed=el('input','run-number run-seed');seed.type='text';seed.inputMode='numeric';seed.autocomplete='off';seed.id='run-seed';seed.setAttribute('aria-label',t('runSeed'));
 seed.onchange=()=>{const n=Number(seed.value.trim());setRunValue('seed',seed.value.trim()===''||!Number.isInteger(n)?null:Math.min(2147483647,Math.max(-1,n)));};
 details.append(runRow('runSeed','runSeedHint',seed,'seed'));body.append(details);
 // Model and memory
 body.append(el('div','run-label',t('runModel')));
 const ctx=el('p','run-hint run-context');ctx.id='run-context';const open=el('button','text-button',t('runOpenSettings'));open.type='button';open.onclick=()=>{closeRunPanel();openSettings('agent');};
 const ctxRow=el('div','run-row');ctxRow.append(ctx,open);body.append(ctxRow);
 const foot=el('div','run-foot');const reset=el('button','text-button',t('runReset'));reset.type='button';reset.id='run-reset';reset.onclick=resetRun;
 const def=el('button','primary',t('runMakeDefault'));def.type='button';def.id='run-make-default';def.onclick=makeRunDefault;foot.append(reset,def);
 panel.append(head,body,foot);
 panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();closeRunPanel();}});
 document.querySelector('main').after(panel);
}
function segmentedKeys(e,group){
 const buttons=[...group.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);if(i<0)return;
 const next=e.key==='ArrowRight'||e.key==='ArrowDown'?i+1:e.key==='ArrowLeft'||e.key==='ArrowUp'?i-1:null;if(next===null)return;
 e.preventDefault();const b=buttons[(next+buttons.length)%buttons.length];b.focus();b.click();
}
buildRunPanel();

function paintRunPanel(){
 const panel=$('run-panel');if(!panel||panel.hidden||!runView)return;const e=runView.effective,o=runView.overrides||{};
 const cap=runView.thinking||{state:'unknown'},always=cap.state==='supported'&&cap.toggle===false,unsupported=cap.state==='unsupported';
 $('run-thinking').checked=always||(!unsupported&&e.thinking);$('run-thinking').disabled=always||unsupported;
 $('run-thinking-note').textContent=unsupported?t('runThinkingUnsupported'):always?t('runThinkingAlways'):'';$('run-thinking-note').hidden=!unsupported&&!always;
 for(const b of $('run-tokens').querySelectorAll('button')){const on=Number(b.dataset.value)===e.responseTokens;b.classList.toggle('active',on);b.setAttribute('aria-checked',String(on));b.tabIndex=on?0:-1;}
 const setSlider=(key,value,unset)=>{const range=$('run-'+key),number=$('run-'+key+'-value');if(!range)return;range.value=String(value);if(document.activeElement!==number)number.value=unset?'':String(value);number.placeholder=unset?t('runDefaultShort'):'';range.classList.toggle('unset',!!unset);};
 setSlider('temperature',e.temperature,false);
 for(const b of document.querySelectorAll('.run-preset'))b.classList.toggle('active',Number(b.dataset.value)===e.temperature);
 for(const f of runFields)setSlider(f.key,e[f.key]??f.fallback,e[f.key]===undefined);
 if(document.activeElement!==$('run-seed')){$('run-seed').value=e.seed===undefined?'':String(e.seed);$('run-seed').placeholder=t('runEngineDefault');$('run-seed').title=t('runSeedHint');}
 for(const b of document.querySelectorAll('.run-reset-field'))b.hidden=!(b.dataset.key in o);
 if(document.activeElement!==$('run-instructions'))$('run-instructions').value=state.chat?.SystemPrompt||'';
 $('run-instructions-hint').textContent=t('runInstructionsHint').replace('{date}',runView.variables?.current_date||'');
 const ctx=effectiveContext(),auto=state.prefs.contextMode!=='manual';
 $('run-context').textContent=t('runContextLine').replace('{value}',t(auto?'runContextAuto':'runContextManual').replace('{n}',fmt(ctx)));
 $('run-reset').disabled=!Object.keys(o).length;
}
async function loadRun(){
 const chat=state.chat;if(!chat)return;const ticket=++runTicket;runChatId=chat.Id;
 try{const view=await api.run('get',{id:chat.Id,model:chat.Model});if(ticket!==runTicket)return;runView=view;}catch{return;}
 paintRunToggle();paintRunPanel();renderContext();
}
function setRunValue(key,value){
 if(!runView||!state.chat)return;const o={...runView.overrides};
 if(value===null||value===undefined||value===runView.defaults[key])delete o[key];else o[key]=value;
 runView={...runView,overrides:o,effective:{...runView.defaults,...o}};
 for(const k of Object.keys(runView.effective))if(runView.effective[k]===undefined)delete runView.effective[k];
 paintRunToggle();paintRunPanel();renderContext();
 clearTimeout(runSaveTimer);const id=state.chat.Id,model=state.chat.Model;
 runSaveTimer=setTimeout(async()=>{try{const view=await api.run('set',{id,model,values:o});if(state.chat?.Id===id){runView=view;paintRunToggle();paintRunPanel();}}catch(e){toast(cleanError(e));loadRun();}},250);
}
async function saveRunInstructions(){
 if(!state.chat)return;const text=$('run-instructions').value;
 try{const saved=await api.request('save',{chat:{...state.chat,SystemPrompt:text}});upsert(saved);state.contexts.delete(saved.Id);renderContext();toast(t('runInstructionsSaved'));}catch(e){toast(cleanError(e));}
}
async function resetRun(){
 if(!state.chat)return;clearTimeout(runSaveTimer);
 try{runView=await api.run('reset',{id:state.chat.Id,model:state.chat.Model});paintRunToggle();paintRunPanel();renderContext();toast(t('runResetDone'));}catch(e){toast(cleanError(e));}
}
async function makeRunDefault(){
 if(!state.chat)return;clearTimeout(runSaveTimer);
 try{await api.run('set',{id:state.chat.Id,model:state.chat.Model,values:runView?.overrides||{}});const view=await api.run('default',{id:state.chat.Id,model:state.chat.Model});
  if(view.prefs)state.prefs=view.prefs;runView=view;paintRunToggle();paintRunPanel();renderContext();toast(t('runDefaultSaved'));}catch(e){toast(cleanError(e));}
}
function openRunPanel(){
 const panel=$('run-panel');closeComposerMenus();panel.hidden=false;$('run-toggle').setAttribute('aria-expanded','true');document.body.classList.add('run-open');
 paintRunPanel();loadRun();requestAnimationFrame(()=>panel.querySelector('.run-close').focus());
}
function closeRunPanel(refocus=true){
 const panel=$('run-panel');if(!panel||panel.hidden)return;panel.hidden=true;$('run-toggle').setAttribute('aria-expanded','false');document.body.classList.remove('run-open');if(refocus)$('run-toggle').focus();
}

// ---------- Wiring ----------
// A different conversation (or a new one) loads its own settings; the reserve shown in the context panel follows them.
const runRenderMessages=renderMessages;renderMessages=function(){runRenderMessages();if(state.chat&&state.chat.Id!==runChatId)loadRun();};
const runSetPage=setPage;setPage=function(page,animate){if(page!=='chat')closeRunPanel(false);runSetPage(page,animate);};
const runOpenSettings=openSettings;openSettings=function(section,animate){closeRunPanel(false);runOpenSettings(section,animate);};
// The panel's labels are built once per language.
let runLanguage=state.prefs.language;
const runLocalize=localize;localize=function(){runLocalize();const panel=$('run-panel');if(panel&&runLanguage!==state.prefs.language){runLanguage=state.prefs.language;const open=!panel.hidden;panel.remove();buildRunPanel();$('run-panel').hidden=!open;}paintRunToggle();paintRunPanel();};
expectedReserve=function(){
 const e=runView&&state.chat?.Id===runChatId?runView.effective:null,p=state.prefs,ctx=effectiveContext();if(toolsConfig&&!toolsConfig.hostReady)return 512;
 const n=e?.responseTokens||p.responseTokens||512,want=e?e.thinking:p.thinking,thinking=want&&thinkingState(currentModel()).state!=='unsupported';
 return Math.min(thinking?Math.max(n,2048):n,Math.floor(ctx/2));
};
// The model picker changes what "thinking" means for this chat.
$('model-picker').addEventListener('change',()=>{if(state.chat)setTimeout(loadRun,0);});
// Changing the defaults in Settings → Chat behavior updates chats that have no override.
const runSaveResponse=saveResponseSettings;saveResponseSettings=async function(){
 const before=state.prefs.creativity;await runSaveResponse();
 // Picking a creativity preset there replaces a custom default temperature.
 if(state.prefs.creativity!==before&&state.prefs.sampling?.temperature!==undefined){const s={...state.prefs.sampling};delete s.temperature;try{state.prefs=await api.preferences({...state.prefs,sampling:s});}catch{}}
 loadRun();
};
for(const id of ['thinking-mode','response-tokens','creativity'])$(id).onchange=saveResponseSettings;
if(state.ready)loadRun();
