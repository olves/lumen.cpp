'use strict';
// Version and updates: Settings → General shows the running Beta build, checks GitHub (at most once a day when automatic
// checks are on), downloads a newer build on request and installs it on restart. A small header button appears only while
// an update is available or ready. Main process: updates.cjs (signed manifest, SHA-256, lumen-updater.exe).
Object.assign(translations,{
 updatesLabel:['Updates','Güncellemeler'],
 versionTitle:['Version','Sürüm'],
 versionLine:['v{version} · {mode}','v{version} · {mode}'],
 modeInstalled:['installed','kurulu'],modePortable:['portable folder','taşınabilir klasör'],
 checkUpdates:['Check for updates','Güncellemeleri denetle'],checkingUpdates:['Checking…','Denetleniyor…'],
 upToDate:['You have the latest version.','En son sürümü kullanıyorsun.'],
 checkedAgo:['Last checked {when}.','Son denetim: {when}.'],neverChecked:['Not checked yet.','Henüz denetlenmedi.'],
 updateAvailable:['v{version} is available · {size}','v{version} hazır · {size}'],
 downloadUpdate:['Download update','Güncellemeyi indir'],cancelUpdate:['Cancel','İptal'],
 updateDownloading:['Downloading {pct}% · {speed}/s','İndiriliyor %{pct} · {speed}/sn'],updateVerifying:['Verifying…','Doğrulanıyor…'],
 updateReady:['v{version} is downloaded and verified.','v{version} indirildi ve doğrulandı.'],
 restartUpdate:['Restart and update','Yeniden başlat ve güncelle'],
 updateInstalling:['Closing Lumen to install the update…','Güncelleme için Lumen kapatılıyor…'],
 updateFailed:['Update failed: {error}','Güncelleme başarısız: {error}'],
 updateNotWritable:['Lumen cannot write to its own folder, so it cannot update itself here. Download the new version from GitHub.','Lumen kendi klasörüne yazamıyor, bu yüzden burada kendini güncelleyemez. Yeni sürümü GitHub’dan indir.'],
 autoUpdates:['Check automatically','Otomatik denetle'],
 autoUpdatesHint:['Once a day Lumen asks GitHub whether a newer version exists. Nothing about you or your chats is sent. Updates are only downloaded when you choose.','Lumen günde bir kez GitHub’a daha yeni bir sürüm olup olmadığını sorar. Sen veya sohbetlerin hakkında hiçbir şey gönderilmez. Güncellemeler yalnızca sen seçince indirilir.'],
 updateSafety:['Updates are signed with the Lumen release key and checked before installing. Your chats, models and settings stay where they are.','Güncellemeler Lumen yayın anahtarıyla imzalıdır ve kurulmadan önce doğrulanır. Sohbetlerin, modellerin ve ayarların yerinde kalır.'],
 updatePill:['Update','Güncelleme'],updatePillReady:['Restart to update','Güncellemek için yeniden başlat'],
 updateToast:['v{version} is available. Open Settings → General to update.','v{version} hazır. Güncellemek için Ayarlar → Genel’i aç.'],
 justNow:['just now','az önce'],minutesAgo:['{n} min ago','{n} dk önce'],hoursAgo:['{n} h ago','{n} sa önce'],daysAgo:['{n} days ago','{n} gün önce']
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
 $('update-version').textContent=updateFill('versionLine',{version:s.version,mode:t(s.mode==='installed'?'modeInstalled':'modePortable')});
 $('update-auto').checked=s.auto;$('update-check').textContent=t(s.checking?'checkingUpdates':'checkUpdates');$('update-check').disabled=s.checking||['downloading','verifying'].includes(d?.phase);
 let text;
 if(s.error)text=updateFill('updateFailed',{error:s.error});
 else if(d?.phase==='ready'&&a)text=updateFill('updateReady',{version:a.version});
 else if(d?.phase==='downloading')text=updateFill('updateDownloading',{pct:d.total?Math.floor(d.bytes/d.total*100):0,speed:updateSize(d.speed||0)});
 else if(d?.phase==='verifying')text=t('updateVerifying');
 else if(d?.phase==='failed')text=updateFill('updateFailed',{error:d.error||''});
 else if(a)text=updateFill('updateAvailable',{version:a.version,size:updateSize(a.size)});
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
 const pill=updatePill();pill.hidden=!a;pill.textContent=t(d?.phase==='ready'?'updatePillReady':'updatePill');pill.title=a?updateFill('updateAvailable',{version:a.version,size:updateSize(a.size)}):'';
 if(a&&!d&&updateToastShown!==a.build&&!(state.page==='settings'&&state.setting==='general')){updateToastShown=a.build;toast(updateFill('updateToast',{version:a.version}));}
}

const localizeBeforeUpdates=localize;
localize=function(...args){const result=localizeBeforeUpdates.apply(this,args);const section=$('update-section');if(section)for(const n of section.querySelectorAll('[data-i18n]'))n.textContent=t(n.dataset.i18n);if(updateState)paintUpdates(updateState);return result;};

api.onChannel('update-event',paintUpdates);
api.updates('status').then(paintUpdates).catch(()=>{});
