'use strict';
// Coding agent UI (coder.cjs): the "Allow edits" switch of a conversation's project folder, the one-time consent before a cloud
// model receives project files, change cards (diff + Apply / Skip / Apply all in this task), and under each coding reply the
// changed files, the token / cache / cost line and Undo for the latest task. Live status items are in statusbar.js.
Object.assign(translations,{
 codingAllowEdits:['Allow edits','Düzenlemeye izin ver'],
 codingAllowHint:['The model may change and create files in this folder. Every change is shown as a diff first and applied only after you approve it; the latest task can be undone. It cannot run commands or delete files.','Model bu klasörde dosya değiştirebilir ve oluşturabilir. Her değişiklik önce fark olarak gösterilir ve yalnızca sen onaylayınca uygulanır; son görev geri alınabilir. Komut çalıştıramaz, dosya silemez.'],
 codingEditsOn:['edits on','düzenleme açık'],
 codingConsent:['Project files you let the model read will be sent to {provider}. Lumen asks this once per provider.','Modelin okumasına izin verdiğin proje dosyaları {provider} sağlayıcısına gönderilecek. Lumen bunu her sağlayıcı için bir kez sorar.'],
 codingConsentAllow:['Allow and send','İzin ver ve gönder'],codingConsentCancel:['Cancel','İptal'],
 codingChange:['Proposed change','Önerilen değişiklik'],codingNewFile:['new file','yeni dosya'],
 codingApply:['Apply','Uygula'],codingSkip:['Skip','Atla'],codingApplyAll:['Apply all in this task','Bu görevde hepsini uygula'],
 codingTimeout:['No answer in 10 minutes; the change was skipped.','10 dakika yanıt gelmedi; değişiklik atlandı.'],codingFailed:['The change could not be applied: {error}','Değişiklik uygulanamadı: {error}'],
 codingFiles:['Changed files','Değişen dosyalar'],codingNoFiles:['No files changed.','Dosya değişmedi.'],
 codingCost:['Input {input} ({rate}% cached) · Output {output}','Girdi {input} (%{rate} önbellek) · Çıktı {output}'],codingLocal:['local · free','yerel · ücretsiz'],
 codingUndo:['Undo these changes','Bu değişiklikleri geri al'],codingUndone:['Undone','Geri alındı'],
 codingUndoDone:['Restored {restored}, removed {removed}.','{restored} dosya geri yüklendi, {removed} dosya silindi.'],codingUndoSkipped:['Left alone because they changed afterwards: {files}','Sonradan değiştikleri için dokunulmadı: {files}'],
 codingBudget:['The task stopped at its limit ({limit}).','Görev sınırında durdu ({limit}).'],codingLimitTokens:['tokens','token'],codingLimitMoney:['amount','tutar'],codingContinue:['Continue','Devam et'],codingContinuePrompt:['Continue.','Devam et.'],
 codingSettings:['Coding limits and prices','Kodlama sınırları ve fiyatlar'],codingMoney:['Amount per task (USD, only for models with a price)','Görev başına tutar (USD, yalnızca fiyatı girilen modeller)'],codingTokens:['Tokens per task','Görev başına token'],codingSteps:['Steps per task','Görev başına adım'],
 codingThink:['Think more during steps (better on hard tasks, costs more)','Adımlarda daha çok düşün (zor işlerde daha iyi, daha pahalı)'],codingPrices:['Prices per million tokens: input · cached input · output','Milyon token başına fiyat: girdi · önbellekli girdi · çıktı'],codingSaved:['Coding settings saved','Kodlama ayarları kaydedildi'],codingSave:['Save','Kaydet'],
 op_p_edit:['Changed {label} · {detail}','Değiştirildi {label} · {detail}'],run_p_edit:['Waiting for your approval: {label}','Onayın bekleniyor: {label}']
});
let codingState={chatId:null,allowEdits:false,settings:null};
async function loadCoding(){const id=state.chat?.Id;if(!id||!state.chat?.Project)return codingState;try{const r=await api.projects('coding',{chatId:id});codingState={chatId:id,allowEdits:!!r.allowEdits,settings:r.settings};}catch{}return codingState;}

