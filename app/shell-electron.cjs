'use strict';
// Electron shell: the window, the lumen:// protocol, the preload, IPC registration and the Electron implementation of the
// platform services (platform.cjs). Everything else is the core (core.cjs), which never requires electron.
const {app,BrowserWindow,ipcMain,dialog,session,protocol,clipboard,nativeImage,safeStorage,shell}=require('electron');
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {createCore}=require('./core.cjs');
const {createBrowserView}=require('./electron/browser-view.cjs');
const {createArtifactWindow}=require('./electron/artifact-window.cjs');
const test=process.argv.includes('--ui-check');const testDir=process.argv.find(a=>a.startsWith('--test-data='))?.slice(12)||process.env.LUMEN_TEST_DIR;if(process.argv.some(a=>a.startsWith('--check-output=')))process.env.LUMEN_CHECK_OUTPUT=process.argv.find(a=>a.startsWith('--check-output=')).slice(15);let win,lumen,started=false;
const data=testDir||path.join(process.env.LOCALAPPDATA,'lumen.cpp');

// WebP that nativeImage cannot decode is decoded by Chromium in the workspace renderer (createImageBitmap).
async function decodeWebp(buffer){if(!win||win.isDestroyed())throw Error('The workspace is unavailable.');const base64=buffer.toString('base64');const script='(async()=>{const bytes=Uint8Array.from(atob('+JSON.stringify(base64)+'),c=>c.charCodeAt(0));const image=await createImageBitmap(new Blob([bytes],{type:"image/webp"}));try{if(image.width*image.height>50000000)throw Error("Use a photo with at most 50 million pixels.");const scale=Math.min(1,1600/Math.max(image.width,image.height)),canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL("image/png").split(",")[1];}finally{image.close();}})()';return Buffer.from(await win.webContents.executeJavaScript(script),'base64');}
// nativeImage results by PNG buffer, so a thumbnail of a just-normalized photo is made from the same bitmap as before the split.
const normalizedImages=new WeakMap();
const platform={
 send:(channel,payload)=>{if(win&&!win.isDestroyed())win.webContents.send(channel,payload);},
 windowAction:action=>{if(action==='minimize')win.minimize();if(action==='maximize')win.isMaximized()?win.unmaximize():win.maximize();if(action==='close')win.close();},
 dialog:{open:o=>dialog.showOpenDialog(win,o),save:o=>dialog.showSaveDialog(win,o),message:o=>dialog.showMessageBox(win,o)},
 clipboard:{
  writeText:text=>clipboard.writeText(text),
  // Electron 44 has only the async clipboard API (no writeImage).
  writePng:async file=>{await clipboard.write([new (require('electron').ClipboardItem)({'image/png':new Blob([await fs.promises.readFile(file)],{type:'image/png'})})]);},
  // Images are handed over as temp files under <data>/temp/clipboard; the core removes them.
  read:async()=>{const out=[];const items=await clipboard.read();for(const item of items){const type=item.types.find(type=>['image/png','image/jpeg','image/webp'].includes(type));
   if(type){const blob=await item.getType(type);const dir=path.join(data,'temp','clipboard');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,crypto.randomBytes(12).toString('hex'));await fs.promises.writeFile(file,Buffer.from(await blob.arrayBuffer()));out.push({type:'image',mime:type,path:file});break;}
   if(item.types.includes('text/plain')){try{out.push({type:'text',text:await (await item.getType('text/plain')).text()});}catch{}}}return out;}
 },
 image:{
  decodeWebp,
  normalize:async(buffer,maxSide,quality)=>{let image=nativeImage.createFromBuffer(buffer);if(image.isEmpty())return null;const original=image.getSize();if(Math.max(original.width,original.height)>maxSide){const scale=maxSide/Math.max(original.width,original.height);image=image.resize({width:Math.max(1,Math.round(original.width*scale)),height:Math.max(1,Math.round(original.height*scale)),quality});}const png=image.toPNG();normalizedImages.set(png,image);const size=image.getSize();return {png,width:size.width,height:size.height,original};},
  thumbnail:async(buffer,maxSide,fit='longest')=>{const image=normalizedImages.get(buffer)||nativeImage.createFromBuffer(buffer);const size=image.getSize();if(fit==='width')return image.resize({width:Math.min(maxSide,size.width),quality:'good'}).toPNG();const scale=Math.min(1,maxSide/Math.max(size.width,size.height));return image.resize({width:Math.max(1,Math.round(size.width*scale)),height:Math.max(1,Math.round(size.height*scale)),quality:'good'}).toPNG();},
 },
 // safeStorage (DPAPI): the stored format stays base64 of encryptString's output.
 secrets:{available:async()=>safeStorage.isEncryptionAvailable(),encrypt:async text=>safeStorage.encryptString(text).toString('base64'),decrypt:async value=>safeStorage.decryptString(Buffer.from(value,'base64'))},
 openExternal:url=>shell.openExternal(url),
 assetBase:'lumen://app/',
 appDir:path.dirname(process.execPath),
 updateMode:'full',
 app:{version:app.getVersion(),quit:()=>app.quit(),relaunchArgs:()=>process.argv.slice(1).filter(a=>/^--(ui-check|no-sandbox|in-process-gpu|disable-gpu|test-data=|check-output=|user-data-dir=)/.test(a))},
 browser:createBrowserView({getWindow:()=>win}),
 artifact:createArtifactWindow({BrowserWindow,session,getWindow:()=>win,icon:path.join(__dirname,'lumen.ico')}),
};

