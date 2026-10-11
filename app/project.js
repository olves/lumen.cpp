'use strict';
// Read-only project folder for a conversation: attach from + menu, chip in the composer, settings dialog (excludes, allowed
// sensitive files, detach), project tool activity, [F#] citations and a read-only excerpt viewer. With a project attached,
// messages go through the project tool loop (list/find/search/read); nothing is written, run or deleted.
Object.assign(translations,{
 attachProject:['Project folder','Proje klasörü'],attachProjectHint:['Read-only: let the model look through a code folder','Salt okunur: modelin bir kod klasörüne bakmasına izin ver'],
 projectChip:['Project','Proje'],projectReadOnly:['read-only','salt okunur'],projectMissing:['folder not found','klasör bulunamadı'],detachProject:['Detach project','Projeyi ayır'],
 projectTitle:['Project folder','Proje klasörü'],projectIntro:['Read-only. Lumen can list, search and read text files in this folder for this conversation. It never writes, deletes, runs or installs anything.','Salt okunur. Lumen bu sohbet için bu klasördeki metin dosyalarını listeleyebilir, arayabilir ve okuyabilir. Hiçbir şey yazmaz, silmez, çalıştırmaz veya kurmaz.'],
 projectExcluded:['Never read by default: .git, node_modules and build output, files matched by .gitignore, keys, .env and credential files, binary files and files over 1 MB.','Varsayılan olarak hiç okunmayanlar: .git, node_modules ve derleme çıktıları, .gitignore ile eşleşen dosyalar, anahtarlar, .env ve kimlik bilgisi dosyaları, ikili dosyalar ve 1 MB üzeri dosyalar.'],
 projectWeb:['Project text is never sent to web search. With web research on, only the model’s search queries go to the provider, and queries that contain file paths or file text are refused.','Proje metni web aramasına gönderilmez. Web araştırması açıkken sağlayıcıya yalnızca modelin arama sorguları gider; dosya yolu veya dosya metni içeren sorgular reddedilir.'],
 projectFiles:['{n} readable text files','{n} okunabilir metin dosyası'],projectFilesMany:['more than {n} readable text files','{n}’den fazla okunabilir metin dosyası'],
 projectExcludeLabel:['Also exclude (one pattern per line, e.g. *.min.js or docs/**)','Ayrıca dışla (her satıra bir desen, ör. *.min.js veya docs/**)'],saveExcludes:['Save','Kaydet'],
 projectAllowed:['Sensitive files you allowed','İzin verdiğin hassas dosyalar'],projectAllowNone:['None. Keys, .env and credential files stay unreadable.','Yok. Anahtarlar, .env ve kimlik bilgisi dosyaları okunamaz kalır.'],allowSensitive:['Allow a sensitive file…','Hassas bir dosyaya izin ver…'],remove:['Remove','Kaldır'],
 projectSaved:['Project settings saved','Proje ayarları kaydedildi'],projectAttached:['Project attached (read-only)','Proje bağlandı (salt okunur)'],projectDetached:['Project detached','Proje ayrıldı'],projectNotFound:['The project folder was not found. Attach it again or detach it.','Proje klasörü bulunamadı. Yeniden bağla veya ayır.'],
 actProject:['Looking through the project','Proje inceleniyor'],actProjectDone:['Looked through the project','Proje incelendi'],filesReadCount:['{n} files read','{n} dosya okundu'],oneFileRead:['1 file read','1 dosya okundu'],
 op_p_list:['Listed {label}','Listelendi: {label}'],op_p_find:['Found files “{label}” · {detail}','Dosya bulundu “{label}” · {detail}'],op_p_grep:['Searched “{label}” · {detail} matches','Arandı “{label}” · {detail} eşleşme'],op_p_read:['Read {label} · lines {detail}','Okundu {label} · satır {detail}'],
 run_p_list:['Listing {label}','Listeleniyor: {label}'],run_p_find:['Finding “{label}”','Aranıyor: “{label}”'],run_p_grep:['Searching the code for “{label}”','Kodda aranıyor: “{label}”'],run_p_read:['Reading {label}','Okunuyor: {label}'],
 viewExcerpt:['Show lines','Satırları göster'],excerptTitle:['{path} · lines {start}–{end}','{path} · satır {start}–{end}'],excerptChanged:['The file may have changed since it was read.','Dosya okunduğundan beri değişmiş olabilir.'],close:['Close','Kapat']
});
// ---------- Composer: attach, chip, sending ----------
(function addMenuItem(){
 if($('attach-project'))return;const button=el('button');button.id='attach-project';button.type='button';button.setAttribute('role','menuitem');
 const text=el('span');text.append(el('strong','',t('attachProject')),el('small','',t('attachProjectHint')));button.append(icon('paperclip'),text);
 $('attach-files').after(button);button.onclick=attachProject;
})();
async function attachProject(){
 closeComposerMenus();if(state.busy||!state.chat)return;
 try{const status=await api.projects('choose',{chatId:state.chat.Id,language:state.prefs.language});if(status){state.chat.Project={name:status.name,root:status.root,exists:status.exists!==false};upsert(state.chat);toast(t('projectAttached'));}renderToolChips();}catch(e){toast(cleanError(e));}
}
const projectRenderChips=renderToolChips;renderToolChips=function(){
 projectRenderChips();const project=state.chat?.Project;if(!project)return;
 const box=$('tool-chips');box.hidden=false;
 const chip=el('div','skill-chip tool-chip project-chip'+(project.exists===false?' missing':'')),open=el('button','project-chip-open'),remove=el('button','skill-chip-remove','×');
 open.type='button';open.title=project.root;open.append(icon('paperclip'),el('span','skill-chip-name',t('projectChip')+' · '+project.name),el('small','tool-chip-note',project.exists===false?t('projectMissing'):t('projectReadOnly')));open.onclick=openProjectDialog;
 remove.type='button';remove.title=t('detachProject');remove.setAttribute('aria-label',t('detachProject'));remove.disabled=state.busy;remove.onclick=detachProject;
 chip.append(open,remove);box.append(chip);
};
async function detachProject(){if(state.busy||!state.chat)return;try{await api.projects('detach',{chatId:state.chat.Id});delete state.chat.Project;upsert(state.chat);renderToolChips();toast(t('projectDetached'));}catch(e){toast(cleanError(e));}}
// Messages in a conversation with a project go through the project tool loop.
function sendWithProject(text,options={}){return sendWithAgent(text,{...options,mode:'project'});}
const projectSend=send;send=async function(){
 if(state.busy||!state.chat?.Project)return projectSend();
 if(state.chat.Project.exists===false){toast(t('projectNotFound'));return;}
 if(typeof photosAdding!=='undefined'&&photosAdding)return;const text=composeText();if(!text||!state.ready)return;
 const chosen=state.models.find(m=>m.Name===$('model-picker').value);if(chosen&&!chosen.Installed&&!await download(chosen.Name))return;
 if(!toolsConfig)await loadToolsConfig().catch(()=>{});if(toolsConfig&&!toolsConfig.hostReady){toast(t('toolsUnavailable'));return;}
 return sendWithProject(text);
};
const projectUpsert=upsert;upsert=function(chat){projectUpsert(chat);renderToolChips();};