// Project chip: "edits on" instead of "read-only" when the switch is on.
const codingRenderChips=renderToolChips;renderToolChips=function(){
 codingRenderChips();const chip=document.querySelector('.project-chip .tool-chip-note');if(!chip||!state.chat?.Project)return;
 if(codingState.chatId!==state.chat.Id){loadCoding().then(()=>{if(codingState.chatId===state.chat?.Id)renderToolChips();});return;}
 if(state.chat.Project.exists!==false)chip.textContent=codingState.allowEdits?t('codingEditsOn'):t('projectReadOnly');
};
// Project dialog: the switch, above the folder rules.
const codingPaintDialog=paintProjectDialog;paintProjectDialog=function(status){
 codingPaintDialog(status);const rules=projectDialog.querySelector('.project-rules');if(!rules)return;
 const row=el('label','setting-row coding-switch'),text=el('div'),sw=el('span','switch'),box=el('input'),knob=el('span');
 box.type='checkbox';box.id='allow-edits';box.checked=codingState.chatId===state.chat?.Id&&codingState.allowEdits;box.disabled=state.busy;sw.append(box,knob);
 text.append(el('h3','',t('codingAllowEdits')),el('p','quiet',t('codingAllowHint')));row.append(text,sw);rules.before(row);
 box.onchange=async()=>{try{const r=await api.projects('allow-edits',{chatId:state.chat.Id,on:box.checked,language:state.prefs.language});codingState={...codingState,chatId:state.chat.Id,allowEdits:r.allowEdits};renderToolChips();}catch(e){box.checked=!box.checked;toast(cleanError(e));}};
 if(codingState.chatId!==state.chat?.Id)loadCoding().then(()=>{box.checked=codingState.allowEdits;paintCodingSettings();});else paintCodingSettings();
};
// Limits, prices and deeper thinking (coding-settings.json), below the switch.
function paintCodingSettings(){
 const old=projectDialog.querySelector('.coding-settings');if(old)old.remove();const s=codingState.settings;const anchor=projectDialog.querySelector('.coding-switch');if(!s||!anchor)return;
 const box=el('details','coding-settings');box.append(el('summary','',t('codingSettings')));
 const field=(id,label,value,step)=>{const row=el('label','coding-field'),input=el('input');input.type='number';input.id=id;input.min='0';input.step=step;input.value=String(value);row.append(el('span','',label),input);box.append(row);return input;};
 const money=field('coding-money',t('codingMoney'),s.taskMoney,'0.01'),tokens=field('coding-tokens',t('codingTokens'),s.taskTokens,'1000'),steps=field('coding-steps',t('codingSteps'),s.maxSteps,'1');
 const thinkRow=el('label','coding-field'),think=el('input');think.type='checkbox';think.id='coding-think';think.checked=!!s.deepThinking;thinkRow.append(think,el('span','',t('codingThink')));box.append(thinkRow);
 box.append(el('p','quiet',t('codingPrices')));
 const keys=new Set(Object.keys(s.prices||{}));const current=/^cloud:([a-z]+)\/(.+)$/.exec($('model-picker').value||'');if(current)keys.add(current[1]+'/'+current[2]);
 for(const key of keys){const p=s.prices?.[key]||{};const row=el('div','coding-price-row');row.dataset.model=key;row.append(el('code','',key));for(const [cls,v] of [['price-input',p.input],['price-cached',p.cachedInput],['price-output',p.output]]){const i=el('input',cls);i.type='number';i.min='0';i.step='0.001';i.value=v==null?'':String(v);i.setAttribute('aria-label',key+' '+cls.slice(6));row.append(i);}box.append(row);}
 const save=el('button','secondary',t('codingSave'));save.type='button';save.id='coding-save';
 save.onclick=async()=>{const prices={};for(const row of box.querySelectorAll('.coding-price-row')){const v=c=>row.querySelector(c).value.trim();if(v('.price-input')===''||v('.price-output')==='')continue;prices[row.dataset.model]={input:Number(v('.price-input')),cachedInput:v('.price-cached')===''?Number(v('.price-input')):Number(v('.price-cached')),output:Number(v('.price-output')),currency:'USD'};}
  try{const r=await api.projects('coding-settings',{chatId:state.chat.Id,patch:{taskMoney:Number(money.value),taskTokens:Number(tokens.value),maxSteps:Number(steps.value),deepThinking:think.checked,prices}});codingState={...codingState,settings:r};toast(t('codingSaved'));}catch(e){toast(cleanError(e));}};
 box.append(save);anchor.after(box);
}

