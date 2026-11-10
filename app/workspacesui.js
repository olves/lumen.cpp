'use strict';
// v1.1 workspaces and permission modes in the renderer (core: workspaces.cjs, permissions.cjs, coder.cjs).
//   Sidebar: the conversation list is grouped by workspace (collapsible, chat count, relative time); each header has "+" (new
//   conversation in this workspace) and "…" (Rename, Show in folder, Delete workspace); a "New workspace" button sits above.
//   Composer: the project chip shows the workspace's mode; a menu picks Ask / Accept edits / Plan / Auto / Full access; Full shows a
//   red badge. "+ → Workspace folder" attaches the conversation's workspace folder; the dialog can still pick another folder.
//   Agent cards (coder.cjs events): folder/delete/move/command/outside-read approvals with an "outside the folder" warning, and a
//   live log of each command's output.
Object.assign(translations,{
 workspaces:['Workspaces','Çalışma alanları'],defaultWorkspace:['Default workspace','Varsayılan çalışma alanı'],
 newWorkspace:['New workspace','Yeni çalışma alanı'],newChatHere:['New conversation in {name}','{name} içinde yeni sohbet'],workspaceMenu:['Workspace actions: {name}','Çalışma alanı işlemleri: {name}'],
 wsRename:['Rename','Yeniden adlandır'],wsShowFolder:['Show in folder','Klasörde göster'],wsDelete:['Delete workspace','Çalışma alanını sil'],
 wsMoveChat:['Move to workspace','Çalışma alanına taşı'],
 wsDeleteConfirm:['Delete the workspace “{name}”? Its conversations move to the Default workspace. The folder on disk is not deleted.','“{name}” çalışma alanı silinsin mi? Sohbetleri Varsayılan çalışma alanına taşınır. Diskteki klasör silinmez.'],
 wsDeleted:['Workspace deleted; its folder was kept.','Çalışma alanı silindi; klasörü korundu.'],
 wsCreateTitle:['New workspace','Yeni çalışma alanı'],wsName:['Name','Ad'],wsFolderDefault:['Folder: Documents\\Lumen\\{name}','Klasör: Belgeler\\Lumen\\{name}'],
 wsPickFolder:['Use another folder…','Başka bir klasör kullan…'],wsCreate:['Create','Oluştur'],wsCancel:['Cancel','İptal'],wsEmpty:['No conversations yet','Henüz sohbet yok'],
 wsRenameTitle:['Rename workspace','Çalışma alanını yeniden adlandır'],wsSave:['Save','Kaydet'],
 attachWorkspace:['Workspace folder','Çalışma alanı klasörü'],attachWorkspaceHint:['Let the agent work in this workspace’s folder','Ajanın bu çalışma alanının klasöründe çalışmasına izin ver'],
 projectChooseOther:['Use another folder for this conversation…','Bu sohbet için başka bir klasör kullan…'],
 projectIntro:['The agent works in this folder. What it may do without asking depends on the mode in the message box: file changes of a task can be undone; the effects of commands cannot.','Ajan bu klasörde çalışır. Sormadan neleri yapabileceği mesaj kutusundaki moda bağlıdır: bir görevdeki dosya değişiklikleri geri alınabilir; komutların etkileri geri alınamaz.'],
 projectAttached:['Workspace folder attached','Çalışma alanı klasörü bağlandı'],
 mode_ask:['Ask','Sor'],mode_accept_edits:['Accept edits','Düzenlemeleri kabul et'],mode_plan:['Plan','Plan'],mode_auto:['Auto','Otomatik'],mode_full:['Full access','Tam erişim'],
 modeHint_ask:['Every change and every command asks first.','Her değişiklik ve komut için önce izin istenir.'],
 modeHint_accept_edits:['File changes in the folder run at once; commands ask.','Klasördeki dosya değişiklikleri hemen uygulanır; komutlar için izin istenir.'],
 modeHint_plan:['Reads only and writes a plan. Changes nothing.','Yalnızca okur ve plan yazar. Hiçbir şeyi değiştirmez.'],
 modeHint_auto:['File changes run; read-only commands run; other commands ask. A convenience filter, not a sandbox.','Dosya değişiklikleri uygulanır; salt okunur komutlar çalışır; diğer komutlar için izin istenir. Bir kolaylık süzgecidir, güvenlik sınırı değildir.'],
 modeHint_full:['Never asks, outside the folder too. Commands can change anything your account can.','Klasör dışında da hiç sormaz. Komutlar hesabının değiştirebileceği her şeyi değiştirebilir.'],
 modeLabel:['Mode: {mode}','Mod: {mode}'],modeOutsideNote:['Outside the folder every mode except Full access asks each time.','Klasör dışında Tam erişim dışındaki her mod her seferinde sorar.'],
 modeSaved:['Mode: {mode}','Mod: {mode}'],modeFullConfirm:['Full access: the agent will change files and run commands anywhere without asking. Continue?','Tam erişim: ajan her yerde dosya değiştirip komut çalıştıracak, hiç sormadan. Devam edilsin mi?'],
 cardOutside:['Outside the workspace folder','Çalışma alanı klasörünün dışında'],cardRead:['Read outside the folder','Klasör dışında okuma'],cardMkdir:['Create folder','Klasör oluştur'],
 cardDelete:['Delete','Sil'],cardDeleteFolder:['Delete folder ({n} files)','Klasörü sil ({n} dosya)'],cardMove:['Move','Taşı'],cardCommand:['Run command','Komut çalıştır'],cardBackground:['Run in the background','Arka planda çalıştır'],
 cardAllow:['Allow','İzin ver'],cardRun:['Run','Çalıştır'],cardIn:['in {folder}','{folder} içinde'],cardNoUndo:['A command’s effects cannot be undone.','Komutun etkileri geri alınamaz.'],
 cmdExit:['exit code {code}','çıkış kodu {code}'],cmdTimeout:['timed out, stopped','süre doldu, durduruldu'],cmdBackground:['running in the background','arka planda çalışıyor'],cmdAuto:['ran without asking ({mode})','sormadan çalıştı ({mode})'],
 op_p_run:['Ran {label} · {detail}','Çalıştırıldı {label} · {detail}'],run_p_run:['Running {label}','Çalışıyor: {label}'],
});
Object.assign(paths,{more:'M4 9h.01M9 9h.01M14 9h.01',chevron:'M6 7l3 3 3-3',folderPlus:'M2.5 5V14h13V6.5H9L7.5 4.5h-5zM9 8.5v4M7 10.5h4'});
const AGENT_MODES=['ask','accept-edits','plan','auto','full'];
const modeKey=m=>'mode_'+String(m).replace('-','_'),modeHintKey=m=>'modeHint_'+String(m).replace('-','_');
let wsState={list:[],assignments:{},commands:false,loaded:false};
const wsCollapsed=new Set((()=>{try{return JSON.parse(localStorage.getItem('lumen-ws-collapsed')||'[]');}catch{return [];}})());
function saveCollapsed(){try{localStorage.setItem('lumen-ws-collapsed',JSON.stringify([...wsCollapsed]));}catch{}}
async function loadWorkspaces(){try{const r=await api.workspaces('list',{});wsState={...r,loaded:true};}catch{}return wsState;}
const wsName=w=>w.isDefault?(w.name||t('defaultWorkspace')):w.name;
const wsOf=chat=>{const id=wsState.assignments[chat?.Id];return wsState.list.find(w=>w.id===id)||wsState.list.find(w=>w.isDefault)||null;};
function ago(iso){const ms=Date.now()-Date.parse(iso||'');if(!Number.isFinite(ms)||ms<0)return '';const m=Math.floor(ms/60000),h=Math.floor(m/60),d=Math.floor(h/24);
 if(m<1)return state.prefs.language==='tr'?'şimdi':'now';if(m<60)return m+(state.prefs.language==='tr'?' dk':'m');if(h<24)return h+(state.prefs.language==='tr'?' sa':'h');if(d<30)return d+(state.prefs.language==='tr'?' g':'d');return Math.floor(d/30)+(state.prefs.language==='tr'?' ay':'mo');}

