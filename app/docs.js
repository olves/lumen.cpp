'use strict';
// Documents in a conversation (documents.cjs): "+ → Documents", a composer chip with the list, and [D#] sources under replies
// that open the excerpt the model was given. Documents are read on this computer; nothing is uploaded.
Object.assign(translations,{
 attachDocs:['Documents','Belgeler'],attachDocsHint:['PDF, Word or text · answers cite pages','PDF, Word veya metin · yanıtlar sayfa gösterir'],
 docsChip:['Documents · {n}','Belgeler · {n}'],docsChipNote:['answers cite them','yanıtlar kaynak gösterir'],docsReading:['Reading {name}…','{name} okunuyor…'],
 docsAdded:['{n} added to this conversation.','{n} belge bu sohbete eklendi.'],docsTitle:['Documents in this conversation','Bu sohbetteki belgeler'],
 docsNote:['Read on this computer. Short documents go to the model whole; for long ones, the passages that best match each message. Answers cite them as [D1], [D2]…','Bu bilgisayarda okunur. Kısa belgeler modele tamamen gider; uzunlarda her mesaja en uygun bölümler. Yanıtlar bunları [D1], [D2]… diye gösterir.'],
 docsMore:['Add documents…','Belge ekle…'],docsRemove:['Remove from this conversation','Bu sohbetten çıkar'],docsEmpty:['No documents yet.','Henüz belge yok.'],
 docsPages:['{n} pages','{n} sayfa'],docsParts:['{n} parts','{n} bölüm'],docsSources:['From your documents','Belgelerinden'],docsPage:['page {n}','sayfa {n}'],docsPart:['part {n}','bölüm {n}'],
 docsUncited:['Given to the model, not cited','Modele verildi, alıntılanmadı'],docsExcerptTitle:['{name} · {where}','{name} · {where}'],
 docsResearchNote:['Research and project answers do not read documents yet.','Araştırma ve proje yanıtları henüz belgeleri okumuyor.'],
 docFail_unsupported:['{name}: this file type is not supported','{name}: bu dosya türü desteklenmiyor'],docFail_unreadable:['{name}: could not be read','{name}: okunamadı'],
 docFail_password:['{name}: the PDF is password-protected','{name}: PDF parola korumalı'],docFail_no_text:['{name}: no text found (a scanned PDF needs OCR)','{name}: metin bulunamadı (taranmış PDF için OCR gerekir)'],
 docFail_too_large:['{name}: larger than 64 MB','{name}: 64 MB’tan büyük'],docFail_too_many:['At most 10 documents per conversation','Sohbet başına en fazla 10 belge'],docFail_empty:['{name}: the file is empty','{name}: dosya boş'],
 docFail_timeout:['{name}: reading took too long','{name}: okuma çok uzun sürdü'],docFail_too_many_pages:['{name}: more than 2,000 pages','{name}: 2.000 sayfadan fazla'],docFail_too_much_text:['{name}: too much text','{name}: metin çok uzun'],
});
let chatDocs=[],chatDocsId=null;
const docsDialog=el('dialog','project-dialog docs-dialog');docsDialog.id='docs-dialog';document.body.append(docsDialog);

