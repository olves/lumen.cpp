'use strict';
// Assistants (assistants.cjs): saved instructions + optional model + run settings + skills. The composer footer has an
// "Assistant" menu: on an empty conversation it applies the assistant there; otherwise it starts a new conversation with it.
// Settings → Assistants lists and edits them. Starting copies the values, so later edits never change existing chats.
Object.assign(paths,{person:'M9 9a3 3 0 100-6 3 3 0 000 6zM3.5 15.5c.8-2.6 3-4 5.5-4s4.7 1.4 5.5 4'});
Object.assign(translations,{
 assistantsTitle:['Assistants','Asistanlar'],assistantsIntro:['Saved starting points: instructions, a model, run settings and skills.','Kayıtlı başlangıç noktaları: talimat, model, çalıştırma ayarları ve skill’ler.'],
 assistantNone:['No assistant','Asistan yok'],assistantManage:['Manage assistants…','Asistanları yönet…'],assistantMenu:['Start with an assistant','Bir asistanla başla'],
 assistantButton:['Assistant','Asistan'],assistantChip:['Assistant · {name}','Asistan · {name}'],assistantChipNote:['copied into this chat','bu sohbete kopyalandı'],
 assistantStarted:['{name} is set for this conversation.','{name} bu sohbet için ayarlandı.'],assistantNewChat:['New conversation with {name}.','{name} ile yeni sohbet.'],
 assistantModelMissing:['The assistant’s model is not installed; the current model is kept.','Asistanın modeli kurulu değil; mevcut model korundu.'],
 assistantNew:['New assistant','Yeni asistan'],assistantName:['Name','Ad'],assistantDescription:['Description','Açıklama'],assistantInstructions:['Instructions','Talimatlar'],
 assistantInstructionsHint:['Becomes the conversation’s system prompt. {{current_date}} becomes today’s date.','Sohbetin sistem talimatı olur. {{current_date}} bugünün tarihine dönüşür.'],
 assistantModel:['Model','Model'],assistantModelAny:['Keep the model chosen in the chat','Sohbette seçili modeli koru'],assistantTemperature:['Temperature','Sıcaklık'],
 assistantDefault:['Default','Varsayılan'],assistantLength:['Response length','Yanıt uzunluğu'],assistantThinking:['Thinking','Düşünme'],on:['On','Açık'],off:['Off','Kapalı'],
 assistantSkills:['Skills','Skill’ler'],assistantSkillsNone:['No skills yet. Add them in Settings → Skills.','Henüz skill yok. Ayarlar → Skills’ten ekle.'],
 assistantSave:['Save','Kaydet'],assistantSaved:['Assistant saved','Asistan kaydedildi'],assistantDelete:['Delete','Sil'],assistantStart:['Start a chat','Sohbet başlat'],
 assistantCopyNote:['Starting a chat copies these values into it. Editing the assistant later does not change chats you already started.','Sohbet başlatmak bu değerleri sohbete kopyalar. Asistanı sonradan düzenlemek başlatılmış sohbetleri değiştirmez.'],
 assistantInvalidTemp:['Temperature must be between 0 and 2.','Sıcaklık 0 ile 2 arasında olmalı.'],
});
let assistantList=[],assistantEditing=null;