// ---------- Sidebar ----------
(function sidebarHeader(){
 const label=document.querySelector('.sidebar > .rail-label');if(!label||$('new-workspace'))return;
 const head=el('div','ws-head'),add=el('button','icon-button ws-new');add.id='new-workspace';add.type='button';add.append(icon('folderPlus'));
 add.title=t('newWorkspace');add.setAttribute('aria-label',t('newWorkspace'));add.onclick=()=>openWorkspaceDialog();
 label.removeAttribute('data-i18n');label.textContent=t('workspaces');label.replaceWith(head);head.append(label,add);
})();
const wsRenderHistory=renderHistory;renderHistory=function(){
 wsRenderHistory();
 const list=$('history');if(!wsState.loaded){loadWorkspaces().then(()=>{if(wsState.loaded)renderHistory();});return;}
 if(list.querySelector('.search-result,.search-empty'))return;list.querySelector(':scope > .history-empty')?.remove();
 // The base list is pinned rows (with their label) then the rest; the rest is regrouped by workspace.
 const pins=pinnedIds(),byId=new Map(state.chats.map(c=>[c.Id,c])),pinned=pins.map(id=>byId.get(id)).filter(Boolean),rest=state.chats.filter(c=>!pins.includes(c.Id)).slice(0,120);
 const order=[...pinned,...rest],rows=[...list.querySelectorAll(':scope > .history-row')];if(rows.length!==order.length)return;
 rows.forEach((row,i)=>{row.dataset.chat=order[i].Id;const time=ago(order[i].Updated);if(time)row.querySelector('.history-pin')?.before(el('small','history-time',time));});
 list.querySelectorAll(':scope > .history-group-label').forEach(l=>{if(l.textContent===t('recent'))l.remove();});
 const label=document.querySelector('.ws-head .rail-label');if(label){label.hidden=false;label.textContent=t('workspaces');}
 const groups=new Map(wsState.list.map(w=>[w.id,[]]));
 rows.slice(pinned.length).forEach((row,i)=>{const w=wsOf(rest[i]);groups.get(w?.id)?.push(row);row.remove();});
 for(const w of wsState.list){
  const items=groups.get(w.id)||[],open=!wsCollapsed.has(w.id),section=el('section','ws-group'+(open?'':' collapsed'));section.dataset.workspace=w.id;
  const head=el('div','ws-group-head'),toggle=el('button','ws-toggle');toggle.type='button';toggle.setAttribute('aria-expanded',String(open));
  toggle.append(icon('chevron'),icon('folder'),el('span','ws-name',wsName(w)),el('small','ws-count',String(items.length)));toggle.title=w.root;
  toggle.onclick=()=>{if(wsCollapsed.has(w.id))wsCollapsed.delete(w.id);else wsCollapsed.add(w.id);saveCollapsed();renderHistory();};
  const add=el('button','icon-button ws-add');add.type='button';add.append(icon('plus'));add.title=tf('newChatHere',{name:wsName(w)});add.setAttribute('aria-label',add.title);add.disabled=state.busy;add.onclick=()=>newChatIn(w);
  const more=el('button','icon-button ws-more');more.type='button';more.append(icon('more'));more.setAttribute('aria-label',tf('workspaceMenu',{name:wsName(w)}));more.setAttribute('aria-haspopup','menu');more.onclick=e=>{e.stopPropagation();workspaceMenu(w,more);};
  head.append(toggle,add,more);section.append(head);
  const body=el('div','ws-items');body.hidden=!open;if(items.length)body.append(...items);else body.append(el('p','ws-empty',t('wsEmpty')));
  section.append(body);list.append(section);
 }
};
async function newChatIn(w){
 if(state.busy)return;clearDraftFiles();const chat=fresh($('model-picker').value);
 try{await api.workspaces('assign',{chatId:chat.Id,id:w.id,language:state.prefs.language});wsState.assignments={...wsState.assignments,...(w.isDefault?{}:{[chat.Id]:w.id})};
  if(!w.isDefault){const s=await api.projects('use-workspace',{chatId:chat.Id,language:state.prefs.language});if(s)chat.Project={name:s.name,root:s.root,exists:s.exists!==false,workspaceFolder:true,mode:w.mode};}
  chat.Workspace={id:w.id,name:w.name,mode:w.mode,root:w.root,isDefault:w.isDefault};
 }catch(e){toast(cleanError(e));}
 upsert(chat);setPage('chat');renderMessages();$('prompt')?.focus();
}
function closeWsMenus(){document.querySelectorAll('.ws-menu').forEach(m=>m.remove());}
document.addEventListener('click',e=>{if(!e.target.closest?.('.ws-menu'))closeWsMenus();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeWsMenus();});
function floatingMenu(anchor,items){
 closeWsMenus();const menu=el('div','ws-menu composer-menu');menu.setAttribute('role','menu');
 for(const it of items){if(!it)continue;const b=el('button',it.danger?'danger':'');b.type='button';b.setAttribute('role',it.checked===undefined?'menuitem':'menuitemradio');if(it.checked!==undefined)b.setAttribute('aria-checked',String(it.checked));
  if(it.hint){const s=el('span');s.append(el('strong','',it.label),el('small','',it.hint));b.append(s);}else b.textContent=it.label;b.onclick=()=>{closeWsMenus();it.run();};menu.append(b);}
 document.body.append(menu);const r=anchor.getBoundingClientRect(),h=menu.offsetHeight,w=menu.offsetWidth;
 menu.style.left=Math.max(8,Math.min(innerWidth-w-8,r.left))+'px';menu.style.top=(r.bottom+h+8>innerHeight?Math.max(8,r.top-h-4):r.bottom+4)+'px';
 menu.querySelector('button')?.focus();
 menu.addEventListener('keydown',e=>{const bs=[...menu.querySelectorAll('button')],i=bs.indexOf(document.activeElement);if(e.key==='ArrowDown'){e.preventDefault();bs[(i+1)%bs.length].focus();}if(e.key==='ArrowUp'){e.preventDefault();bs[(i-1+bs.length)%bs.length].focus();}if(e.key==='Escape'){closeWsMenus();anchor.focus();}});
 return menu;
}
function workspaceMenu(w,anchor){
 floatingMenu(anchor,[
  !w.isDefault&&{label:t('wsRename'),run:()=>openWorkspaceDialog(w)},
  {label:t('wsShowFolder'),run:async()=>{try{await api.workspaces('open-folder',{id:w.id});}catch(e){toast(cleanError(e));}}},
  !w.isDefault&&{label:t('wsDelete'),danger:true,run:async()=>{if(!confirm(tf('wsDeleteConfirm',{name:w.name})))return;try{const r=await api.workspaces('remove',{id:w.id,language:state.prefs.language});wsState={...r,loaded:true};toast(t('wsDeleted'));renderHistory();}catch(e){toast(cleanError(e));}}},
 ]);
}
// Move a conversation to another workspace: right-click on its row.
$('history').addEventListener('contextmenu',e=>{
 const row=e.target.closest('.history-row[data-chat]');if(!row||state.busy)return;e.preventDefault();const chat=state.chats.find(c=>c.Id===row.dataset.chat);if(!chat)return;const current=wsOf(chat);
 floatingMenu(row,wsState.list.map(w=>({label:wsName(w),checked:w.id===current?.id,run:async()=>{try{wsState={...await api.workspaces('assign',{chatId:chat.Id,id:w.id,language:state.prefs.language}),loaded:true};
  const fresh=await api.projects('status',{chatId:chat.Id,language:state.prefs.language}).catch(()=>null);
  chat.Workspace={id:w.id,name:w.name,mode:w.mode,root:w.root,isDefault:w.isDefault};if(fresh)chat.Project={name:fresh.name,root:fresh.root,exists:fresh.exists!==false,workspaceFolder:true,mode:w.mode};else delete chat.Project;
  upsert(chat);renderHistory();}catch(err){toast(cleanError(err));}}})));
});

