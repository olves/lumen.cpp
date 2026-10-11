'use strict';
// Settings → Runtime → llama.cpp engine: the build in use, a newer official build when there is one, update with progress,
// going back to the previous engine, and the startup check switch. Main process: engine.cjs.
Object.assign(translations,{
 engineLabel:['llama.cpp engine','llama.cpp motoru'],engineVersion:['Engine version','Motor sürümü'],
 engineLine:['llama.cpp {build} · {backend} · {kind}','llama.cpp {build} · {backend} · {kind}'],engineBundled:['bundled','paketle gelen'],engineUpdated:['updated','güncellendi'],
 engineCheck:['Check for engine updates','Motor güncellemelerini denetle'],engineChecking:['Checking…','Denetleniyor…'],
 engineUpToDate:['This is the newest llama.cpp build for this engine.','Bu motor için en yeni llama.cpp derlemesi bu.'],engineNeverChecked:['Not checked yet.','Henüz denetlenmedi.'],
 engineAvailable:['llama.cpp {build} is available ({behind} builds newer) · {size}','llama.cpp {build} hazır ({behind} derleme daha yeni) · {size}'],
 engineInstall:['Update engine','Motoru güncelle'],engineRollback:['Use the previous engine','Önceki motora dön'],engineCancel:['Cancel','İptal'],
 engineDownloading:['Downloading {pct}%','İndiriliyor %{pct}'],engineVerifying:['Unpacking and checking…','Açılıyor ve doğrulanıyor…'],engineTesting:['Testing the new engine…','Yeni motor deneniyor…'],
 engineDone:['Updated to llama.cpp {build}. It is used from the next reply.','llama.cpp {build} kuruldu. Bir sonraki yanıttan itibaren kullanılır.'],
 engineFailed:['Engine update failed: {error}','Motor güncellemesi başarısız: {error}'],
 engineFailedRun:['llama.cpp {build} could not start on this computer, so Lumen went back to {current}.','llama.cpp {build} bu bilgisayarda başlatılamadı; Lumen {current} sürümüne geri döndü.'],
 engineAuto:['Check for engine updates at startup','Açılışta motor güncellemelerini denetle'],
 engineAutoHint:['Asks GitHub for the newest official llama.cpp build. Nothing is downloaded until you choose; the bundled engine stays as a fallback.','GitHub’dan en yeni resmi llama.cpp derlemesini sorar. Sen seçmeden hiçbir şey indirilmez; paketle gelen motor yedek olarak kalır.'],
 engineNote:['Newer builds support newer models and bring fixes, but Lumen has not tested them in advance. If one does not start, Lumen goes back to the previous engine by itself.','Yeni derlemeler yeni modelleri destekler ve düzeltmeler getirir, ancak Lumen bunları önceden test etmemiştir. Başlamazsa Lumen kendiliğinden önceki motora döner.']
});
const engineNames={cuda13:'CUDA 13',cuda12:'CUDA 12',vulkan:'Vulkan',cpu:'CPU'};
let engineUiState=null;
const engineFill=(key,values)=>Object.entries(values).reduce((s,[k,v])=>s.replaceAll('{'+k+'}',v),t(key));
const engineSize=bytes=>bytes>=1073741824?(bytes/1073741824).toFixed(1)+' GB':Math.round(bytes/1048576)+' MB';
const engineClean=e=>String(e?.message||e).replace(/^Error invoking remote method '[^']+': (Error: )?/,'');

