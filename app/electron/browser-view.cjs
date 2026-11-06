'use strict';
// Electron side of platform.browser (see platform.cjs and browser.cjs). Moved from browser.cjs; the security rules are
// unchanged. Remote pages never run in Lumen's privileged UI. Both surfaces below use the separate "persist:lumen-web"
// session, no preload, no Node, sandboxed renderers, and no access to Lumen IPC:
//  - render(url): one reusable hidden window, only used when the lightweight reader finds almost no text;
//    it is destroyed after a minute of inactivity;
//  - the panel: one WebContentsView placed over the browser panel area of the main window.
// Permissions, downloads, dialogs and popups are refused; requests to local/private addresses are cancelled.
// What the panel shows (state, errors, find results, zoom rules, clicking) is decided by the core in browser.cjs.
const {BrowserWindow,WebContentsView,session}=require('electron');
const dns=require('node:dns').promises,net=require('node:net');
const {checkUrl,privateAddress,blockedHostname}=require('../web.cjs');
const {PARTITION}=require('../browser.cjs');

const webPreferences={partition:PARTITION,sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:false,webSecurity:true,allowRunningInsecureContent:false,spellcheck:false,disableDialogs:true,safeDialogs:true,autoplayPolicy:'document-user-activation-required',enableWebSQL:false,navigateOnDragDrop:false};
// Isolated world of the panel page for evalIsolated (page scripts cannot see or change what runs there).
const PAGE_WORLD=1101;