// Another running Lumen holds this data folder (core.lock): say so instead of exiting silently. The language is the saved one,
// else the system's. Test runs (--ui-check) only write desktop-startup-error.log: a modal box would block the harness.
function lockedBox(message){let tr=false;try{const p=JSON.parse(fs.readFileSync(path.join(data,'desktop-preferences.json'),'utf8').replace(/^﻿/,''));tr=p.language?p.language==='tr':/^tr\b/i.test(app.getLocale());}catch{tr=/^tr\b/i.test(app.getLocale());}
 const pid=(String(message).match(/\(process (\d+)\)/)||[])[1];
 if(tr)dialog.showErrorBox('lumen.cpp zaten açık','Lumen bu veri klasörüyle zaten çalışıyor'+(pid?' (işlem '+pid+')':'')+'. Açık olan Lumen penceresini kullanın ya da onu kapatıp yeniden deneyin.');
 else dialog.showErrorBox('lumen.cpp is already open','Lumen is already running with this data folder'+(pid?' (process '+pid+')':'')+'. Use the open Lumen window, or close it and try again.');}
function sender(event){if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('Invalid IPC sender');}
app.setName('lumen.cpp');app.setAppUserModelId('Lumen.Beta.Desktop');
protocol.registerSchemesAsPrivileged([{scheme:'lumen',privileges:{standard:true,secure:true,supportFetchAPI:true}},{scheme:'lumen-artifact',privileges:{standard:true,secure:true}}]);
if(!test&&!app.requestSingleInstanceLock()){app.quit();}else{
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
app.whenReady().then(async()=>{
 lumen=createCore({platform,dataDir:data,test});started=true;await lumen.start();
 protocol.handle('lumen',async req=>{const u=new URL(req.url);if(u.hostname!=='app')return new Response('Not found',{status:404});const r=await lumen.asset(u.pathname);return new Response(r.body!==undefined?r.body:fs.readFileSync(r.filePath),{status:r.status,headers:r.headers});});
 const p=await lumen.call('preferences',[]);
 win=new BrowserWindow({width:1240,height:860,minWidth:780,minHeight:580,frame:false,backgroundColor:p.colorMode==='light'?(p.layout==='studio'?'#eef1f1':'#faf8f4'):'#1c1c1b',show:false,title:'lumen.cpp',icon:path.join(__dirname,'lumen.ico'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false,backgroundThrottling:!test}});
 // Taskbar right-click menu: without relaunch details Windows shows the exe's own name and icon ("Electron").
 if(process.platform==='win32')win.setAppDetails({appId:'Lumen.Beta.Desktop',appIconPath:path.join(__dirname,'lumen.ico'),appIconIndex:0,relaunchCommand:'"'+process.execPath+'"',relaunchDisplayName:'lumen.cpp'});
 session.defaultSession.setPermissionRequestHandler((wc,permission,callback)=>callback(false));
 win.webContents.on('will-navigate',e=>e.preventDefault());win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('render-process-gone',(_event,details)=>fs.appendFileSync(path.join(data,'desktop-engine.log'),JSON.stringify(details)+'\n'));
 for(const channel of lumen.channels)ipcMain.handle(channel,(event,...a)=>{sender(event);return lumen.call(channel,a);});
 ipcMain.on('window',(e,action)=>{sender(e);platform.windowAction(action);});
 await win.loadURL('lumen://app/');if(!test)win.show();else{win.setPosition(-4000,0);win.showInactive();}
}).catch(e=>{fs.mkdirSync(data,{recursive:true});fs.writeFileSync(path.join(data,'desktop-startup-error.log'),e.stack);if(!test&&/^core\.lock: Lumen is already running/.test(String(e&&e.message)))lockedBox(e.message);Promise.resolve(lumen?.stop({now:true})).catch(()=>{}).finally(()=>app.exit(1));});}
let shuttingDown=false;
app.on('window-all-closed',()=>app.quit());app.on('before-quit',event=>{if(!lumen||!started||shuttingDown)return;event.preventDefault();shuttingDown=true;if(win&&!win.isDestroyed())win.hide();lumen.stop().catch(()=>{}).finally(()=>app.exit());});