// New / rename dialog.
const wsDialog=el('dialog','project-dialog ws-dialog');wsDialog.id='workspace-dialog';document.body.append(wsDialog);
function openWorkspaceDialog(existing=null){
 const head=el('div','project-dialog-head'),close=el('button','icon-button','×');close.type='button';close.setAttribute('aria-label',t('close'));close.onclick=()=>wsDialog.close();
 head.append(el('h2','',t(existing?'wsRenameTitle':'wsCreateTitle')),close);
 const label=el('label','',t('wsName')),input=el('input');input.id='workspace-name';input.maxLength=60;input.value=existing?.name||'';label.htmlFor='workspace-name';
 const folder=el('p','quiet ws-folder-note');const note=()=>{folder.textContent=existing?existing.root:tf('wsFolderDefault',{name:input.value.trim()||'…'});};note();input.oninput=note;
 const actions=el('div','dialog-actions'),cancel=el('button','secondary',t('wsCancel')),pick=el('button','secondary ws-pick',t('wsPickFolder')),ok=el('button','primary ws-create',t(existing?'wsSave':'wsCreate'));
 [cancel,pick,ok].forEach(b=>b.type='button');cancel.onclick=()=>wsDialog.close();
 const submit=async pickFolder=>{const name=input.value.trim();if(!name){input.focus();return;}[pick,ok].forEach(b=>b.disabled=true);
  try{if(existing){wsState={...await api.workspaces('rename',{id:existing.id,name,language:state.prefs.language}),loaded:true};wsDialog.close();renderHistory();return;}
   const r=await api.workspaces('create',{name,pick:pickFolder,language:state.prefs.language});wsState={...r,loaded:true};if(!r.created){[pick,ok].forEach(b=>b.disabled=false);return;}
   wsDialog.close();wsCollapsed.delete(r.created.id);renderHistory();await newChatIn(r.created);}
  catch(e){toast(cleanError(e));[pick,ok].forEach(b=>b.disabled=false);}};
 ok.onclick=()=>submit(false);pick.onclick=()=>submit(true);input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();submit(false);}};
 actions.append(cancel,...(existing?[]:[pick]),ok);wsDialog.replaceChildren(head,label,input,folder,actions);
 wsDialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();wsDialog.close();}});
 if(!wsDialog.open)wsDialog.showModal();input.focus();input.select();
}

