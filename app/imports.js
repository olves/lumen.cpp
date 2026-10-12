'use strict';
// Library → "Models on this computer": finds GGUF files other apps already downloaded and adds the chosen ones without
// downloading again (imports.cjs). Same drive: a hard link, no extra space. Another drive: a copy, only after the user agrees.
Object.assign(translations,{
 importOpen:['Models on this computer','Bu bilgisayardaki modeller'],importOpenHint:['Use GGUF files from LM Studio, Ollama, the Hugging Face cache and other apps without downloading them again.','LM Studio, Ollama, Hugging Face önbelleği ve diğer uygulamalardaki GGUF dosyalarını yeniden indirmeden kullan.'],
 importTitle:['Models on this computer','Bu bilgisayardaki modeller'],importScanning:['Looking in LM Studio, Ollama, the Hugging Face cache, GPT4All, Jan and llama.cpp…','LM Studio, Ollama, Hugging Face önbelleği, GPT4All, Jan ve llama.cpp’ye bakılıyor…'],
 importNone:['No GGUF models were found in the usual places. Choose a folder to look in.','Bilinen yerlerde GGUF modeli bulunamadı. Bakılacak bir klasör seç.'],
 importFound:['{n} found','{n} bulundu'],importAlready:['Already in Lumen','Zaten Lumen’de'],importNoSpace:['Same drive · no extra disk space','Aynı sürücü · ek disk alanı yok'],
 importOtherDrive:['Another drive · needs a copy ({size})','Başka sürücü · kopya gerekir ({size})'],importChooseFolder:['Choose a folder…','Klasör seç…'],
 importAdd:['Add {n}','{n} model ekle'],importAddNone:['Add','Ekle'],importCancel:['Stop','Durdur'],
 importChecking:['Checking {name} · {p}%','{name} kontrol ediliyor · %{p}'],importCopying:['Copying {name} · {p}%','{name} kopyalanıyor · %{p}'],
 importDone:['{n} added. They are in your model list.','{n} model eklendi. Model listende hazır.'],importFailed:['Not added: {name} ({error})','Eklenemedi: {name} ({error})'],
 importNote:['Lumen only reads these folders. A model added from the same drive shares the file with the other app; deleting it in one app keeps it in the other.','Lumen bu klasörleri yalnızca okur. Aynı sürücüden eklenen model dosyayı diğer uygulamayla paylaşır; bir uygulamada silmek diğerinde tutar.'],
 importSkipped:['Skipped {n}: vision files and split models are added with their main model or not supported yet.','{n} dosya atlandı: görme dosyaları ve parçalı modeller ana modelle eklenir ya da henüz desteklenmiyor.'],
});
let importState={scan:null,selected:new Set(),running:false,progress:null};
const importDialog=el('dialog','project-dialog import-dialog');importDialog.id='import-dialog';document.body.append(importDialog);

(function addImportButton(){
 const list=$('catalog-content');if(!list||$('import-open'))return;
 const box=el('div','import-entry');const button=el('button','secondary',t('importOpen'));button.id='import-open';button.type='button';button.onclick=openImports;
 box.append(button,el('p','quiet',t('importOpenHint')));list.prepend(box);
})();