// ---------- Composer: menu and chip ----------
(function addComposerButton(){
 const wrap=document.querySelector('.composer-foot .context-wrap');if(!wrap||$('assistant-toggle'))return;
 const button=el('button','run-toggle assistant-toggle');button.id='assistant-toggle';button.type='button';button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');
 button.append(icon('person'),el('span','run-toggle-text',t('assistantButton')));
 const anchor=$('run-toggle')||wrap;anchor.before(button);
 const menu=el('div','assistant-menu');menu.id='assistant-menu';menu.hidden=true;menu.setAttribute('role','menu');document.querySelector('.composer-foot').append(menu);
 button.onclick=()=>{if(state.busy)return;const open=menu.hidden;closeComposerMenus();if(open)openAssistantMenu();};
 menu.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeAssistantMenu(true);}else if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const items=[...menu.querySelectorAll('button')];const i=items.indexOf(document.activeElement);items[(i+(e.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();}});
 document.addEventListener('pointerdown',e=>{if(!menu.hidden&&!e.target.closest('#assistant-menu')&&!e.target.closest('#assistant-toggle'))closeAssistantMenu();});
})();
function closeAssistantMenu(focus=false){const menu=$('assistant-menu');if(!menu||menu.hidden)return;menu.hidden=true;$('assistant-toggle').setAttribute('aria-expanded','false');if(focus)$('assistant-toggle').focus();}
const assistantsCloseMenus=closeComposerMenus;closeComposerMenus=function(...args){assistantsCloseMenus(...args);closeAssistantMenu();};
async function loadAssistants(){try{assistantList=await api.assistants('list');}catch(e){assistantList=[];}return assistantList;}
async function openAssistantMenu(){
 const menu=$('assistant-menu');await loadAssistants();menu.replaceChildren(el('div','assistant-menu-title',t('assistantMenu')));
 const current=state.chat?.Assistant?.id||null;
 const item=(label,detail,chosen,onclick)=>{const b=el('button','assistant-item'+(chosen?' selected':''));b.type='button';b.setAttribute('role','menuitemradio');b.setAttribute('aria-checked',String(!!chosen));const text=el('span');text.append(el('strong','',label),...(detail?[el('small','',detail)]:[]));b.append(text,el('span','model-check',chosen?'✓':''));b.onclick=onclick;return b;};
 if(!state.chat?.Messages.length)menu.append(item(t('assistantNone'),'',!current,()=>{closeAssistantMenu(true);startAssistant(null);}));
 for(const a of assistantList)menu.append(item(a.name,a.description,a.id===current,()=>{closeAssistantMenu(true);startAssistant(a);}));
 const manage=el('button','assistant-manage',t('assistantManage'));manage.type='button';manage.onclick=()=>{closeAssistantMenu();openSettings('assistants');};menu.append(manage);
 menu.hidden=false;$('assistant-toggle').setAttribute('aria-expanded','true');if(typeof animateMenu==='function')animateMenu(menu);menu.querySelector('button')?.focus();
}
// On an empty conversation the assistant applies there; otherwise a new conversation starts with it.
async function startAssistant(a){
 if(state.busy||!state.chat)return;
 const fresh=!state.chat.Messages.length;if(!fresh&&!a)return;
 if(!fresh)$('new-chat').click();
 const chat=state.chat;
 try{
  const r=await api.assistants('start',{chatId:chat.Id,id:a?.id||null});
  if(!r.assistant){delete chat.Assistant;chat.SystemPrompt=fresh_prompt();chat.SkillIds=[];}
  else{chat.Assistant=r.assistant;chat.SystemPrompt=r.instructions||'';chat.SkillIds=r.skillIds||[];if(r.model){chat.Model=r.model;$('model-picker').value=r.model;$('model-picker').dispatchEvent(new Event('change'));}}
  upsert(chat);if(typeof renderSkillChips==='function')renderSkillChips();renderToolChips();if(typeof loadRun==='function')loadRun();
  state.contexts.delete(chat.Id);renderContext();
  if(r.assistant)toast(tf(fresh?'assistantStarted':'assistantNewChat',{name:r.assistant.name})+(r.modelMissing?' '+t('assistantModelMissing'):''));
  $('prompt').focus();
 }catch(e){toast(cleanError(e));}
}
function fresh_prompt(){return "You are a helpful assistant. Respond in the user's language. Be clear and accurate.";}
const assistantsRenderChips=renderToolChips;renderToolChips=function(){
 assistantsRenderChips();const a=state.chat?.Assistant;if(!a)return;
 const box=$('tool-chips');box.hidden=false;const chip=el('div','skill-chip tool-chip assistant-chip'),open=el('button','project-chip-open');open.type='button';
 open.append(icon('person'),el('span','skill-chip-name',tf('assistantChip',{name:a.name})),el('small','tool-chip-note',t('assistantChipNote')));open.onclick=()=>{assistantEditing=a.id;openSettings('assistants');};
 chip.append(open);box.prepend(chip);
};