// ---------- Composer: workspace folder and mode ----------
(function attachRow(){
 const b=$('attach-project');if(!b)return;b.onclick=attachWorkspaceFolder;
 const s=b.querySelector('strong'),h=b.querySelector('small');if(s)s.textContent=t('attachWorkspace');if(h)h.textContent=t('attachWorkspaceHint');
})();
async function attachWorkspaceFolder(){
 closeComposerMenus();if(state.busy||!state.chat)return;
 try{const status=await api.projects('use-workspace',{chatId:state.chat.Id,language:state.prefs.language});if(status){const w=wsOf(state.chat);state.chat.Project={name:status.name,root:status.root,exists:status.exists!==false,workspaceFolder:true,mode:w?.mode||'ask'};upsert(state.chat);toast(t('projectAttached'));}renderToolChips();}catch(e){toast(cleanError(e));}
}
const currentMode=()=>wsOf(state.chat)?.mode||state.chat?.Workspace?.mode||'ask';
const wsRenderChips=renderToolChips;renderToolChips=function(){
 wsRenderChips();const chip=document.querySelector('#tool-chips .project-chip');if(!chip||!state.chat?.Project)return;
 chip.querySelector('.tool-chip-note')?.remove();chip.querySelector('.mode-chip')?.remove();
 const mode=currentMode(),button=el('button','mode-chip'+(mode==='full'?' danger':''));button.type='button';button.disabled=state.busy;
 button.textContent=t(modeKey(mode));button.title=tf('modeLabel',{mode:t(modeKey(mode))})+' — '+t(modeHintKey(mode));button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-label',button.title);
 button.onclick=e=>{e.stopPropagation();modeMenu(button);};
 chip.querySelector('.project-chip-open')?.after(button);
};
function modeMenu(anchor){
 const now=currentMode();
 const menu=floatingMenu(anchor,AGENT_MODES.map(m=>({label:t(modeKey(m)),hint:t(modeHintKey(m)),checked:m===now,danger:m==='full',run:()=>setMode(m)})));
 menu.append(el('p','ws-menu-note',t('modeOutsideNote')));
}
async function setMode(mode){
 const w=wsOf(state.chat);if(!w)return;if(mode==='full'&&w.mode!=='full'&&!confirm(t('modeFullConfirm')))return;
 try{wsState={...await api.workspaces('mode',{id:w.id,mode,language:state.prefs.language}),loaded:true};if(state.chat.Project)state.chat.Project.mode=mode;if(state.chat.Workspace)state.chat.Workspace.mode=mode;renderToolChips();toast(tf('modeSaved',{mode:t(modeKey(mode))}));}catch(e){toast(cleanError(e));}
}
// Project dialog: the v1.0.8 "Allow edits" switch gives way to the mode; another folder can still be picked.
const wsPaintDialog=paintProjectDialog;paintProjectDialog=function(status){
 wsPaintDialog(status);projectDialog.querySelector('.coding-switch')?.setAttribute('hidden','');
 const actions=projectDialog.querySelector('.dialog-actions');if(!actions||actions.querySelector('.project-choose'))return;
 const other=el('button','secondary project-choose',t('projectChooseOther'));other.type='button';
 other.onclick=async()=>{try{const s=await api.projects('choose',{chatId:state.chat.Id,language:state.prefs.language});if(s){state.chat.Project={name:s.name,root:s.root,exists:s.exists!==false,mode:currentMode()};upsert(state.chat);paintProjectDialog(s);}}catch(e){toast(cleanError(e));}};
 actions.prepend(other);
};
const wsUpsert=upsert;upsert=function(chat){wsUpsert(chat);if(wsState.loaded&&chat?.Workspace&&!chat.Workspace.isDefault&&!wsState.assignments[chat.Id])wsState.assignments={...wsState.assignments,[chat.Id]:chat.Workspace.id};};
const wsLocalize=localize;localize=function(...args){const r=wsLocalize(...args);const label=document.querySelector('.ws-head .rail-label');if(label)label.textContent=t('workspaces');const b=$('new-workspace');if(b){b.title=t('newWorkspace');b.setAttribute('aria-label',t('newWorkspace'));}const a=$('attach-project');if(a){const s=a.querySelector('strong'),h=a.querySelector('small');if(s)s.textContent=t('attachWorkspace');if(h)h.textContent=t('attachWorkspaceHint');}return r;};
const wsBusy=setBusy;setBusy=function(busy,...args){const r=wsBusy(busy,...args);document.querySelectorAll('.ws-add,.mode-chip').forEach(b=>b.disabled=busy);return r;};