(function addMenuItem(){
 if($('attach-docs'))return;const button=el('button');button.id='attach-docs';button.type='button';button.setAttribute('role','menuitem');
 const text=el('span');text.append(el('strong','',t('attachDocs')),el('small','',t('attachDocsHint')));button.append(icon('book'),text);
 $('attach-files').after(button);button.onclick=addDocuments;
})();
async function loadDocs(){const id=state.chat?.Id;if(!id)return;chatDocsId=id;try{const list=await api.documents('list',{chatId:id});if(state.chat?.Id===id){chatDocs=list;renderToolChips();}}catch{}}
async function addDocuments(){
 closeComposerMenus();if(!state.chat)return;const id=state.chat.Id;
 try{
  const r=await api.documents('add',{chatId:id});if(state.chat?.Id===id)chatDocs=r.documents;renderToolChips();
  const msgs=[];if(r.added.length)msgs.push(tf('docsAdded',{n:fmt(r.added.length)}));for(const f of r.failed){const key='docFail_'+String(f.reason).replace(/-/g,'_');msgs.push(translations[key]?tf(key,{name:f.name}):f.name+': '+f.reason);}
  if(msgs.length)toast(msgs.join(' '));if(docsDialog.open)paintDocsDialog();
 }catch(e){toast(cleanError(e));}
}
api.onChannel('document-event',e=>{if(e.phase==='reading'&&e.chatId===state.chat?.Id)toast(tf('docsReading',{name:e.name}));});
const docsRenderChips=renderToolChips;renderToolChips=function(){
 docsRenderChips();if(!chatDocs.length||chatDocsId!==state.chat?.Id)return;
 const box=$('tool-chips');box.hidden=false;const chip=el('div','skill-chip tool-chip project-chip docs-chip'),open=el('button','project-chip-open');open.type='button';
 open.title=chatDocs.map(d=>d.name).join('\n');open.append(icon('book'),el('span','skill-chip-name',tf('docsChip',{n:fmt(chatDocs.length)})),el('small','tool-chip-note',t('docsChipNote')));open.onclick=openDocsDialog;
 chip.append(open);box.append(chip);
};
function docSize(d){return d.paged?tf('docsPages',{n:fmt(d.pages)}):d.pages>1?tf('docsParts',{n:fmt(d.pages)}):'';}
function paintDocsDialog(){
 const head=el('div','project-dialog-head'),close=el('button','icon-button','×');close.type='button';close.setAttribute('aria-label',t('close'));close.onclick=()=>docsDialog.close();head.append(el('h2','',t('docsTitle')),close);
 const list=el('div','docs-list');if(!chatDocs.length)list.append(el('p','quiet',t('docsEmpty')));
 for(const d of chatDocs){
  const row=el('div','docs-row'),info=el('div','docs-info');info.append(el('strong','',d.name),el('small','',[d.kind.toUpperCase(),docSize(d),modelSize(d.size)].filter(Boolean).join(' · ')));
  const remove=el('button','text-button',t('docsRemove'));remove.type='button';remove.disabled=state.busy;
  remove.onclick=async()=>{try{chatDocs=await api.documents('remove',{chatId:state.chat.Id,id:d.id});renderToolChips();paintDocsDialog();}catch(e){toast(cleanError(e));}};
  row.append(icon('book'),info,remove);list.append(row);
 }
 const add=el('button','secondary',t('docsMore'));add.type='button';add.onclick=addDocuments;
 const foot=el('div','dialog-actions');foot.append(add);
 docsDialog.replaceChildren(head,el('p','quiet docs-note',t('docsNote')),list,foot);if(state.chat?.Project||researchMode)docsDialog.insertBefore(el('p','quiet docs-note',t('docsResearchNote')),list);
}
function openDocsDialog(){paintDocsDialog();if(!docsDialog.open)docsDialog.showModal();}

// ---------- Sources under replies ----------
function docWhere(s){return s.paged?tf('docsPage',{n:s.page}):tf('docsPart',{n:s.page});}
function showDocExcerpt(s){
 const head=el('div','project-dialog-head'),close=el('button','icon-button','×');close.type='button';close.setAttribute('aria-label',t('close'));close.onclick=()=>docsDialog.close();
 head.append(el('h2','',tf('docsExcerptTitle',{name:s.name,where:docWhere(s)})),close);
 const body=el('div','doc-excerpt');body.textContent=s.excerpt;docsDialog.replaceChildren(head,body);if(!docsDialog.open)docsDialog.showModal();
}
function docSourcesView(sources){
 const wrap=el('div','sources doc-sources'),title=el('div','sources-title',t('docsSources')),list=el('ol','source-list');
 for(const s of sources){
  const item=el('li','source-item doc-source'+(s.cited?'':' uncited')),open=el('button','source-open');open.type='button';
  open.append(el('span','source-id',s.id),el('span','source-title',s.name),el('span','source-meta',docWhere(s)+(s.cited?'':' · '+t('docsUncited'))));open.onclick=()=>showDocExcerpt(s);item.append(open);list.append(item);
 }
 wrap.append(title,list);return wrap;
}
function linkDocCitations(body,sources){
 const map=new Map(sources.map(s=>[s.id,s]));const walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT),nodes=[];
 while(walker.nextNode())if(/\[D\d+\]/.test(walker.currentNode.data)&&!walker.currentNode.parentElement.closest('pre,code'))nodes.push(walker.currentNode);
 for(const node of nodes){
  const fragment=document.createDocumentFragment();let last=0;
  for(const m of node.data.matchAll(/\[(D\d+)\]/g)){const s=map.get(m[1]);if(!s)continue;fragment.append(node.data.slice(last,m.index));const cite=el('button','citation doc-citation',m[1]);cite.type='button';cite.title=s.name+' · '+docWhere(s);cite.onclick=()=>showDocExcerpt(s);fragment.append(cite);last=m.index+m[0].length;}
  fragment.append(node.data.slice(last));node.replaceWith(fragment);
 }
}
const docsMessageNode=messageNode;messageNode=function(m,index,stream=false){
 const result=docsMessageNode(m,index,stream);
 if(m.Role==='assistant'&&Array.isArray(m.DocSources)&&m.DocSources.length&&!stream){
  const shown=m.DocSources.some(s=>s.cited)?m.DocSources.filter(s=>s.cited):m.DocSources;linkDocCitations(result.body,m.DocSources);result.body.after(docSourcesView(shown));
 }
 return result;
};
// A different conversation loads its own documents.
const docsRenderMessages=renderMessages;renderMessages=function(){docsRenderMessages();if(state.chat&&state.chat.Id!==chatDocsId){chatDocs=[];loadDocs();}};
const docsLocalize=localize;localize=function(){docsLocalize();const b=$('attach-docs');if(b){b.querySelector('strong').textContent=t('attachDocs');b.querySelector('small').textContent=t('attachDocsHint');}};
