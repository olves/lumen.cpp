'use strict';
// Remote pages never run in Lumen's privileged UI. Both surfaces below use the separate "persist:lumen-web" session,
// no preload, no Node, sandboxed renderers, and no access to Lumen IPC:
//  - render(url): one reusable hidden window, only used when the lightweight reader finds almost no text;
//    it is destroyed after a minute of inactivity;
//  - the panel: one WebContentsView placed over the browser panel area of the main window.
// Permissions, downloads, dialogs and popups are refused; requests to local/private addresses are cancelled.
const {BrowserWindow,WebContentsView,session,shell}=require('electron');
const dns=require('node:dns').promises,net=require('node:net');
const {checkUrl,privateAddress,blockedHostname}=require('./web.cjs');

const PARTITION='persist:lumen-web';
const webPreferences={partition:PARTITION,sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:false,webSecurity:true,allowRunningInsecureContent:false,spellcheck:false,disableDialogs:true,safeDialogs:true,autoplayPolicy:'document-user-activation-required',enableWebSQL:false,navigateOnDragDrop:false};

const searchEngines={duckduckgo:['https://duckduckgo.com/?q=','https://duckduckgo.com/'],google:['https://www.google.com/search?q=','https://www.google.com/'],bing:['https://www.bing.com/search?q=','https://www.bing.com/'],brave:['https://search.brave.com/search?q=','https://search.brave.com/'],startpage:['https://www.startpage.com/do/search?q=','https://www.startpage.com/']};

