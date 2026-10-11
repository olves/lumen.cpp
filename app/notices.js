'use strict';
// Startup notices: renderer.js starts the update checks (Lumen and the llama.cpp engine) with the window and holds the splash for
// them. Each result gets its own notice in the top-right corner once the workspace is shown.
Object.assign(translations,{
 noticeAppTitle:['Lumen v{version} is available','Lumen v{version} hazır'],noticeUpdate:['Update','Güncelle'],noticeLater:['Later','Daha sonra'],
 noticeEngineTitle:['New llama.cpp engine: {build}','Yeni llama.cpp motoru: {build}'],
 noticeEngineText:['You are on {current} · {behind} builds newer · {size} to download.','Şu an {current} kullanılıyor · {behind} derleme daha yeni · {size} indirilecek.'],
 noticeEngineLater:['Remind me in 7 days','7 gün sonra hatırlat'],noticeEngineFailedTitle:['Engine update rolled back','Motor güncellemesi geri alındı'],
 noticeOk:['OK','Tamam'],noticeClose:['Close','Kapat']
});
// Each kind of notice appears at most once per start; a check that finishes after the opening still adds its own notice.
const startupShown=new Set();let startupNoticesShown=false;const startupStarted=Date.now();

function noticeHost(){let host=$('notices');if(!host){host=document.createElement('div');host.id='notices';host.className='notices';host.setAttribute('aria-live','polite');document.body.append(host);}return host;}
function showNotice(id,{title,text,actions}){
 closeNotice(id,true);const card=document.createElement('section');card.className='notice';card.id='notice-'+id;card.setAttribute('role','status');
 const head=document.createElement('div');head.className='notice-head';const h=document.createElement('strong');h.textContent=title;const x=document.createElement('button');x.type='button';x.className='notice-close';x.textContent='×';x.setAttribute('aria-label',t('noticeClose'));x.onclick=()=>closeNotice(id);head.append(h,x);
 const p=document.createElement('p');p.className='notice-text';p.textContent=text||'';p.hidden=!text;
 const row=document.createElement('div');row.className='notice-actions';
 for(const a of actions||[]){const b=document.createElement('button');b.type='button';b.className=a.primary?'primary':'text-button';b.textContent=a.label;b.onclick=()=>a.run(card);row.append(b);}
 card.append(head,p,row);noticeHost().append(card);
 if(motionAllowed())card.animate([{opacity:0,transform:'translateY(-6px)'},{opacity:1,transform:'none'}],{duration:180,easing:'cubic-bezier(.22,1,.36,1)'});
 return card;
}
function closeNotice(id,instant=false){const card=$('notice-'+id);if(!card)return;if(instant||!motionAllowed()){card.remove();return;}card.animate([{opacity:1},{opacity:0}],{duration:140}).finished.then(()=>card.remove(),()=>card.remove());}
function noticeText(card,text){const p=card.querySelector('.notice-text');p.textContent=text;p.hidden=!text;}

function showStartupNotices(r){
 if(!r)return;startupNoticesShown=true;
 const app=r.app,engine=r.engine;
 if(app?.auto&&app.available&&app.download?.phase!=='ready'&&!startupShown.has('app')){startupShown.add('app');
  const notes=(state.prefs.language==='tr'&&app.available.notes?.tr||app.available.notes?.en||'').split(/(?<=\.)\s/)[0];
  showNotice('app',{title:updateFill('noticeAppTitle',{version:app.available.version}),text:notes,actions:[
   {label:t('noticeUpdate'),primary:true,run:()=>{closeNotice('app');api.updates('download').catch(e=>toast(engineClean(e)));openSettings('general');}},
   {label:t('noticeLater'),run:()=>closeNotice('app')}]});
 }
 if(engine?.current?.failed&&!startupShown.has('engine-failed')){startupShown.add('engine-failed');
  showNotice('engine-failed',{title:t('noticeEngineFailedTitle'),text:engineFill('engineFailedRun',{build:engine.current.failed.build,current:engine.current.build}),actions:[{label:t('noticeOk'),primary:true,run:()=>{closeNotice('engine-failed');api.engineUpdate('ack').catch(()=>{});}}]});
 }
 if(engine?.auto&&engine.available&&!engine.snoozed&&!startupShown.has('engine')){startupShown.add('engine');
  showNotice('engine',{title:engineFill('noticeEngineTitle',{build:engine.available.build}),text:engineFill('noticeEngineText',{current:engine.current.build,behind:engine.available.behind,size:engineSize(engine.available.size)}),actions:[
   {label:t('noticeUpdate'),primary:true,run:card=>{card.querySelectorAll('.notice-actions button').forEach(b=>b.hidden=true);api.engineUpdate('install').then(s=>noticeText(card,engineStatusText(s)),e=>noticeText(card,engineFill('engineFailed',{error:engineClean(e)})));}},
   {label:t('noticeEngineLater'),run:()=>{closeNotice('engine');api.engineUpdate('snooze').catch(()=>{});}}]});
 }
}
// The engine notice follows the install: progress, then the result (it closes itself a few seconds after success).
api.onChannel('engine-update-event',s=>{
 // A check that was still running when the workspace opened: show its notice when it finishes (within the first minute).
 if(!s.checking&&!s.job&&state.ready&&Date.now()-startupStarted<60000)showStartupNotices({engine:s},false);
 const card=$('notice-engine');if(!card||!s.job)return;noticeText(card,engineStatusText(s));if(s.job.phase==='done')setTimeout(()=>closeNotice('engine'),6000);if(s.job.phase==='failed')card.querySelectorAll('.notice-actions button').forEach(b=>b.hidden=false);});

// renderer.js starts the checks with the window and holds the splash for them; the notices follow the opening animation, or
// appear as soon as late results arrive.
startupChecks.then(r=>{if(!r)return;const show=()=>setTimeout(()=>showStartupNotices(r),motionAllowed()?750:0);if(state.ready)show();else window.addEventListener('lumen-ready',show,{once:true});});

const showStartupNoticesWith=showStartupNotices;
showStartupNotices=async function(r,fresh=true){
 if(!fresh)return showStartupNoticesWith(r);
 try{const [app,engine]=await Promise.all([api.updates('status'),api.engineUpdate('status')]);return showStartupNoticesWith({app,engine});}
 catch{return showStartupNoticesWith(r);}
};