function importName(m){return m.name||m.file.replace(/\.gguf$/i,'');}
function paintImports(){
 const s=importState,d=importDialog;d.replaceChildren();
 const head=el('div','project-dialog-head'),close=el('button','icon-button','×');close.type='button';close.setAttribute('aria-label',t('close'));close.onclick=()=>{if(!s.running)d.close();};
 head.append(el('h2','',t('importTitle')),close);d.append(head);
 if(!s.scan){d.append(el('p','quiet import-status',t('importScanning')));return;}
 const models=s.scan.models;
 if(!models.length)d.append(el('p','quiet import-status',t('importNone')));
 else d.append(el('p','quiet import-status',tf('importFound',{n:fmt(models.length)})));
 const list=el('div','import-list');
 for(const m of models){
  const row=el('label','import-row'+(m.status==='installed'?' installed':''));const box=el('input');box.type='checkbox';box.disabled=m.status==='installed'||s.running;box.checked=s.selected.has(m.id);
  box.onchange=()=>{box.checked?s.selected.add(m.id):s.selected.delete(m.id);paintImportFoot();};
  const info=el('div','import-info');info.append(el('strong','',importName(m)),el('small','',[m.source,modelSize(m.size),m.repo.startsWith('local/')||m.repo.startsWith('ollama/')?'':m.repo].filter(Boolean).join(' · ')));
  const where=el('small','import-where',m.status==='installed'?t('importAlready'):m.sameDrive?t('importNoSpace'):tf('importOtherDrive',{size:modelSize(m.size)}));
  info.append(where);const pathLine=el('small','import-path',m.path);pathLine.title=m.path;info.append(pathLine);
  row.append(box,modelLogo(m.repo,importName(m)),info);list.append(row);
 }
 d.append(list);
 if(s.scan.skipped?.length)d.append(el('p','quiet import-note',tf('importSkipped',{n:fmt(s.scan.skipped.length)})));
 d.append(el('p','quiet import-note',t('importNote')));
 const status=el('p','import-progress');status.id='import-progress';status.setAttribute('role','status');d.append(status);
 const foot=el('div','dialog-actions import-foot');const folder=el('button','text-button',t('importChooseFolder'));folder.type='button';folder.disabled=s.running;folder.onclick=chooseImportFolder;
 const add=el('button','primary');add.id='import-add';add.type='button';add.onclick=()=>s.running?api.imports('cancel'):runImport();
 foot.append(folder,add);d.append(foot);paintImportFoot();paintImportProgress();
}
function paintImportFoot(){
 const add=$('import-add');if(!add)return;const n=importState.selected.size;
 add.textContent=importState.running?t('importCancel'):n?tf('importAdd',{n:fmt(n)}):t('importAddNone');add.disabled=!importState.running&&!n;
}
function paintImportProgress(){
 const line=$('import-progress');if(!line)return;const p=importState.progress;if(!p){line.textContent=importState.message||'';return;}
 const m=importState.scan?.models.find(x=>x.id===p.id),name=m?importName(m):'';line.textContent=tf(p.phase==='copying'?'importCopying':'importChecking',{name,p:Math.round((p.value||0)*100)});
}
async function openImports(){
 importState={scan:null,selected:new Set(),running:false,progress:null,message:''};paintImports();if(!importDialog.open)importDialog.showModal();
 try{importState.scan=await api.imports('scan');}catch(e){importState.scan={models:[],skipped:[]};importState.message=cleanError(e);}
 for(const m of importState.scan.models)if(m.status!=='installed'&&m.sameDrive)importState.selected.add(m.id);
 paintImports();
}
async function chooseImportFolder(){
 try{const scan=await api.imports('folder');if(scan){importState.scan=scan;for(const m of scan.models)if(m.status!=='installed'&&m.sameDrive&&!importState.selected.has(m.id))importState.selected.add(m.id);paintImports();}}catch(e){toast(cleanError(e));}
}
// A model on another drive is only selected by the user, next to the size of the copy it needs: that choice allows the copy.
async function runImport(){
 const s=importState,ids=[...s.selected];if(!ids.length)return;
 const allowCopy=s.scan.models.some(m=>ids.includes(m.id)&&!m.sameDrive);
 s.running=true;s.progress=null;s.message='';paintImports();
 try{
  const r=await api.imports('import',{ids:[...s.selected],allowCopy});state.models=r.models;renderModels();renderPickers();
  const ok=r.results.filter(x=>['linked','copied','existing'].includes(x.status)),failed=r.results.filter(x=>x.status==='failed');
  s.message=[ok.length?tf('importDone',{n:fmt(ok.length)}):'',...failed.map(x=>tf('importFailed',{name:importName(s.scan.models.find(m=>m.id===x.id)||{file:'?'}),error:x.error}))].filter(Boolean).join(' ');
  s.scan=await api.imports('scan');s.selected=new Set();
 }catch(e){s.message=cleanError(e);}
 finally{s.running=false;s.progress=null;paintImports();}
}
api.onChannel('import-event',e=>{if(!importState.running)return;importState.progress=e;paintImportProgress();});
const importsLocalize=localize;localize=function(){importsLocalize();const b=$('import-open');if(b){b.textContent=t('importOpen');b.nextElementSibling.textContent=t('importOpenHint');}if(importDialog.open)paintImports();};
