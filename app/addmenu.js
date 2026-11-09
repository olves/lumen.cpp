// + menu layout (v1.0.9). Earlier scripts each add their own row; this one, loaded last, arranges them:
//   Add: "Add files" (photos, text/code, PDF/Word through one picker, the same path as a drop) and Project folder
//   Modes: web research, connected tools, create image (shown as on/off)
//   Conversation: skills and system instructions
// Rows are one line; the hint becomes the tooltip. The old photo/text/document rows stay in the DOM, hidden, because
// other scripts and tests call them.
Object.assign(translations,{
 addGroupAdd:['Add','Ekle'],addGroupModes:['Modes','Modlar'],addGroupChat:['Conversation','Sohbet'],
 attachAny:['Add files','Dosya ekle'],
 attachAnyHint:['Photos, text and code files, PDF and Word documents. You can also drop them on the message box.','Fotoğraf, metin ve kod dosyası, PDF ve Word belgesi. Mesaj kutusuna sürükleyip de bırakabilirsin.'],
});
Object.assign(paths,{folder:'M2.5 5V14h13V6.5H9L7.5 4.5h-5z'});
const addMenuModes={'use-research':()=>!!researchMode,'use-tools':()=>!!toolsMode,'create-image':()=>!!imageMode};
(function arrangeAddMenu(){
 const menu=$('add-menu');if(!menu||$('attach-any'))return;
 const input=document.createElement('input');input.type='file';input.id='attach-any-input';input.multiple=true;input.hidden=true;input.tabIndex=-1;
 input.accept=[...dropPhotoExtensions,...dropExtensions,...dropDocExtensions].map(x=>'.'+x).join(',');
 input.onchange=async()=>{const files=[...input.files];input.value='';if(files.length)await addDroppedFiles(files);};
 const any=el('button');any.id='attach-any';any.type='button';any.setAttribute('role','menuitem');
 const text=el('span');text.append(el('strong','',t('attachAny')),el('small','',t('attachAnyHint')));any.append(icon('paperclip'),text);
 any.onclick=()=>{closeComposerMenus();if(state.busy)return;input.click();};
 const caption=key=>{const c=el('div','menu-caption',t(key));c.dataset.addCaption=key;return c;};
 for(const id of ['attach-photos','attach-files','attach-docs'])$(id)?.classList.add('menu-hidden');
 menu.querySelector('.menu-caption[data-i18n="addToChat"]')?.remove();
 const order=[caption('addGroupAdd'),any,$('attach-project'),caption('addGroupModes'),$('use-research'),$('use-tools'),$('create-image'),
  caption('addGroupChat'),$('use-skill'),$('composer-instructions')].filter(Boolean);
 const rest=[...menu.children].filter(n=>!order.includes(n));
 menu.replaceChildren(...order,...rest,input);
 for(const id of Object.keys(addMenuModes))$(id)?.setAttribute('role','menuitemcheckbox');
 $('attach-project')?.querySelector('svg')?.replaceWith(icon('folder'));
})();
// Tooltips and on/off state are read when the menu opens (renderer's + button closes the menus first, then shows it).
function syncAddMenu(){
 for(const b of $('add-menu').querySelectorAll(':scope>button')){const s=b.querySelector('small');if(s)b.title=s.textContent;}
 for(const [id,on] of Object.entries(addMenuModes)){const b=$(id);if(b)b.setAttribute('aria-checked',String(on()));}
}
const addMenuClose=closeComposerMenus;closeComposerMenus=function(...args){const r=addMenuClose(...args);syncAddMenu();return r;};
const addMenuLocalize=localize;localize=function(...args){const r=addMenuLocalize(...args);
 document.querySelectorAll('#add-menu [data-add-caption]').forEach(c=>c.textContent=t(c.dataset.addCaption));
 const b=$('attach-any');if(b){b.querySelector('strong').textContent=t('attachAny');b.querySelector('small').textContent=t('attachAnyHint');}
 syncAddMenu();return r;};
const addMenuBusy=setBusy;setBusy=function(busy,...args){const r=addMenuBusy(busy,...args);const b=$('attach-any');if(b)b.disabled=busy;return r;};
syncAddMenu();
