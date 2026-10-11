'use strict';
// Skills v2 UI: what a skill is, reference notes, rendered preview, import review (file, SKILL.md folder, URL) before
// anything is saved, source and ignored fields, the size a skill adds to context, and how skills apply to answers.
Object.assign(translations,{
 skillsIntro:['A skill is a reusable set of instructions and reference notes for a kind of task. Selected skills are added to the model’s instructions in that conversation. They cannot run code, install anything or change what the model may use.','Skill, belirli bir iş için tekrar seçilebilen talimat ve referans notlarıdır. Seçilen skill’ler o sohbette modelin talimatlarına eklenir. Kod çalıştıramaz, bir şey kuramaz ve modelin kullanabileceklerini değiştiremez.'],
 skillReferences:['Reference notes','Referans notları'],skillReferencesHint:['Text the model reads together with the instructions (up to 5 notes, 16 KB each, 32 KB in total).','Modelin talimatlarla birlikte okuduğu metin (en fazla 5 not, her biri 16 KB, toplam 32 KB).'],
 addReference:['Add a reference file…','Referans dosyası ekle…'],viewReference:['View','Göster'],noReferences:['No reference notes.','Referans notu yok.'],
 skillPreview:['Preview','Önizleme'],skillEdit:['Edit','Düzenle'],skillSize:['Adds about {tokens} tokens to the context when selected.','Seçildiğinde context’e yaklaşık {tokens} token ekler.'],
 skillSource_file:['Imported from the file {origin}.','{origin} dosyasından içe aktarıldı.'],skillSource_folder:['Imported from the folder {origin}.','{origin} klasöründen içe aktarıldı.'],skillSource_url:['Imported from {origin}.','{origin} adresinden içe aktarıldı.'],skillSource_starter:['A starter skill included with Lumen.','Lumen ile gelen başlangıç skill’i.'],
 skillIgnored:['Not imported','İçe aktarılmayanlar'],
 importReviewTitle:['Review before saving','Kaydetmeden önce incele'],importReviewHint:['Nothing has been saved yet. Check the instructions: they will be added to the model’s instructions whenever you select this skill.','Henüz hiçbir şey kaydedilmedi. Talimatları kontrol et: bu skill’i seçtiğinde modelin talimatlarına eklenecek.'],
 saveSkillReviewed:['Save skill','Skill’i kaydet'],editBeforeSaving:['Edit before saving','Kaydetmeden önce düzenle'],importFromUrl:['From URL','URL’den'],importUrlTitle:['Import a skill from a URL','URL’den skill içe aktar'],importUrlHint:['An https address of a SKILL.md, Markdown or JSON file (GitHub file pages work). Up to 64 KB; nothing is saved until you review it.','Bir SKILL.md, Markdown veya JSON dosyasının https adresi (GitHub dosya sayfaları da olur). En fazla 64 KB; incelemeden hiçbir şey kaydedilmez.'],importButton:['Import','İçe aktar'],
 skillScope:['Used for this conversation’s answers. Research and project tool steps do not use skills; their final answers do.','Bu sohbetin yanıtlarında kullanılır. Araştırma ve proje araç adımları skill kullanmaz; son yanıtları kullanır.'],
 skillsBudget:['Selected skills: about {tokens} tokens of context ({chars} characters).','Seçili skill’ler: yaklaşık {tokens} token context ({chars} karakter).'],skillsBudgetOver:['The selected skills exceed {limit} characters. Select fewer or shorten their references.','Seçili skill’ler {limit} karakteri aşıyor. Daha az seç veya referanslarını kısalt.']
});
// ---------- Editor: references, preview, source, size ----------
let editorRefs=[],editorMeta={source:null,unsupported:[]};
(function extendEditor(){
 const form=$('skill-form'),foot=form.querySelector('.skill-editor-foot');if($('skill-references'))return;
 const previewButton=el('button','text-button skill-preview-toggle',t('skillPreview'));previewButton.type='button';previewButton.id='skill-preview-toggle';
 $('skill-instructions').before(previewButton);const preview=el('div','skill-preview md');preview.id='skill-preview';preview.hidden=true;$('skill-instructions').after(preview);
 previewButton.onclick=()=>{const showing=!preview.hidden;preview.hidden=showing;$('skill-instructions').hidden=!showing;previewButton.textContent=t(showing?'skillPreview':'skillEdit');if(!showing)markdown(preview,$('skill-instructions').value||'');};
 const refs=el('section','skill-references');refs.id='skill-references';const info=el('div','skill-meta');info.id='skill-meta';
 foot.after(refs,info);paintReferences();
})();
function paintReferences(){
 const box=$('skill-references');box.replaceChildren(el('h3','',t('skillReferences')),el('p','quiet',t('skillReferencesHint')));
 if(!editorRefs.length)box.append(el('p','quiet',t('noReferences')));
 editorRefs.forEach((ref,i)=>{const row=el('div','skill-reference-row'),view=el('button','text-button',t('viewReference')),remove=el('button','text-button',t('remove'));view.type=remove.type='button';
  view.onclick=()=>showReference(ref);remove.onclick=()=>{editorRefs.splice(i,1);paintReferences();paintSkillMeta();};row.append(el('strong','',ref.name),el('small','quiet',fmt(ref.text.length)+' chars'),view,remove);box.append(row);});
 const add=el('button','secondary',t('addReference'));add.type='button';add.disabled=editorRefs.length>=5;add.onclick=async()=>{try{const ref=await api.skills('reference-file',{language:state.prefs.language});if(ref){editorRefs.push(ref);paintReferences();paintSkillMeta();}}catch(e){toast(cleanError(e));}};box.append(add);
}
function paintSkillMeta(){
 const box=$('skill-meta');if(!box)return;box.replaceChildren();
 const chars=$('skill-instructions').value.length+editorRefs.reduce((n,r)=>n+r.text.length+r.name.length+40,0)+$('skill-name').value.length+40;
 box.append(el('p','quiet',tf('skillSize',{tokens:fmt(Math.ceil(chars/3.6))})));
 if(editorMeta.source&&editorMeta.source.type!=='manual')box.append(el('p','quiet',tf('skillSource_'+editorMeta.source.type,{origin:editorMeta.source.origin||''})));
 if(editorMeta.unsupported?.length){const list=el('ul','skill-ignored');editorMeta.unsupported.forEach(n=>list.append(el('li','',n)));box.append(el('strong','',t('skillIgnored')),list);}
}
function showReference(ref){const dialog=$('project-dialog');const head=el('div','project-dialog-head'),close=el('button','icon-button','×');close.type='button';close.onclick=()=>dialog.close();head.append(el('h2','',ref.name),close);const body=el('div','md skill-reference-view');markdown(body,ref.text);dialog.replaceChildren(head,body);if(!dialog.open)dialog.showModal();}
const skillsEditorValues=editorValues;editorValues=function(){return {...skillsEditorValues(),references:editorRefs.map(r=>({...r})),source:editorMeta.source||undefined,unsupported:editorMeta.unsupported||[]};};
const skillsEditSkill=editSkill;editSkill=function(skill=null){
 skillsEditSkill(skill);const draft=skillDrafts.get(state.skillEditorId||'new')||skill||{};
 editorRefs=(draft.references||[]).map(r=>({...r}));editorMeta={source:draft.source||null,unsupported:draft.unsupported||[]};
 $('skill-preview').hidden=true;$('skill-instructions').hidden=false;$('skill-preview-toggle').textContent=t('skillPreview');paintReferences();paintSkillMeta();
};
$('skill-instructions').addEventListener('input',paintSkillMeta);