function createBrowserView({getWindow}){
 let web=null,settings={};
 const hostChecks=new Map();
 const listeners={navigate:()=>{},popup:()=>{},state:()=>{}};
 async function hostAllowed(hostname){
  const host=hostname.replace(/^\[|\]$/g,'');
  if(blockedHostname(host))return false;
  if(net.isIP(host))return !privateAddress(host);
  const hit=hostChecks.get(host);if(hit&&hit.expires>Date.now())return hit.ok;
  let ok=false;try{const answers=await dns.lookup(host,{all:true});ok=answers.length>0&&answers.every(a=>!privateAddress(a.address));}catch{ok=false;}
  if(hostChecks.size>500)hostChecks.delete(hostChecks.keys().next().value);hostChecks.set(host,{ok,expires:Date.now()+60000});return ok;
 }
 // The web session is set up on first use (configure, render or clearData), not at startup.
 function setup(){
  if(web)return web;
  web=session.fromPartition(PARTITION);
  web.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  web.setPermissionCheckHandler(()=>false);
  web.setDevicePermissionHandler?.(()=>false);
  web.setDisplayMediaRequestHandler?.((_request,callback)=>callback({}));
  web.on('will-download',event=>event.preventDefault());
  web.setSpellCheckerEnabled?.(false);
  web.webRequest.onBeforeSendHeaders({urls:['<all_urls>']},(details,callback)=>{if(settings.privacySignals===false)return callback({requestHeaders:details.requestHeaders});callback({requestHeaders:{...details.requestHeaders,'Sec-GPC':'1',DNT:'1'}});});
  web.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>{
   let url;try{url=new URL(details.url);}catch{return callback({cancel:true});}
   if(['data:','blob:','about:'].includes(url.protocol))return callback({});
   if(!['http:','https:','ws:','wss:'].includes(url.protocol)||url.username||url.password)return callback({cancel:true});
   hostAllowed(url.hostname).then(ok=>callback({cancel:!ok}),()=>callback({cancel:true}));
  });
  return web;
 }

 function guard(wc,onPopup){
  wc.setWindowOpenHandler(({url})=>{try{onPopup?.(checkUrl(url).href);}catch{}return {action:'deny'};});
  const navigation=(event,url)=>{try{checkUrl(url);}catch{event.preventDefault();}};
  wc.on('will-navigate',navigation);wc.on('will-redirect',navigation);wc.on('will-frame-navigate',e=>{if(!/^(https?|about|data|blob):/.test(e.url))e.preventDefault();});
  wc.on('will-attach-webview',event=>event.preventDefault());
  wc.on('login',event=>event.preventDefault());
  wc.on('select-client-certificate',event=>event.preventDefault());
  wc.setAudioMuted(true);
 }

 // ---------- Hidden renderer for JavaScript pages ----------
 let renderWin=null,renderIdle=null,renderChain=Promise.resolve();
 function renderWindow(){if(renderWin&&!renderWin.isDestroyed())return renderWin;renderWin=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{...webPreferences,backgroundThrottling:false}});guard(renderWin.webContents);return renderWin;}
 function render(url,{signal}={}){setup();const task=renderChain.then(()=>renderNow(url,signal));renderChain=task.catch(()=>{});return task;}
 async function renderNow(raw,signal){
  const url=checkUrl(raw).href;if(signal?.aborted)throw Object.assign(Error('Cancelled'),{code:'aborted'});
  clearTimeout(renderIdle);const win=renderWindow(),wc=win.webContents;
  try{
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{wc.stop();reject(Object.assign(Error('The page took too long to load.'),{code:'timeout'}));},20000);
    const cleanup=()=>{clearTimeout(timer);wc.off('did-finish-load',finished);wc.off('did-fail-load',failed);signal?.removeEventListener('abort',aborted);};
    const finished=()=>{cleanup();resolve();};
    const failed=(_e,code,description,_url,isMainFrame)=>{if(!isMainFrame||code===-3)return;cleanup();reject(Object.assign(Error(code===-20?'This address is blocked.':'The page could not be loaded ('+description+').'),{code:'load'}));};
    const aborted=()=>{cleanup();wc.stop();reject(Object.assign(Error('Cancelled'),{code:'aborted'}));};
    wc.on('did-finish-load',finished);wc.on('did-fail-load',failed);signal?.addEventListener('abort',aborted,{once:true});
    wc.loadURL(url).catch(()=>{});
   });
   // Give client-side rendering a moment, still cancellable.
   await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,1200);signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(Object.assign(Error('Cancelled'),{code:'aborted'}));},{once:true});});
   const page=await wc.executeJavaScriptInIsolatedWorld(1009,[{code:'({title:document.title,url:location.href,text:(document.body?document.body.innerText:"").slice(0,200000)})'}]);
   checkUrl(page.url);
   return {title:String(page.title||'').slice(0,300),url:page.url,text:String(page.text||'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim()};
  }finally{
   renderIdle=setTimeout(()=>{if(renderWin&&!renderWin.isDestroyed())renderWin.destroy();renderWin=null;},60000);
  }
 }

 // ---------- User-visible panel ----------
 let view=null,attached=false,findActive=false;
 const live=()=>{const wc=view?.webContents;return wc&&!wc.isDestroyed()?wc:null;};
 function create({javascript}={}){
  setup();if(view)return;
  view=new WebContentsView({webPreferences:{...webPreferences,javascript:javascript!==false}});const wc=view.webContents;
  // Pop-ups never open new windows: the core either loads them in the panel or blocks them, as chosen in Settings.
  guard(wc,url=>listeners.popup(url));
  wc.on('did-finish-load',()=>listeners.navigate({type:'finish'}));
  wc.on('found-in-page',(_e,result)=>{findActive=true;listeners.state({type:'found',matches:result.matches,active:result.activeMatchOrdinal});});
  // Keyboard shortcuts typed while the page has focus are handled by Lumen's panel, not by the page.
  wc.on('before-input-event',(event,input)=>{if(input.type!=='keyDown')return;const mod=input.control||input.meta,key=String(input.key||'').toLowerCase();let shortcut=null;
   if(mod&&key==='f')shortcut='find';else if(mod&&key==='l')shortcut='address';else if(mod&&(key==='='||key==='+'))shortcut='zoom-in';else if(mod&&key==='-')shortcut='zoom-out';else if(mod&&key==='0')shortcut='zoom-reset';else if(key==='escape'&&findActive)shortcut='find-close';else if(input.alt&&key==='arrowleft')shortcut='back';else if(input.alt&&key==='arrowright')shortcut='forward';else if(key==='f5'||(mod&&key==='r'))shortcut='reload';
   if(!shortcut)return;event.preventDefault();listeners.state({type:'shortcut',name:shortcut});});
  wc.setAudioMuted(false);
  wc.on('did-start-loading',()=>listeners.navigate({type:'start'}));
  for(const name of ['did-stop-loading','did-navigate','did-navigate-in-page','page-title-updated'])wc.on(name,()=>listeners.navigate({type:'update'}));
  wc.on('did-fail-load',(_e,code,description,url,isMainFrame)=>{if(!isMainFrame||code===-3)return;listeners.navigate({type:'fail',code,description,url});});
  wc.on('render-process-gone',()=>listeners.navigate({type:'gone',url:wc.getURL()}));
 }
 function show(bounds){const win=getWindow();if(!win||win.isDestroyed()||!view)return;if(!attached){win.contentView.addChildView(view);attached=true;}view.setBounds(bounds);view.setVisible(true);}
 function hide(){const win=getWindow();if(!win||win.isDestroyed()||!view)return;if(attached)view.setVisible(false);}
 function close(){findActive=false;if(!view)return;const win=getWindow();if(attached&&win&&!win.isDestroyed())win.contentView.removeChildView(view);attached=false;try{view.webContents.close();}catch{}view=null;}
 function idle(wc,ms){if(!wc.isLoading())return Promise.resolve();return new Promise(resolve=>{const done=()=>{clearTimeout(timer);wc.removeListener('did-stop-loading',done);resolve();};const timer=setTimeout(done,ms);wc.on('did-stop-loading',done);});}
 return {
  configure(next){settings=next||{};setup();},
  create,show,hide,close,render,
  navigate(url){view?.webContents.loadURL(url).catch(()=>{});},
  back(){if(view?.webContents.navigationHistory.canGoBack())view.webContents.navigationHistory.goBack();},
  forward(){if(view?.webContents.navigationHistory.canGoForward())view.webContents.navigationHistory.goForward();},
  reload(){view?.webContents.reload();},
  stop(){view?.webContents.stop();},
  // Electron: findNext=true starts a new search session; follow-up steps through matches pass false.
  find(text,options){const wc=live();if(!wc)return false;wc.findInPage(text,options);return true;},
  stopFind(action){findActive=false;const wc=view?.webContents;if(!wc)return false;if(action==='clearSelection'&&wc.isDestroyed())return false;wc.stopFindInPage(action);return true;},
  evalIsolated(script){const wc=live();if(!wc)return Promise.reject(Error('The browser panel is closed.'));return wc.executeJavaScriptInIsolatedWorld(PAGE_WORLD,[{code:script}]);},
  input(event){live()?.sendInputEvent(event);},
  info(){const wc=live();if(!wc)return null;return {url:wc.getURL(),title:wc.getTitle(),loading:wc.isLoading(),canGoBack:wc.navigationHistory.canGoBack(),canGoForward:wc.navigationHistory.canGoForward(),zoom:wc.getZoomFactor()};},
  setZoom(factor){live()?.setZoomFactor(factor);},
  waitIdle(ms){const wc=live();return wc?idle(wc,ms):Promise.resolve();},
  async clearData(){const session=setup();if(renderWin&&!renderWin.isDestroyed())renderWin.destroy();renderWin=null;hostChecks.clear();await session.clearStorageData();await session.clearCache();await session.clearHostResolverCache?.();},
  onNavigate(cb){listeners.navigate=cb;},
  onPopup(cb){listeners.popup=cb;},
  onState(cb){listeners.state=cb;},
 };
}
module.exports={createBrowserView};