// ---------- Settings dialog ----------
const projectDialog=el('dialog','project-dialog');projectDialog.id='project-dialog';document.body.append(projectDialog);
projectDialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();projectDialog.close();}});
async function openProjectDialog(){
 if(!state.chat?.Project)return;let status=null;try{status=await api.projects('status',{chatId:state.chat.Id,language:state.prefs.language});}catch(e){toast(cleanError(e));return;}
 if(!status){delete state.chat.Project;renderToolChips();return;}paintProjectDialog(status);if(!projectDialog.open)projectDialog.showModal();
}
function paintProjectDialog(status){
 const head=el('div','project-dialog-head'),close=el('button','icon-button','×');close.type='button';close.setAttribute('aria-label',t('close'));close.onclick=()=>projectDialog.close();
 head.append(el('h2','',t('projectTitle')),close);
 const where=el('div','project-where');where.append(el('strong','',status.name),el('code','',status.root),el('small','quiet',status.exists===false?t('projectNotFound'):tf(status.truncated?'projectFilesMany':'projectFiles',{n:fmt(status.files||0)})));
 const rules=el('div','project-rules');rules.append(el('p','',t('projectIntro')),el('p','quiet',t('projectExcluded')),el('p','quiet',t('projectWeb')));
 const excludeLabel=el('label','',t('projectExcludeLabel'));const exclude=el('textarea');exclude.rows=3;exclude.value=(status.exclude||[]).join('\n');exclude.id='project-exclude';excludeLabel.htmlFor='project-exclude';
 const saveExclude=el('button','secondary',t('saveExcludes'));saveExclude.type='button';saveExclude.onclick=async()=>{try{paintProjectDialog(await api.projects('exclude',{chatId:state.chat.Id,exclude:exclude.value.split(/\r?\n/)}));toast(t('projectSaved'));}catch(e){toast(cleanError(e));}};
 const allowed=el('div','project-allowed');allowed.append(el('strong','',t('projectAllowed')));
 if(!(status.allow||[]).length)allowed.append(el('p','quiet',t('projectAllowNone')));
 for(const file of status.allow||[]){const row=el('div','project-allow-row'),remove=el('button','text-button',t('remove'));remove.type='button';remove.onclick=async()=>{try{paintProjectDialog(await api.projects('disallow',{chatId:state.chat.Id,path:file}));}catch(e){toast(cleanError(e));}};row.append(el('code','',file),remove);allowed.append(row);}
 const allow=el('button','text-button',t('allowSensitive'));allow.type='button';allow.onclick=async()=>{try{paintProjectDialog(await api.projects('allow',{chatId:state.chat.Id,language:state.prefs.language}));}catch(e){toast(cleanError(e));}};allowed.append(allow);
 const actions=el('div','dialog-actions'),detach=el('button','secondary',t('detachProject'));detach.type='button';detach.onclick=async()=>{projectDialog.close();await detachProject();};actions.append(detach);
 projectDialog.replaceChildren(head,where,rules,excludeLabel,exclude,saveExclude,allowed,actions);
}

