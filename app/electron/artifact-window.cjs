'use strict';
// Electron side of the artifact preview (artifacts.cjs): the "lumen-artifact" in-memory session, its protocol and request
// filter, and the preview window. Moved from artifacts.cjs unchanged; the core passes the finished HTML document.
const crypto = require('node:crypto');
const {CSP} = require('../artifacts.cjs');

function createArtifactWindow({BrowserWindow, session, getWindow, icon}) {
  let view = null, ses = null, current = null;
  const pages = new Map(); // token -> html (only the latest page is kept)

  function setupSession() {
    if (ses) return ses;
    ses = session.fromPartition('lumen-artifact', {cache: false});
    ses.protocol.handle('lumen-artifact', request => {
      const token = new URL(request.url).hostname;
      const html = pages.get(token);
      if (!html) return new Response('Not found', {status: 404});
      return new Response(html, {headers: {'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP, 'cache-control': 'no-store'}});
    });
    ses.webRequest.onBeforeRequest((details, callback) => {
      const ok = /^lumen-artifact:\/\/[a-f0-9]{32}\//.test(details.url) || /^(data|blob|devtools|chrome-extension):/.test(details.url);
      callback({cancel: !ok});
    });
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', event => event.preventDefault());
    return ses;
  }

  function open(html, kind, {title, dark} = {}) {
    setupSession();
    const token = crypto.randomBytes(16).toString('hex');
    pages.clear(); pages.set(token, html);
    const name = (typeof title === 'string' && title.trim() ? title.trim().slice(0, 80) : (kind === 'svg' ? 'SVG' : 'HTML')) + ' · preview';
    if (!view || view.isDestroyed()) {
      const parent = getWindow();
      view = new BrowserWindow({width: 960, height: 720, minWidth: 360, minHeight: 280, parent: parent || undefined, title: name, icon, autoHideMenuBar: true,
        backgroundColor: kind === 'svg' && dark ? '#1c1c1b' : '#ffffff', show: false,
        webPreferences: {session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false, preload: undefined, navigateOnDragDrop: false, safeDialogs: true, disableDialogs: true}});
      view.setMenu(null);
      const wc = view.webContents;
      wc.setWindowOpenHandler(() => ({action: 'deny'}));
      wc.on('will-navigate', (event, url) => { if (url !== current) event.preventDefault(); });
      wc.on('will-redirect', event => event.preventDefault());
      wc.on('will-attach-webview', event => event.preventDefault());
      wc.on('page-title-updated', event => event.preventDefault());
      view.once('ready-to-show', () => view.show());
      view.on('closed', () => { view = null; pages.clear(); current = null; });
    } else view.focus();
    view.setTitle(name);view.setBackgroundColor(kind==='svg'&&dark?'#1c1c1b':'#ffffff');
    current = 'lumen-artifact://' + token + '/';
    return view.webContents.loadURL(current).then(() => ({open: true}));
  }
  function close() { if (view && !view.isDestroyed()) view.close(); }
  return {open, close, window: () => view};
}

module.exports = {createArtifactWindow};