// ---------- Agent cards for v1.1 actions ----------
const cmdLogs=new Map();
listen('agent-event',event=>{
 const run=typeof agentRun!=='undefined'?agentRun:null;if(!run||(event.runId&&event.runId!==run.runId))return;
 if(event.type==='edit-approval'){
  const c=event.change;if(!c||c.kind==='edit'||c.kind==='create'){if(c?.warn)queueMicrotask(()=>markOutside(event.callId));return;}
  // coding.js drew its edit card; v1.1 kinds get their own body.
  queueMicrotask(()=>{
   const card=[...document.querySelectorAll('.edit-card')].at(-1);if(!card)return;card.classList.add('v11-card','kind-'+c.kind);
   const head=card.querySelector('.edit-head'),title=head?.querySelector('strong'),path=head?.querySelector('.edit-path'),counts=head?.querySelector('.edit-counts');
   counts?.remove();card.querySelector('.edit-diff,.edit-more')?.remove();
   if(title)title.textContent=c.kind==='read'?t('cardRead'):c.kind==='mkdir'?t('cardMkdir'):c.kind==='delete'?(c.isDir?tf('cardDeleteFolder',{n:fmt(c.files||0)}):t('cardDelete')):c.kind==='move'?t('cardMove'):c.background?t('cardBackground'):t('cardCommand');
   if(c.kind==='command'){path?.remove();const pre=el('pre','cmd-text',c.command);head.after(pre);pre.after(el('small','quiet cmd-where',tf('cardIn',{folder:c.cwd})),el('small','quiet cmd-noundo',t('cardNoUndo')));}
   else if(c.kind==='move'&&path)path.textContent=c.path+' → '+c.to;
   const apply=card.querySelector('.edit-apply');if(apply)apply.textContent=c.kind==='command'?t('cardRun'):c.kind==='read'?t('cardAllow'):t('codingApply');
   if(c.kind==='command'||c.kind==='read'||c.warn)card.querySelector('.edit-apply-all')?.remove();
   if(c.kind==='delete'&&c.hunks?.length&&!c.isDir){const d=diffView(c);card.querySelector('.approval-actions')?.before(d);}
   if(c.warn)markOutside(event.callId,card);
  });
 }else if(event.type==='command-start'){
  const box=el('details','cmd-log');box.open=true;const sum=el('summary');sum.append(el('code','',short(event.command,140)),el('small','cmd-status',event.background?t('cmdBackground'):''));
  if(event.auto)sum.append(el('small','quiet',' · '+tf('cmdAuto',{mode:t(modeKey(currentMode()))})));
  box.append(sum,el('pre','cmd-out'));run.view.root.after(box);cmdLogs.set(event.callId,box);
 }else if(event.type==='command-output'){
  const box=cmdLogs.get(event.callId),pre=box?.querySelector('.cmd-out');if(!pre)return;
  pre.textContent+=event.lines.map(l=>(l.s==='e'?'! ':'')+l.d).join('\n')+'\n';if(pre.textContent.length>60000)pre.textContent='…'+pre.textContent.slice(-50000);pre.scrollTop=pre.scrollHeight;
 }else if(event.type==='edit-done'&&event.decision==='ran'){
  const box=cmdLogs.get(event.callId);if(!box)return;const s=box.querySelector('.cmd-status');
  if(s&&!event.background){s.textContent=event.timedOut?t('cmdTimeout'):tf('cmdExit',{code:event.code});box.classList.toggle('failed',event.code!==0||!!event.timedOut);}
  if(!event.background&&event.code===0)box.open=false;
 }
});
function markOutside(callId,card){card??=[...document.querySelectorAll('.edit-card')].at(-1);if(!card||card.querySelector('.outside-warn'))return;card.classList.add('outside');const w=el('p','outside-warn',t('cardOutside'));card.querySelector('.edit-head')?.after(w);}
loadWorkspaces().then(()=>{renderHistory();renderToolChips();});