// ---------- Activity, sources, viewer ----------
const projectOpText=opText;opText=function(op){if(!/^p-/.test(op.kind||''))return projectOpText(op);const key='op_'+op.kind.replace('-','_');let text=tf(key,{label:op.label,detail:op.detail||'0'});if(op.status==='failed')text=tf('run_'+op.kind.replace('-','_'),{label:op.label})+' · '+t('opFailed')+(op.detail?': '+op.detail:'');return text;};
const projectPaintActivity=paintActivity;paintActivity=function(view){
 projectPaintActivity(view);const d=view.data;if(d.route!=='project')return;
 const task=d.tasks[0],last=task?.ops?.[task.ops.length-1];
 if(d.ended){const files=(d.sources||[]).filter(s=>s.file).length;view.label.textContent=d.cancelled?t('actStopped'):t('actProjectDone');view.meta.textContent=files?(files===1?t('oneFileRead'):tf('filesReadCount',{n:files})):'';}
 else if(d.phase==='synthesizing')view.label.textContent=t('actSynth');
 else if(last?.status==='running'&&/^p-/.test(last.kind))view.label.textContent=tf('run_'+last.kind.replace('-','_'),{label:short(last.label,60)});
 else if(d.phase!=='planning'&&d.phase!=='loading')view.label.textContent=t('actProject');
 if(!d.ended)view.meta.textContent='';
 const note=view.details.querySelector('.activity-note:not(.warning)');if(note)note.remove();
};
const projectSourcesView=sourcesView;sourcesView=function(sources){
 const wrap=projectSourcesView(sources.filter(s=>!s.file));const files=sources.filter(s=>s.file);if(!files.length)return wrap;
 let list=wrap.querySelector('.source-list');
 for(const s of files){const item=el('li','source-item file-source'),open=el('button','source-open');open.type='button';open.append(el('span','source-id',s.id),el('span','source-title',s.path),el('span','source-meta',s.site));open.title=t('viewExcerpt');open.onclick=()=>showExcerpt(s);item.append(open);list.append(item);}
 return wrap;
};
const projectLinkCitations=linkCitations;linkCitations=function(body,sources){
 projectLinkCitations(body,sources.filter(s=>!s.file));const files=new Map(sources.filter(s=>s.file).map(s=>[s.id,s]));if(!files.size)return;
 const walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())if(/\[F\d+\]/.test(walker.currentNode.data)&&!walker.currentNode.parentElement.closest('pre,code'))nodes.push(walker.currentNode);
 for(const node of nodes){const fragment=document.createDocumentFragment();let last=0;for(const match of node.data.matchAll(/\[(F\d+)\]/g)){const source=files.get(match[1]);if(!source)continue;fragment.append(node.data.slice(last,match.index));const cite=el('button','citation file-citation',match[1]);cite.type='button';cite.title=source.path+' · '+source.site;cite.onclick=()=>showExcerpt(source);fragment.append(cite);last=match.index+match[0].length;}fragment.append(node.data.slice(last));node.replaceWith(fragment);}
};
const languageByExtension={js:'javascript',cjs:'javascript',mjs:'javascript',jsx:'javascript',ts:'typescript',tsx:'typescript',py:'python',cs:'csharp',java:'java',kt:'kotlin',go:'go',rs:'rust',rb:'ruby',php:'php',c:'c',h:'c',cpp:'cpp',hpp:'cpp',cc:'cpp',swift:'swift',json:'json',yml:'yaml',yaml:'yaml',md:'markdown',css:'css',scss:'scss',less:'less',html:'xml',xml:'xml',sql:'sql',sh:'bash',ps1:'powershell',lua:'lua',r:'r',pl:'perl',ini:'ini',toml:'ini'};
async function showExcerpt(source){
 if(!state.chat?.Project){toast(t('projectNotFound'));return;}
 try{
  const r=await api.projects('excerpt',{chatId:state.chat.Id,path:source.path,start:source.start,end:source.end});
  const head=el('div','project-dialog-head'),close=el('button','icon-button','×');close.type='button';close.setAttribute('aria-label',t('close'));close.onclick=()=>projectDialog.close();
  head.append(el('h2','',tf('excerptTitle',{path:r.path,start:r.start,end:r.end})),close);
  const pre=el('pre','excerpt'),code=el('code','hljs');const lang=languageByExtension[(r.path.split('.').pop()||'').toLowerCase()];
  const numbered=r.text.split('\n');code.textContent=r.text;if(lang&&hljs.getLanguage(lang)&&r.text.length<150000){try{code.innerHTML=hljs.highlight(r.text,{language:lang,ignoreIllegals:true}).value;}catch{}}
  const gutter=el('div','excerpt-gutter');gutter.textContent=numbered.map((_,i)=>r.start+i).join('\n');const body=el('div','excerpt-body md');pre.append(code);body.append(gutter,pre);
  projectDialog.replaceChildren(head,body);if(!projectDialog.open)projectDialog.showModal();
 }catch(e){toast(cleanError(e));}
}
const projectLocalize=localize;localize=function(){projectLocalize();const b=$('attach-project');if(b){b.querySelector('strong').textContent=t('attachProject');b.querySelector('small').textContent=t('attachProjectHint');}if(state.ready)renderToolChips();};
