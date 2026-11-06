'use strict';
// The in-app browser: the user's web panel next to the chat and the hidden JavaScript renderer used by the web reader.
// Pages, sessions and windows belong to the shell (platform.browser; Electron: electron/browser-view.cjs), which keeps them
// in a separate web session with no preload, no Node, sandboxed renderers, no access to Lumen IPC, and refuses permissions,
// downloads, dialogs, popups and requests to local/private addresses. This file decides what the panel shows (state,
// errors, find results, zoom), the address bar, and the chat commands (click, scroll, settle).
const {checkUrl}=require('./web.cjs');

const PARTITION='persist:lumen-web';

const searchEngines={duckduckgo:['https://duckduckgo.com/?q=','https://duckduckgo.com/'],google:['https://www.google.com/search?q=','https://www.google.com/'],bing:['https://www.bing.com/search?q=','https://www.bing.com/'],brave:['https://search.brave.com/search?q=','https://search.brave.com/'],startpage:['https://www.startpage.com/do/search?q=','https://www.startpage.com/']};

function createBrowser({platform,emit,getSettings=()=>({})}){
 const b=platform.browser;
 b.configure(getSettings());
 let open=false,bounds=null,lastError=null,findResult=null,viewJavascript=null,userZoom=false;
 async function state(){const i=open?await b.info():null;return {zoom:i?Math.round(i.zoom*100):getSettings().zoom||100,find:findResult,open,url:i?i.url:'',title:i?i.title:'',loading:!!i&&i.loading,canGoBack:!!i&&i.canGoBack,canGoForward:!!i&&i.canGoForward,error:lastError};}
 const update=async()=>{place();emit(await state());};
 function place(){
  if(!open)return;
  const show=!!bounds&&!lastError;
  if(show)b.show(bounds);else b.hide();
 }
 function ensure(){
  if(open)return;
  const settings=getSettings();viewJavascript=settings.javascript!==false;
  b.create({javascript:viewJavascript});open=true;userZoom=false;
 }
 // Pop-ups never open new windows: they either replace the panel page or are blocked, as chosen in Settings.
 b.onPopup(url=>{if(!open||getSettings().popups==='block')return;lastError=null;b.navigate(url);});
 b.onNavigate(async e=>{
  if(!open)return;
  // A user zoom is kept across page loads; otherwise each page gets the zoom from Settings.
  if(e.type==='finish'){const zoom=(getSettings().zoom||100)/100;const i=await b.info();if(i&&Math.abs(i.zoom-zoom)>0.001&&!userZoom)b.setZoom(zoom);return;}
  if(e.type==='start')lastError=null;
  else if(e.type==='fail')lastError={code:e.code,blocked:e.code===-20,description:e.description,url:e.url};
  else if(e.type==='gone')lastError={code:-1,description:'The page stopped responding.',url:e.url};
  update();
 });
 // Keyboard shortcuts typed while the page has focus are handled by Lumen's panel, not by the page.
 b.onState(async e=>{
  if(!open)return;
  if(e.type==='found'){findResult={matches:e.matches,active:e.active};emit(await state());return;}
  if(e.type!=='shortcut')return;const shortcut=e.name;
  if(shortcut.startsWith('zoom'))zoom(shortcut==='zoom-in'?1:shortcut==='zoom-out'?-1:0);else if(shortcut==='back')b.back();else if(shortcut==='forward')b.forward();else if(shortcut==='reload')b.reload();else emit({...await state(),shortcut});
 });
 async function close(silent=false){findResult=null;if(!open)return state();await b.close();open=false;userZoom=false;lastError=null;if(!silent)emit(await state());return state();}
 // Address bar: a URL opens directly; anything else (spaces, no dot) is searched with the chosen engine.
 function normalize(input){
  const text=String(input||'').trim();if(!text||text.length>2000)throw Object.assign(Error('Enter a web address.'),{code:'invalid-url'});
  if(/^[a-z][a-z0-9+.-]*:/i.test(text))return checkUrl(text).href;
  if(/\s/.test(text)||!/^[^\s/]+\.[^\s/]{2,}/.test(text)&&!/^localhost(?::|\/|$)/i.test(text)){const engine=searchEngines[getSettings().searchEngine]||searchEngines.duckduckgo;return engine[0]+encodeURIComponent(text);}
  return checkUrl('https://'+text).href;
 }
 // ---------- Clicking a link or button the user names in chat ----------
 // The page is searched in an isolated world (page scripts cannot see or change the search) for a visible link/button whose
 // text matches; it is clicked with a real mouse event at its center. Lumen never types into pages. Buttons that look like
 // paying, sending, deleting, posting or confirming report "confirm" first, so the user decides.
 const RISKY=String.raw`(^|\s)(satın al|hemen al|öde|ödeme yap|ödemeyi tamamla|siparişi (ver|tamamla|onayla)|sipariş ver|gönder|sil|kaldır|onayla|paylaş|yayınla|abone ol|aboneliği iptal|hesabı (sil|kapat)|transfer|buy|buy now|purchase|pay|pay now|checkout|place order|order now|send|delete|remove|confirm|submit|publish|post|share|subscribe|unsubscribe|transfer)($|\s)`;
 const finder=labels=>`(()=>{const n=s=>String(s||'').replace(/\\s+/g,' ').trim().toLocaleLowerCase('tr-TR').replace(/ı/g,'i').replace(/[.:…!?]+$/,'');const want=${JSON.stringify(labels)}.map(n).filter(Boolean);
  const list=[];for(const el of document.querySelectorAll('a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],input[type=submit],input[type=button],summary')){const r=el.getBoundingClientRect();if(r.width<2||r.height<2)continue;const cs=getComputedStyle(el);if(cs.visibility==='hidden'||cs.display==='none'||el.disabled||el.getAttribute('aria-disabled')==='true')continue;const text=n(el.innerText||el.value||el.getAttribute('aria-label')||el.title);if(!text||text.length>120)continue;list.push({el,text});}
  let best=null;for(const c of list)for(const w of want){let s=0;if(c.text===w)s=3;else if(c.text.startsWith(w+' ')||c.text.endsWith(' '+w))s=2;else if(w.length>=3&&c.text.includes(w))s=1;if(s&&(!best||s>best.s||(s===best.s&&c.text.length<best.c.text.length)))best={c,s};}
  if(!best)return {status:'missing',seen:[...new Set(list.map(c=>c.text).filter(t=>t.length<=40))].slice(0,12)};
  const el=best.c.el,form=el.closest('form');const risky=new RegExp(${JSON.stringify(RISKY)}).test(best.c.text)||!!(form&&form.querySelector('[autocomplete^="cc-"]'));
  el.scrollIntoView({block:'center',inline:'center',behavior:'instant'});const r=el.getBoundingClientRect();const token=Math.random().toString(36).slice(2);el.setAttribute('data-lumen-target',token);window.__lumenHit=null;el.addEventListener('click',()=>{window.__lumenHit=token;},{capture:true,once:true});
  return {status:'found',token,text:String(el.innerText||el.value||el.getAttribute('aria-label')||el.title||'').replace(/\\s+/g,' ').trim().slice(0,80),risky,x:r.left+r.width/2,y:r.top+r.height/2};})()`;
 async function click(labels,{force=false}={}){
  if(!open||!await b.info())return {status:'closed'};
  if(getSettings().javascript===false)return {status:'no-script'};
  await b.waitIdle(15000);
  let found;try{found=await b.evalIsolated(finder(labels));}catch{return {status:'unavailable'};}
  if(!found||found.status!=='found')return found||{status:'unavailable'};
  if(found.risky&&!force)return {status:'confirm',text:found.text,url:(await b.info())?.url||''};
  const zoomFactor=(await b.info())?.zoom||1,x=Math.round(found.x*zoomFactor),y=Math.round(found.y*zoomFactor);
  await b.input({type:'mouseMove',x,y});await b.input({type:'mouseDown',x,y,button:'left',clickCount:1});await b.input({type:'mouseUp',x,y,button:'left',clickCount:1});
  await new Promise(r=>setTimeout(r,250));
  // If the mouse click did not reach the element (an overlay, or the panel is not on screen), click the element itself.
  let how='mouse';try{how=await b.evalIsolated(`(()=>{const el=document.querySelector('[data-lumen-target="${found.token}"]');const hit=window.__lumenHit===${JSON.stringify(found.token)};if(!hit&&el)el.click();el&&el.removeAttribute('data-lumen-target');return hit?'mouse':'element';})()`);}catch{}
  await new Promise(r=>setTimeout(r,500));
  return {status:'clicked',how,text:found.text,url:(await b.info())?.url||''};
 }
 async function scroll(direction){
  if(!open||!await b.info())return {status:'closed'};
  const code={down:'window.scrollBy({top:innerHeight*0.8,behavior:"instant"})',up:'window.scrollBy({top:-innerHeight*0.8,behavior:"instant"})',top:'window.scrollTo({top:0,behavior:"instant"})',bottom:'window.scrollTo({top:document.scrollingElement.scrollHeight,behavior:"instant"})'}[direction];
  if(!code)return {status:'invalid'};
  try{await b.evalIsolated(code+';0');}catch{return {status:'unavailable'};}
  return {status:'scrolled'};
 }
 const zoomSteps=[50,67,75,80,90,100,110,125,150,175,200];
 async function zoom(step){const i=open?await b.info():null;if(!i)return state();const current=Math.round(i.zoom*100);let next=getSettings().zoom||100;
  if(step>0)next=zoomSteps.find(z=>z>current)||200;else if(step<0)next=[...zoomSteps].reverse().find(z=>z<current)||50;
  userZoom=step!==0;await b.setZoom(next/100);emit(await state());return state();}
 return {
  render:(url,options)=>b.render(url,options),
  home(){const settings=getSettings();return this.open(settings.homePage||(searchEngines[settings.searchEngine]||searchEngines.duckduckgo)[1]);},
  async find(text,{forward=true,next=false}={}){if(!open||!await b.info())return false;if(!text){await b.stopFind('clearSelection');findResult=null;emit(await state());return true;}// Electron: findNext=true starts a new search session; follow-up steps through matches pass false.
  await b.find(text,{forward,findNext:!next});return true;},
  async stopFind(){if(open)await b.stopFind('keepSelection');findResult=null;emit(await state());return true;},
  zoom:step=>zoom(Number(step)||0),
  // Settings that need a new page process (JavaScript) recreate the panel at the same address; others apply live.
  async applySettings(){const settings=getSettings();b.configure(settings);if(!open)return;if((settings.javascript!==false)!==viewJavascript){const url=(await b.info())?.url||'';await close(true);if(/^https?:/.test(url))this.open(url);else emit(await state());place();return;}if(!userZoom)await b.setZoom((settings.zoom||100)/100);emit(await state());},
  async open(url){const target=normalize(url);ensure();lastError=null;b.navigate(target);await update();return state();},
  async back(){if(open)await b.back();return state();},
  async forward(){if(open)await b.forward();return state();},
  async reload(){if(open){lastError=null;await b.reload();}return state();},
  async stop(){if(open)await b.stop();return state();},
  click,scroll,
  // Waits (bounded) until the panel page has finished loading, for chained commands such as "open X and click Y".
  async settle(ms=15000){if(open&&await b.info())await b.waitIdle(ms);return state();},
  close,
  bounds(rect){if(rect&&[rect.x,rect.y,rect.width,rect.height].every(Number.isFinite)&&rect.width>=80&&rect.height>=80)bounds={x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)};else bounds=null;place();return true;},
  async external(url){const target=normalize(url);await platform.openExternal(target);return true;},
  async clearData(){await close();await b.clearData();return true;},
  state
 };
}
module.exports={createBrowser,PARTITION};