function createBrowser({getWindow,emit,getSettings=()=>({})}){
 const web=session.fromPartition(PARTITION);
 const hostChecks=new Map();
 async function hostAllowed(hostname){
  const host=hostname.replace(/^\[|\]$/g,'');
  if(blockedHostname(host))return false;
  if(net.isIP(host))return !privateAddress(host);
  const hit=hostChecks.get(host);if(hit&&hit.expires>Date.now())return hit.ok;
  let ok=false;try{const answers=await dns.lookup(host,{all:true});ok=answers.length>0&&answers.every(a=>!privateAddress(a.address));}catch{ok=false;}
  if(hostChecks.size>500)hostChecks.delete(hostChecks.keys().next().value);hostChecks.set(host,{ok,expires:Date.now()+60000});return ok;
 }
 web.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 web.setPermissionCheckHandler(()=>false);
 web.setDevicePermissionHandler?.(()=>false);
 web.setDisplayMediaRequestHandler?.((_request,callback)=>callback({}));
 web.on('will-download',event=>event.preventDefault());
 web.setSpellCheckerEnabled?.(false);
 web.webRequest.onBeforeSendHeaders({urls:['<all_urls>']},(details,callback)=>{if(getSettings().privacySignals===false)return callback({requestHeaders:details.requestHeaders});callback({requestHeaders:{...details.requestHeaders,'Sec-GPC':'1',DNT:'1'}});});
 web.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>{
  let url;try{url=new URL(details.url);}catch{return callback({cancel:true});}
  if(['data:','blob:','about:'].includes(url.protocol))return callback({});
  if(!['http:','https:','ws:','wss:'].includes(url.protocol)||url.username||url.password)return callback({cancel:true});
  hostAllowed(url.hostname).then(ok=>callback({cancel:!ok}),()=>callback({cancel:true}));
 });

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
 function render(url,{signal}={}){const task=renderChain.then(()=>renderNow(url,signal));renderChain=task.catch(()=>{});return task;}
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
 let view=null,attached=false,bounds=null,lastError=null,findResult=null,viewJavascript=null;
 function state(){const wc=view?.webContents;return {zoom:wc&&!wc.isDestroyed()?Math.round(wc.getZoomFactor()*100):getSettings().zoom||100,find:findResult,open:!!view,url:wc&&!wc.isDestroyed()?wc.getURL():'',title:wc&&!wc.isDestroyed()?wc.getTitle():'',loading:!!wc&&!wc.isDestroyed()&&wc.isLoading(),canGoBack:!!wc&&!wc.isDestroyed()&&wc.navigationHistory.canGoBack(),canGoForward:!!wc&&!wc.isDestroyed()&&wc.navigationHistory.canGoForward(),error:lastError};}
 const update=()=>{place();emit(state());};
 function place(){
  const win=getWindow();if(!win||win.isDestroyed()||!view)return;
  const show=!!bounds&&!lastError;
  if(show&&!attached){win.contentView.addChildView(view);attached=true;}
  if(attached){if(show)view.setBounds(bounds);view.setVisible(show);}
 }
 function ensure(){
  if(view)return view;
  const settings=getSettings();viewJavascript=settings.javascript!==false;
  view=new WebContentsView({webPreferences:{...webPreferences,javascript:viewJavascript}});const wc=view.webContents;
  // Pop-ups never open new windows: they either replace the panel page or are blocked, as chosen in Settings.
  guard(wc,url=>{if(getSettings().popups==='block')return;lastError=null;wc.loadURL(url).catch(()=>{});});
  wc.on('did-finish-load',()=>{const zoom=(getSettings().zoom||100)/100;if(Math.abs(wc.getZoomFactor()-zoom)>0.001&&!wc.__userZoom)wc.setZoomFactor(zoom);});
  wc.on('found-in-page',(_e,result)=>{findResult={matches:result.matches,active:result.activeMatchOrdinal};emit(state());});
  // Keyboard shortcuts typed while the page has focus are handled by Lumen's panel, not by the page.
  wc.on('before-input-event',(event,input)=>{if(input.type!=='keyDown')return;const mod=input.control||input.meta,key=String(input.key||'').toLowerCase();let shortcut=null;
   if(mod&&key==='f')shortcut='find';else if(mod&&key==='l')shortcut='address';else if(mod&&(key==='='||key==='+'))shortcut='zoom-in';else if(mod&&key==='-')shortcut='zoom-out';else if(mod&&key==='0')shortcut='zoom-reset';else if(key==='escape'&&findResult)shortcut='find-close';else if(input.alt&&key==='arrowleft')shortcut='back';else if(input.alt&&key==='arrowright')shortcut='forward';else if(key==='f5'||(mod&&key==='r'))shortcut='reload';
   if(!shortcut)return;event.preventDefault();if(shortcut.startsWith('zoom'))zoom(shortcut==='zoom-in'?1:shortcut==='zoom-out'?-1:0);else if(shortcut==='back'&&wc.navigationHistory.canGoBack())wc.navigationHistory.goBack();else if(shortcut==='forward'&&wc.navigationHistory.canGoForward())wc.navigationHistory.goForward();else if(shortcut==='reload')wc.reload();else emit({...state(),shortcut});});
  wc.setAudioMuted(false);
  wc.on('did-start-loading',()=>{lastError=null;update();});
  for(const name of ['did-stop-loading','did-navigate','did-navigate-in-page','page-title-updated'])wc.on(name,update);
  wc.on('did-fail-load',(_e,code,description,url,isMainFrame)=>{if(!isMainFrame||code===-3)return;lastError={code,blocked:code===-20,description,url};update();});
  wc.on('render-process-gone',()=>{lastError={code:-1,description:'The page stopped responding.',url:wc.getURL()};update();});
  return view;
 }
 function close(silent=false){findResult=null;if(!view)return state();const win=getWindow();if(attached&&win&&!win.isDestroyed())win.contentView.removeChildView(view);attached=false;try{view.webContents.close();}catch{}view=null;lastError=null;if(!silent)emit(state());return state();}
 // Address bar: a URL opens directly; anything else (spaces, no dot) is searched with the chosen engine.
 function normalize(input){
  const text=String(input||'').trim();if(!text||text.length>2000)throw Object.assign(Error('Enter a web address.'),{code:'invalid-url'});
  if(/^[a-z][a-z0-9+.-]*:/i.test(text))return checkUrl(text).href;
  if(/\s/.test(text)||!/^[^\s/]+\.[^\s/]{2,}/.test(text)&&!/^localhost(?::|\/|$)/i.test(text)){const engine=searchEngines[getSettings().searchEngine]||searchEngines.duckduckgo;return engine[0]+encodeURIComponent(text);}
  return checkUrl('https://'+text).href;
 }
 const zoomSteps=[50,67,75,80,90,100,110,125,150,175,200];
 function zoom(step){const wc=view?.webContents;if(!wc||wc.isDestroyed())return state();const current=Math.round(wc.getZoomFactor()*100);let next=getSettings().zoom||100;
  if(step>0)next=zoomSteps.find(z=>z>current)||200;else if(step<0)next=[...zoomSteps].reverse().find(z=>z<current)||50;
  wc.__userZoom=step!==0;wc.setZoomFactor(next/100);emit(state());return state();}
 return {
  render,
  home(){const settings=getSettings();return this.open(settings.homePage||(searchEngines[settings.searchEngine]||searchEngines.duckduckgo)[1]);},
  find(text,{forward=true,next=false}={}){const wc=view?.webContents;if(!wc||wc.isDestroyed())return false;if(!text){wc.stopFindInPage('clearSelection');findResult=null;emit(state());return true;}// Electron: findNext=true starts a new search session; follow-up steps through matches pass false.
  wc.findInPage(text,{forward,findNext:!next});return true;},
  stopFind(){view?.webContents.stopFindInPage('keepSelection');findResult=null;emit(state());return true;},
  zoom:step=>zoom(Number(step)||0),
  // Settings that need a new page process (JavaScript) recreate the panel at the same address; others apply live.
  applySettings(){if(!view)return;const settings=getSettings(),wc=view.webContents;if((settings.javascript!==false)!==viewJavascript){const url=wc.getURL();close(true);if(/^https?:/.test(url))this.open(url);else emit(state());place();return;}if(!wc.__userZoom)wc.setZoomFactor((settings.zoom||100)/100);emit(state());},
  open(url){const target=normalize(url);ensure();lastError=null;view.webContents.loadURL(target).catch(()=>{});update();return state();},
  back(){if(view?.webContents.navigationHistory.canGoBack())view.webContents.navigationHistory.goBack();return state();},
  forward(){if(view?.webContents.navigationHistory.canGoForward())view.webContents.navigationHistory.goForward();return state();},
  reload(){if(view){lastError=null;view.webContents.reload();}return state();},
  stop(){view?.webContents.stop();return state();},
  close,
  bounds(rect){if(rect&&[rect.x,rect.y,rect.width,rect.height].every(Number.isFinite)&&rect.width>=80&&rect.height>=80)bounds={x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)};else bounds=null;place();return true;},
  async external(url){const target=normalize(url);await shell.openExternal(target);return true;},
  async clearData(){close();if(renderWin&&!renderWin.isDestroyed())renderWin.destroy();renderWin=null;hostChecks.clear();await web.clearStorageData();await web.clearCache();await web.clearHostResolverCache?.();return true;},
  state
 };
}
module.exports={createBrowser,PARTITION};