// ---------- Import review ----------
const reviewDialog=el('dialog','project-dialog skill-review');reviewDialog.id='skill-review';document.body.append(reviewDialog);
function reviewDraft(draft){
 const head=el('div','project-dialog-head'),close=el('button','icon-button','×');close.type='button';close.setAttribute('aria-label',t('close'));close.onclick=()=>reviewDialog.close();head.append(el('h2','',t('importReviewTitle')),close);
 const summary=el('div','skill-review-summary');summary.append(el('strong','',draft.name),el('p','quiet',draft.description||''),el('p','quiet',tf('skillSource_'+(draft.source?.type||'file'),{origin:draft.source?.origin||''})));
 const body=el('div','md skill-review-body');markdown(body,draft.instructions);
 const parts=[head,el('p','quiet',t('importReviewHint')),summary,body];
 if(draft.references?.length){const refs=el('div','skill-review-refs');refs.append(el('strong','',t('skillReferences')));draft.references.forEach(r=>{const row=el('div','skill-reference-row'),view=el('button','text-button',t('viewReference'));view.type='button';view.onclick=()=>{const box=el('div','md');markdown(box,r.text);row.after(box);view.disabled=true;};row.append(el('span','',r.name),el('small','quiet',fmt(r.text.length)+' chars'),view);refs.append(row);});parts.push(refs);}
 if(draft.unsupported?.length){const list=el('ul','skill-ignored');draft.unsupported.forEach(n=>list.append(el('li','',n)));parts.push(el('strong','',t('skillIgnored')),list);}
 const actions=el('div','dialog-actions'),edit=el('button','secondary',t('editBeforeSaving')),save=el('button','primary',t('saveSkillReviewed'));edit.type=save.type='button';
 edit.onclick=()=>{reviewDialog.close();openSettings('skills');skillDrafts.delete('new');editSkill({...draft,id:undefined});state.skillEditorId=null;$('skill-name').focus();};
 save.onclick=async()=>{try{const {draft:_,...skill}=draft;const saved=await api.skills('upsert',{skill:{...skill,id:undefined}});reviewDialog.close();await reloadSkills();openSettings('skills');editSkill(state.skills.find(s=>s.id===saved.id));toast(t('skillSaved'));}catch(e){toast(cleanError(e));}};
 actions.append(edit,save);parts.push(actions);reviewDialog.replaceChildren(...parts);if(!reviewDialog.open)reviewDialog.showModal();
}
importSkill=async function(folder=false){try{const draft=await api.skills('import',{folder});if(draft)reviewDraft(draft);}catch(error){toast(cleanError(error));}};
$('import-skill').onclick=()=>importSkill();$('import-skill-folder').onclick=()=>importSkill(true);$('picker-import-skill').onclick=()=>{closeComposerMenus();importSkill();};
(function addUrlImport(){
 if($('import-skill-url'))return;const button=el('button','text-button',t('importFromUrl'));button.id='import-skill-url';button.type='button';$('import-skill-folder').after(button);
 button.onclick=()=>{
  const head=el('div','project-dialog-head'),close=el('button','icon-button','×');close.type='button';close.onclick=()=>reviewDialog.close();head.append(el('h2','',t('importUrlTitle')),close);
  const form=el('form','skill-url-form'),input=el('input');input.type='url';input.placeholder='https://';input.required=true;input.id='skill-url-input';const go=el('button','primary',t('importButton'));go.type='submit';
  form.append(input,go);form.onsubmit=async event=>{event.preventDefault();go.disabled=true;try{const draft=await api.skills('import-url',{url:input.value});reviewDraft(draft);}catch(e){toast(cleanError(e));go.disabled=false;}};
  reviewDialog.replaceChildren(head,el('p','quiet',t('importUrlHint')),form);if(!reviewDialog.open)reviewDialog.showModal();input.focus();
 };
})();

// ---------- Composer: scope and budget ----------
const skillsRenderChips=renderSkillChips;renderSkillChips=function(){
 skillsRenderChips();const box=$('skill-chips');if(box.hidden)return;
 box.querySelectorAll('.skill-chip-name').forEach(button=>{const skill=state.skills.find(s=>s.name===button.textContent);button.title=(skill?.description?skill.description+'\n\n':'')+t('skillScope');});
 const ids=state.chat?.SkillIds||[];if(!ids.length)return;
 api.skills('budget',{basePrompt:state.chat.SystemPrompt||'',ids}).then(b=>{if(!$('skill-chips').contains(box.firstChild))return;let note=box.querySelector('.skill-budget');if(!note){note=el('small','skill-budget quiet');box.append(note);}note.textContent=b.over?tf('skillsBudgetOver',{limit:fmt(b.limit)}):tf('skillsBudget',{tokens:fmt(b.tokens),chars:fmt(b.chars)});note.classList.toggle('warning',b.over);}).catch(()=>{});
};
const skillsLocalize=localize;localize=function(){skillsLocalize();const b=$('import-skill-url');if(b)b.textContent=t('importFromUrl');if(state.ready&&$('skill-references')){paintReferences();paintSkillMeta();}};