// ---------- Settings → Assistants ----------
sectionNames.assistants='assistantsTitle';
(function addSettingsSection(){
 if($('assistants-panel'))return;
 const nav=el('button');nav.dataset.setting='assistants';nav.append(icon('person'),el('span','',t('assistantsTitle')));
 const skills=document.querySelector('#settings-nav [data-setting="skills"]');skills.after(nav);nav.onclick=()=>openSettings('assistants');
 const panel=el('section','settings-panel');panel.id='assistants-panel';panel.hidden=true;$('settings-page').append(panel);
})();
const assistantsOpenSettings=openSettings;openSettings=function(section,animate){
 assistantsOpenSettings(section,animate);$('assistants-panel').hidden=state.setting!=='assistants';
 if(state.setting==='assistants'){$('chat-title').textContent=t('assistantsTitle');loadAssistants().then(paintAssistants);}
};
function paintAssistants(){
 const panel=$('assistants-panel');if(panel.hidden)return;
 const head=el('div','settings-heading');head.append(el('h1','',t('assistantsTitle')),el('p','',t('assistantsIntro')));
 const layout=el('div','assistant-layout'),list=el('div','assistant-list');
 const add=el('button','secondary',t('assistantNew'));add.type='button';add.onclick=()=>{assistantEditing='new';paintAssistants();};
 if(assistantEditing!=='new'&&!assistantList.some(a=>a.id===assistantEditing))assistantEditing=assistantList[0]?.id||'new';
 for(const a of assistantList){const b=el('button','assistant-row'+(a.id===assistantEditing?' active':''));b.type='button';b.append(icon('person'),el('span','',a.name));b.title=a.description;b.onclick=()=>{assistantEditing=a.id;paintAssistants();};list.append(b);}
 list.append(add);
 layout.append(list,assistantEditor(assistantEditing==='new'?{name:'',description:'',instructions:'',model:'',run:{},skillIds:[]}:assistantList.find(a=>a.id===assistantEditing)));
 panel.replaceChildren(head,layout);
}
function assistantEditor(a){
 const form=el('form','assistant-editor');form.noValidate=true;
 const field=(label,input,hint)=>{const wrap=el('label','assistant-field');wrap.append(el('span','',label),input,...(hint?[el('small','quiet',hint)]:[]));return wrap;};
 const name=el('input');name.maxLength=60;name.value=a.name;name.id='assistant-name';
 const description=el('input');description.maxLength=200;description.value=a.description;description.id='assistant-description';
 const instructions=el('textarea');instructions.rows=7;instructions.maxLength=12000;instructions.value=a.instructions;instructions.id='assistant-instructions';
 const model=el('select');model.id='assistant-model';model.append(new Option(t('assistantModelAny'),''));
 for(const m of state.models.filter(m=>m.Installed))model.append(new Option(typeof displayName==='function'?displayName(m):m.Name,m.Name));
 if(a.model&&![...model.options].some(o=>o.value===a.model))model.append(new Option(a.model,a.model));model.value=a.model||'';
 const temp=el('input');temp.id='assistant-temperature';temp.inputMode='decimal';temp.placeholder=t('assistantDefault');temp.value=a.run?.temperature??'';
 const length=el('select');length.id='assistant-length';length.append(new Option(t('assistantDefault'),''));for(const n of [512,1024,2048,4096])length.append(new Option(fmt(n),String(n)));length.value=a.run?.responseTokens?String(a.run.responseTokens):'';
 const thinking=el('select');thinking.id='assistant-thinking';thinking.append(new Option(t('assistantDefault'),''),new Option(t('on'),'on'),new Option(t('off'),'off'));thinking.value=a.run?.thinking===true?'on':a.run?.thinking===false?'off':'';
 const skills=el('div','assistant-skills');const allSkills=state.skills||[];
 if(!allSkills.length)skills.append(el('small','quiet',t('assistantSkillsNone')));
 for(const s of allSkills){const row=el('label','assistant-skill');const box=el('input');box.type='checkbox';box.value=s.id;box.checked=(a.skillIds||[]).includes(s.id);row.append(box,el('span','',s.name));skills.append(row);}
 const grid=el('div','assistant-grid');grid.append(field(t('assistantModel'),model),field(t('assistantTemperature'),temp),field(t('assistantLength'),length),field(t('assistantThinking'),thinking));
 const actions=el('div','dialog-actions');
 const save=el('button','primary',t('assistantSave'));save.type='submit';
 const start=el('button','secondary',t('assistantStart'));start.type='button';start.disabled=!a.id;
 const remove=el('button','text-button danger',t('assistantDelete'));remove.type='button';remove.hidden=!a.id;
 actions.append(remove,start,save);
 const values=()=>{
  const tv=temp.value.trim().replace(',','.');if(tv&&!(Number(tv)>=0&&Number(tv)<=2))throw Error(t('assistantInvalidTemp'));
  const run={};if(tv)run.temperature=Number(tv);if(length.value)run.responseTokens=Number(length.value);if(thinking.value)run.thinking=thinking.value==='on';
  return {id:a.id,name:name.value,description:description.value,instructions:instructions.value,model:model.value,run,skillIds:[...skills.querySelectorAll('input:checked')].map(x=>x.value).slice(0,4)};
 };
 form.onsubmit=async event=>{event.preventDefault();try{const v=values();assistantList=await api.assistants('save',{assistant:v});assistantEditing=v.id||assistantList.at(-1)?.id;toast(t('assistantSaved'));paintAssistants();}catch(e){toast(cleanError(e));}};
 start.onclick=async()=>{const found=assistantList.find(x=>x.id===a.id);if(!found)return;setPage('chat');await startAssistant(found);};
 remove.onclick=async()=>{try{assistantList=await api.assistants('remove',{id:a.id});assistantEditing=assistantList[0]?.id||'new';paintAssistants();}catch(e){toast(cleanError(e));}};
 form.append(field(t('assistantName'),name),field(t('assistantDescription'),description),field(t('assistantInstructions'),instructions,t('assistantInstructionsHint')),grid,el('span','assistant-subhead',t('assistantSkills')),skills,el('p','quiet assistant-note',t('assistantCopyNote')),actions);
 return form;
}
const assistantsSetBusy=setBusy;setBusy=function(busy,operation){assistantsSetBusy(busy,operation);const b=$('assistant-toggle');if(b)b.disabled=busy;if(busy)closeAssistantMenu();};
const assistantsLocalize=localize;localize=function(){
 assistantsLocalize();const nav=document.querySelector('#settings-nav [data-setting="assistants"] span:last-child');if(nav)nav.textContent=t('assistantsTitle');
 const b=$('assistant-toggle');if(b){b.querySelector('.run-toggle-text').textContent=t('assistantButton');b.title=t('assistantMenu');}
 if(state.ready&&state.page==='settings'&&state.setting==='assistants')paintAssistants();
};
