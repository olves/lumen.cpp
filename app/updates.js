'use strict';
// Version and updates: Settings â†’ General shows the running Beta build, checks GitHub (at most once a day when automatic
// checks are on), downloads a newer build on request and installs it on restart. A small header button appears only while
// an update is available or ready. Main process: updates.cjs (signed manifest, SHA-256, lumen-updater.exe).
Object.assign(translations,{
 updatesLabel:['Updates','GÃ¼ncellemeler'],
 versionTitle:['Version','SÃ¼rÃ¼m'],
 versionLine:['Beta build {build} Â· {version} Â· {mode}','Beta derleme {build} Â· {version} Â· {mode}'],
 modeInstalled:['installed','kurulu'],modePortable:['portable folder','taÅŸÄ±nabilir klasÃ¶r'],
 checkUpdates:['Check for updates','GÃ¼ncellemeleri denetle'],checkingUpdates:['Checkingâ€¦','Denetleniyorâ€¦'],
 upToDate:['You have the latest Beta build.','En son Beta derlemesini kullanÄ±yorsun.'],
 checkedAgo:['Last checked {when}.','Son denetim: {when}.'],neverChecked:['Not checked yet.','HenÃ¼z denetlenmedi.'],
 updateAvailable:['Beta build {build} is available Â· {size}','Beta derleme {build} hazÄ±r Â· {size}'],
 downloadUpdate:['Download update','GÃ¼ncellemeyi indir'],cancelUpdate:['Cancel','Ä°ptal'],
 updateDownloading:['Downloading {pct}% Â· {speed}/s','Ä°ndiriliyor %{pct} Â· {speed}/sn'],updateVerifying:['Verifyingâ€¦','DoÄŸrulanÄ±yorâ€¦'],
 updateReady:['Beta build {build} is downloaded and verified.','Beta derleme {build} indirildi ve doÄŸrulandÄ±.'],
 restartUpdate:['Restart and update','Yeniden baÅŸlat ve gÃ¼ncelle'],
 updateInstalling:['Closing Lumen to install the updateâ€¦','GÃ¼ncelleme iÃ§in Lumen kapatÄ±lÄ±yorâ€¦'],
 updateFailed:['Update failed: {error}','GÃ¼ncelleme baÅŸarÄ±sÄ±z: {error}'],
 updateNotWritable:['Lumen cannot write to its own folder, so it cannot update itself here. Download the new version from GitHub.','Lumen kendi klasÃ¶rÃ¼ne yazamÄ±yor, bu yÃ¼zden burada kendini gÃ¼ncelleyemez. Yeni sÃ¼rÃ¼mÃ¼ GitHubâ€™dan indir.'],
 autoUpdates:['Check automatically','Otomatik denetle'],
 autoUpdatesHint:['Once a day Lumen asks GitHub whether a newer Beta build exists. Nothing about you or your chats is sent. Updates are only downloaded when you choose.','Lumen gÃ¼nde bir kez GitHubâ€™a daha yeni bir Beta derlemesi olup olmadÄ±ÄŸÄ±nÄ± sorar. Sen veya sohbetlerin hakkÄ±nda hiÃ§bir ÅŸey gÃ¶nderilmez. GÃ¼ncellemeler yalnÄ±zca sen seÃ§ince indirilir.'],
 updateSafety:['Updates are signed with the Lumen release key and checked before installing. Your chats, models and settings stay where they are.','GÃ¼ncellemeler Lumen yayÄ±n anahtarÄ±yla imzalÄ±dÄ±r ve kurulmadan Ã¶nce doÄŸrulanÄ±r. Sohbetlerin, modellerin ve ayarlarÄ±n yerinde kalÄ±r.'],
 updatePill:['Update','GÃ¼ncelleme'],updatePillReady:['Restart to update','GÃ¼ncellemek iÃ§in yeniden baÅŸlat'],
 updateToast:['Beta build {build} is available. Open Settings â†’ General to update.','Beta derleme {build} hazÄ±r. GÃ¼ncellemek iÃ§in Ayarlar â†’ Genelâ€™i aÃ§.'],
 justNow:['just now','az Ã¶nce'],minutesAgo:['{n} min ago','{n} dk Ã¶nce'],hoursAgo:['{n} h ago','{n} sa Ã¶nce'],daysAgo:['{n} days ago','{n} gÃ¼n Ã¶nce']
});

let updateState=null,updateToastShown=0;
const updateFill=(key,values)=>Object.entries(values).reduce((s,[k,v])=>s.replaceAll('{'+k+'}',v),t(key));
function updateSize(bytes){return bytes>=1073741824?(bytes/1073741824).toFixed(1)+' GB':Math.round(bytes/1048576)+' MB';}
function updateAgo(time){const m=Math.round((Date.now()-time)/60000);if(m<1)return t('justNow');if(m<60)return updateFill('minutesAgo',{n:m});const h=Math.round(m/60);return h<48?updateFill('hoursAgo',{n:h}):updateFill('daysAgo',{n:Math.round(h/24)});}