// ---------- Settings → Plugins: built-in agent tools (v1.1) ----------
// Cards like the plugin grid: what the agent can use in a workspace folder. Files and changes follow the mode; commands, background
// commands and project instructions can be switched off (coding-settings.json tools). Web research has its own settings page.
Object.assign(translations,{
 builtinTitle:['Built-in tools','Yerleşik araçlar'],builtinIntro:['What the agent can use in a workspace folder. The mode in the message box decides what asks first.','Ajanın bir çalışma alanı klasöründe kullanabildikleri. Neyin önce soracağına mesaj kutusundaki mod karar verir.'],
 bt_files:['Files','Dosyalar'],bt_files_d:['List, find, search and read text files.','Metin dosyalarını listeler, bulur, arar ve okur.'],
 bt_changes:['File changes','Dosya değişiklikleri'],bt_changes_d:['Edit, create, move and delete files and folders; a task’s changes can be undone.','Dosya ve klasörleri düzenler, oluşturur, taşır ve siler; bir görevin değişiklikleri geri alınabilir.'],
 bt_commands:['Commands','Komutlar'],bt_commands_d:['Run PowerShell commands in the folder (build, test, install). Their effects cannot be undone.','Klasörde PowerShell komutları çalıştırır (derleme, test, kurulum). Etkileri geri alınamaz.'],
 bt_background:['Background commands','Arka plan komutları'],bt_background_d:['Keep a dev server or watcher running; the agent reads its output and stops it.','Bir geliştirme sunucusunu veya izleyiciyi açık tutar; ajan çıktısını okur ve durdurur.'],
 bt_instructions:['Project instructions','Proje talimatları'],bt_instructions_d:['Reads AGENTS.md and CLAUDE.md at the folder’s root as the project’s rules.','Klasör kökündeki AGENTS.md ve CLAUDE.md dosyalarını projenin kuralları olarak okur.'],
 bt_web:['Web research','Web araştırması'],bt_web_d:['Search and read web pages. Set up in Settings → Search.','Web’de arar ve sayfa okur. Ayarlar → Arama’dan kurulur.'],
 btAlways:['Always on','Her zaman açık'],btByMode:['By mode','Moda göre'],btOn:['On','Açık'],btOff:['Off','Kapalı'],btUnavailable:['Not available in this build','Bu sürümde yok'],btOpen:['Open','Aç'],btSaved:['Built-in tools saved','Yerleşik araçlar kaydedildi'],
});
let builtinSettings=null;
async function loadBuiltin(){try{const r=await api.projects('coding',{chatId:state.chat.Id});builtinSettings=r.settings;}catch{}return builtinSettings;}
const wsPaintPlugins=paintPlugins;paintPlugins=function(){
 wsPaintPlugins();const panel=$('plugins-panel');if(panel.hidden)return;
 if(!builtinSettings||!wsState.loaded){Promise.all([loadBuiltin(),loadWorkspaces()]).then(()=>{if(builtinSettings)paintPlugins();});return;}
 const tools=builtinSettings.tools||{},box=el('section','builtin-tools');box.id='builtin-tools';
 box.append(el('span','connect-subhead plugin-subhead',t('builtinTitle')),el('p','quiet',t('builtinIntro')));
 const grid=el('div','plugin-grid builtin-grid');
 const card=(key,state0)=>{const c=el('div','connect-card plugin-card builtin-card');c.dataset.tool=key;const head=el('div','connect-card-head'),title=el('div');title.append(el('strong','',t('bt_'+key)),el('small','quiet',t('bt_'+key+'_d')));head.append(title);c.append(head);
  if(state0.badge)c.append(el('small','builtin-badge',state0.badge));
  if(state0.toggle){const label=el('label','builtin-switch'),sw=el('span','switch'),box2=el('input'),knob=el('span');box2.type='checkbox';box2.checked=tools[key]!==false;box2.id='builtin-'+key;box2.disabled=!!state0.disabled;sw.append(box2,knob);
   const text=el('span','',box2.checked?t('btOn'):t('btOff'));label.append(sw,text);
   box2.onchange=async()=>{try{const r=await api.projects('coding-settings',{chatId:state.chat.Id,patch:{tools:{[key]:box2.checked}}});builtinSettings=r;text.textContent=box2.checked?t('btOn'):t('btOff');toast(t('btSaved'));}catch(e){box2.checked=!box2.checked;toast(cleanError(e));}};c.append(label);}
  if(state0.open){const b=el('button','secondary',t('btOpen'));b.type='button';b.onclick=state0.open;c.append(b);}
  grid.append(c);};
 card('files',{badge:t('btAlways')});card('changes',{badge:t('btByMode')});
 card('commands',wsState.commands?{toggle:true}:{badge:t('btUnavailable')});card('background',wsState.commands?{toggle:true}:{badge:t('btUnavailable')});
 card('instructions',{toggle:true});card('web',{open:()=>openSettings('search')});
 box.append(grid);panel.querySelector('.settings-heading')?.after(box);
};