// One-time consent before a cloud model receives project files.
function cloudProviderOf(model){const m=/^cloud:([a-z]+)\//.exec(String(model||''));return m?m[1]:null;}
const codingSendWithProject=sendWithProject;sendWithProject=async function(text,options={}){
 const provider=cloudProviderOf($('model-picker').value);
 if(!provider)return codingSendWithProject(text,options);
 const s=(await loadCoding()).settings;if(s?.consented?.includes(provider))return codingSendWithProject(text,options);
 const label=state.models.find(m=>m.Name===$('model-picker').value)?.Cloud?.label||provider;
 document.querySelector('.coding-consent')?.remove();
 const box=el('div','approval-card coding-consent');box.setAttribute('role','group');
 const actions=el('div','approval-actions'),cancel=el('button','secondary',t('codingConsentCancel')),allow=el('button','primary coding-consent-allow',t('codingConsentAllow'));cancel.type=allow.type='button';
 cancel.onclick=()=>box.remove();
 allow.onclick=async()=>{allow.disabled=true;try{await api.projects('coding-consent',{chatId:state.chat.Id,provider});await loadCoding();box.remove();await codingSendWithProject(text,options);}catch(e){allow.disabled=false;toast(cleanError(e));}};
 actions.append(cancel,allow);box.append(el('p','',tf('codingConsent',{provider:label})),actions);$('messages').append(box);allow.focus();
 $('chat-scroll').scrollTop=$('chat-scroll').scrollHeight;
};

// ---------- Change cards ----------
const editCards=new Map();
function diffView(change){
 const box=el('div','edit-diff');let shown=0;const total=change.hunks.reduce((n,h)=>n+h.lines.length,0);
 for(const h of change.hunks){
  box.append(el('div','edit-hunk',`@@ ${h.oldStart} → ${h.newStart} @@`));
  for(const line of h.lines){const tag=line.t==='+'?'ins':line.t==='-'?'del':'span';const row=el(tag,'edit-line',line.s);if(line.t===' ')row.classList.add('edit-context');box.append(row);shown++;}
 }
 if(total<=80)return box;
 const details=el('details','edit-more');details.append(el('summary','',`+${change.added} −${change.removed}`),box);return details;
}
listen('agent-event',event=>{
 const run=typeof agentRun!=='undefined'?agentRun:null;if(!run||(event.runId&&event.runId!==run.runId))return;
 if(event.type==='edit-approval'){
  const c=event.change,card=el('div','approval-card edit-card');card.setAttribute('role','group');card.setAttribute('aria-label',t('codingChange')+': '+c.path);
  const head=el('div','edit-head');head.append(el('strong','',t('codingChange')),el('code','edit-path',c.path),el('small','edit-counts',`+${c.added} −${c.removed}`));if(c.kind==='create')head.append(el('small','quiet',t('codingNewFile')));
  const actions=el('div','approval-actions');
  const decide=decision=>{actions.querySelectorAll('button').forEach(b=>b.disabled=true);api.agent('approve',{runId:run.runId,callId:event.callId,decision}).catch(e=>toast(cleanError(e)));};
  const all=el('button','text-button edit-apply-all',t('codingApplyAll')),skip=el('button','secondary edit-skip',t('codingSkip')),apply=el('button','primary edit-apply',t('codingApply'));[all,skip,apply].forEach(b=>b.type='button');
  all.onclick=()=>decide('apply-all');skip.onclick=()=>decide('skip');apply.onclick=()=>decide('apply');actions.append(all,skip,apply);
  card.append(head,diffView(c),actions);run.view.root.after(card);editCards.set(event.callId,card);apply.focus();
  $('chat-scroll').scrollTop=$('chat-scroll').scrollHeight;
 }else if(event.type==='edit-done'){
  const card=editCards.get(event.callId);editCards.delete(event.callId);if(!card)return;
  if(event.decision==='timeout'||event.decision==='failed'){card.replaceChildren(el('small','quiet',event.decision==='timeout'?t('codingTimeout'):tf('codingFailed',{error:event.error||''})));setTimeout(()=>card.remove(),5000);}else card.remove();
 }else if(event.type==='end'){for(const card of editCards.values())card.remove();editCards.clear();}
});

// ---------- Under a coding reply: files, numbers, Undo ----------
const tokenText=n=>n>=1000?fmt(Math.round(n/100)/10)+'K':fmt(n);
function moneyText(cost){if(!cost)return '';if(cost.currency==='USD')return cost.amount<1?`≈ ${fmt(Math.round(cost.amount*1000)/10)} ¢`:`≈ $${cost.amount.toFixed(2)}`;return `≈ ${cost.amount.toFixed(3)} ${cost.currency}`;}
const codingMessageNode=messageNode;messageNode=function(m,index,stream=false){
 const result=codingMessageNode(m,index,stream);const c=m.Coding;if(stream||!c)return result;
 const box=el('div','coding-summary'),files=el('ul','coding-files');
 if(c.files.length){box.append(el('strong','',t('codingFiles')));for(const f of c.files){const li=el('li','',f);files.append(li);}box.append(files);}else box.append(el('p','quiet',t('codingNoFiles')));
 const totals=c.totals||{input:0,cached:0,output:0},rate=totals.input?Math.round(totals.cached/totals.input*100):0;
 const local=!/^cloud:/.test(state.chat?.Model||'');
 box.append(el('p','coding-cost',[tf('codingCost',{input:tokenText(totals.input),rate:fmt(rate),output:tokenText(totals.output)}),c.cost?moneyText(c.cost):(local?t('codingLocal'):'')].filter(Boolean).join(' · ')));
 if(c.budgetStop){
  const note=el('div','coding-budget'),go=el('button','secondary coding-continue',t('codingContinue'));go.type='button';go.disabled=state.busy;
  go.onclick=()=>{if(state.busy)return;const prompt=$('prompt');prompt.value=t('codingContinuePrompt');prompt.dispatchEvent(new Event('input'));$('send').click();};
  note.append(el('span','',tf('codingBudget',{limit:t(c.budgetStop==='money'?'codingLimitMoney':'codingLimitTokens')})),go);box.append(note);
 }
 if(c.undone)box.append(el('p','coding-undone',t('codingUndone')));
 else if(c.canUndo){
  const undo=el('button','secondary coding-undo',t('codingUndo'));undo.type='button';undo.disabled=state.busy;
  undo.onclick=async()=>{undo.disabled=true;try{const r=await api.projects('undo',{chatId:state.chat.Id,taskId:c.taskId,language:state.prefs.language});c.undone=true;c.canUndo=false;
   toast([tf('codingUndoDone',{restored:fmt(r.restored.length),removed:fmt(r.removed.length)}),r.skipped.length?tf('codingUndoSkipped',{files:r.skipped.map(s=>s.path).join(', ')}):''].filter(Boolean).join(' '));renderMessages();}
   catch(e){undo.disabled=false;toast(cleanError(e));}};
  box.append(undo);
 }
 result.node.append(box);return result;
};