function buildUpdateSection(){
 const panel=$('general-panel');if(!panel||$('update-section'))return;
 const section=document.createElement('div');section.id='update-section';
 section.innerHTML='<div class="settings-label settings-sub" data-i18n="updatesLabel"></div>'+
  '<div class="setting-row"><div><h3 data-i18n="versionTitle"></h3><p id="update-version"></p></div><button id="update-check" class="secondary" type="button" data-i18n="checkUpdates"></button></div>'+
  '<div id="update-box" class="update-box" aria-live="polite"><p id="update-status"></p><p id="update-notes" class="update-notes" hidden></p><div id="update-progress" class="update-progress" hidden><span id="update-fill"></span></div><div class="update-actions"><button id="update-download" class="primary" type="button" data-i18n="downloadUpdate" hidden></button><button id="update-install" class="primary" type="button" data-i18n="restartUpdate" hidden></button><button id="update-cancel" class="text-button" type="button" data-i18n="cancelUpdate" hidden></button></div></div>'+
  '<div class="setting-row"><div><h3 data-i18n="autoUpdates"></h3><p data-i18n="autoUpdatesHint"></p></div><label class="switch"><input id="update-auto" type="checkbox"><span></span></label></div>'+
  '<p class="quiet" data-i18n="updateSafety"></p>';
 panel.append(section);
 for(const n of section.querySelectorAll('[data-i18n]'))n.textContent=t(n.dataset.i18n);
 $('update-check').onclick=async()=>{$('update-check').disabled=true;try{paintUpdates(await api.updates('check'));}catch(e){paintUpdates({...updateState,error:e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,'')});}finally{$('update-check').disabled=false;}};
 $('update-download').onclick=async()=>{try{paintUpdates(await api.updates('download'));}catch(e){toast(e.message);}};
 $('update-cancel').onclick=()=>api.updates('cancel').catch(()=>{});
 $('update-install').onclick=async()=>{$('update-install').disabled=true;$('update-status').textContent=t('updateInstalling');try{await api.updates('install');}catch(e){$('update-install').disabled=false;paintUpdates({...updateState,error:e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,'')});}};
 $('update-auto').onchange=async()=>paintUpdates(await api.updates('auto',{on:$('update-auto').checked}));
}

function updatePill(){
 let pill=$('update-pill');
 if(!pill){pill=document.createElement('button');pill.id='update-pill';pill.type='button';pill.className='download-pill update-pill';pill.hidden=true;pill.onclick=()=>openSettings('general');document.querySelector('.header-actions')?.prepend(pill);}
 return pill;
}

function paintUpdates(s){
 if(!s)return;updateState=s;buildUpdateSection();
 const box=$('update-status');if(!box)return;
 const d=s.download,a=s.available;
 $('update-version').textContent=updateFill('versionLine',{build:s.build,version:s.version,mode:t(s.mode==='installed'?'modeInstalled':'modePortable')});
 $('update-auto').checked=s.auto;$('update-check').textContent=t(s.checking?'checkingUpdates':'checkUpdates');$('update-check').disabled=s.checking||['downloading','verifying'].includes(d?.phase);
 let text;
 if(s.error)text=updateFill('updateFailed',{error:s.error});
 else if(d?.phase==='ready'&&a)text=updateFill('updateReady',{build:a.build});
 else if(d?.phase==='downloading')text=updateFill('updateDownloading',{pct:d.total?Math.floor(d.bytes/d.total*100):0,speed:updateSize(d.speed||0)});
 else if(d?.phase==='verifying')text=t('updateVerifying');
 else if(d?.phase==='failed')text=updateFill('updateFailed',{error:d.error||''});
 else if(a)text=updateFill('updateAvailable',{build:a.build,size:updateSize(a.size)});
 else if(s.checking)text=t('checkingUpdates');
 else text=s.lastCheck?t('upToDate')+' '+updateFill('checkedAgo',{when:updateAgo(s.lastCheck)}):t('neverChecked');
 if(a&&!s.writable)text+=' '+t('updateNotWritable');
 box.textContent=text;
 const notes=a?(state.prefs.language==='tr'&&a.notes?.tr||a.notes?.en||''):'';$('update-notes').textContent=notes;$('update-notes').hidden=!notes;
 const busy=['downloading','verifying'].includes(d?.phase);
 $('update-progress').hidden=!busy;if(busy)$('update-fill').style.transform=`scaleX(${d.total?d.bytes/d.total:0})`;
 $('update-download').hidden=!a||!s.writable||busy||d?.phase==='ready';
 $('update-install').hidden=!(a&&d?.phase==='ready'&&s.writable);$('update-install').disabled=false;
 $('update-cancel').hidden=d?.phase!=='downloading';
 $('update-box').dataset.state=a?(d?.phase==='ready'?'ready':'available'):'idle';
 const pill=updatePill();pill.hidden=!a;pill.textContent=t(d?.phase==='ready'?'updatePillReady':'updatePill');pill.title=a?updateFill('updateAvailable',{build:a.build,size:updateSize(a.size)}):'';
 if(a&&!d&&updateToastShown!==a.build&&!(state.page==='settings'&&state.setting==='general')){updateToastShown=a.build;toast(updateFill('updateToast',{build:a.build}));}
}

const localizeBeforeUpdates=localize;
localize=function(...args){const result=localizeBeforeUpdates.apply(this,args);const section=$('update-section');if(section)for(const n of section.querySelectorAll('[data-i18n]'))n.textContent=t(n.dataset.i18n);if(updateState)paintUpdates(updateState);return result;};

api.onChannel('update-event',paintUpdates);
api.updates('status').then(paintUpdates).catch(()=>{});