function buildEngineSection(){
 const anchor=$('engine-setting-status')?.closest('.setting-row');if(!anchor||$('engine-update-section'))return;
 const section=document.createElement('div');section.id='engine-update-section';
 section.innerHTML='<div class="settings-label settings-sub" data-i18n="engineLabel"></div>'+
  '<div class="setting-row"><div><h3 data-i18n="engineVersion"></h3><p id="engine-version"></p></div><button id="engine-check" class="secondary" type="button" data-i18n="engineCheck"></button></div>'+
  '<div id="engine-box" class="update-box" aria-live="polite"><p id="engine-status"></p><div id="engine-progress" class="update-progress" hidden><span id="engine-fill"></span></div><div class="update-actions"><button id="engine-install" class="primary" type="button" data-i18n="engineInstall" hidden></button><button id="engine-cancel" class="text-button" type="button" data-i18n="engineCancel" hidden></button><button id="engine-rollback" class="text-button" type="button" data-i18n="engineRollback" hidden></button></div></div>'+
  '<div class="setting-row"><div><h3 data-i18n="engineAuto"></h3><p data-i18n="engineAutoHint"></p></div><label class="switch"><input id="engine-auto" type="checkbox"><span></span></label></div>'+
  '<p class="quiet" data-i18n="engineNote"></p>';
 anchor.after(section);
 for(const n of section.querySelectorAll('[data-i18n]'))n.textContent=t(n.dataset.i18n);
 $('engine-check').onclick=async()=>{$('engine-check').disabled=true;try{paintEngineUpdate(await api.engineUpdate('check'));}catch(e){paintEngineUpdate({...engineUiState,error:engineClean(e)});}finally{$('engine-check').disabled=false;}};
 $('engine-install').onclick=()=>api.engineUpdate('install').then(paintEngineUpdate,e=>toast(engineClean(e)));
 $('engine-cancel').onclick=()=>api.engineUpdate('cancel').catch(()=>{});
 $('engine-rollback').onclick=()=>api.engineUpdate('rollback').then(paintEngineUpdate,e=>toast(engineClean(e)));
 $('engine-auto').onchange=async()=>paintEngineUpdate(await api.engineUpdate('auto',{on:$('engine-auto').checked}));
}
function engineStatusText(s){
 const j=s.job,a=s.available;
 if(j?.phase==='downloading')return engineFill('engineDownloading',{pct:j.total?Math.floor(j.bytes/j.total*100):0});
 if(j?.phase==='verifying')return t('engineVerifying');if(j?.phase==='testing')return t('engineTesting');
 if(j?.phase==='done')return engineFill('engineDone',{build:s.current.build});
 if(j?.phase==='failed')return engineFill('engineFailed',{error:j.error||''});
 if(s.current.failed)return engineFill('engineFailedRun',{build:s.current.failed.build,current:s.current.build});
 if(s.error)return engineFill('engineFailed',{error:s.error});
 if(a)return engineFill('engineAvailable',{build:a.build,behind:a.behind,size:engineSize(a.size)});
 if(s.checking)return t('engineChecking');
 return s.lastCheck?t('engineUpToDate'):t('engineNeverChecked');
}
function paintEngineUpdate(s){
 if(!s)return;engineUiState=s;buildEngineSection();if(!$('engine-status'))return;
 const busy=['downloading','verifying','testing'].includes(s.job?.phase);
 $('engine-version').textContent=engineFill('engineLine',{build:s.current.build,backend:engineNames[s.current.backend]||s.current.backend,kind:t(s.current.updated?'engineUpdated':'engineBundled')});
 $('engine-status').textContent=engineStatusText(s);
 $('engine-check').textContent=t(s.checking?'engineChecking':'engineCheck');$('engine-check').disabled=s.checking||busy;
 $('engine-progress').hidden=s.job?.phase!=='downloading';if(s.job?.phase==='downloading')$('engine-fill').style.transform=`scaleX(${s.job.total?s.job.bytes/s.job.total:0})`;
 $('engine-install').hidden=!s.available||busy;$('engine-cancel').hidden=s.job?.phase!=='downloading';$('engine-rollback').hidden=!s.current.updated||busy;
 $('engine-auto').checked=s.auto;$('engine-box').dataset.state=s.available?'available':'idle';
}
const localizeBeforeEngine=localize;
localize=function(...args){const result=localizeBeforeEngine.apply(this,args);const section=$('engine-update-section');if(section)for(const n of section.querySelectorAll('[data-i18n]'))n.textContent=t(n.dataset.i18n);if(engineUiState)paintEngineUpdate(engineUiState);return result;};
api.onChannel('engine-update-event',paintEngineUpdate);
api.engineUpdate('status').then(paintEngineUpdate).catch(()=>{});
