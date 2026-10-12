'use strict';
// Artifact preview: an HTML or SVG code block from a reply, shown in its own window. The page runs in a separate in-memory
// session ("lumen-artifact"): sandboxed renderer, no preload, no Node, and no network at all — every request other than the
// page itself is cancelled, and the page's CSP only allows inline code and data:/blob: media. It cannot navigate, open
// windows, download files or ask for permissions. Nothing is written to disk.
const crypto = require('node:crypto');

const MAX_CHARS = 2000000;
const CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; worker-src blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

function documentFor(kind, code, {dark}) {
  if (kind === 'svg') {
    const bg = dark ? '#1c1c1b' : '#ffffff';
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:${bg}}body{display:grid;place-items:center}svg{max-width:100%;max-height:100vh;height:auto}</style></head><body>${code}</body></html>`;
  }
  // A fragment gets a minimal document around it; a full document is used as it is.
  if (/<html[\s>]|<!doctype/i.test(code)) return code;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${code}</body></html>`;
}

function createArtifacts({BrowserWindow, session, getWindow, icon}) {
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

  function open({code, kind, title, dark}) {
    if (typeof code !== 'string' || !code.trim() || code.length > MAX_CHARS) throw Error('Nothing to preview.');
    if (!['html', 'svg'].includes(kind)) throw Error('Only HTML and SVG can be previewed.');
    setupSession();
    const token = crypto.randomBytes(16).toString('hex');
    pages.clear(); pages.set(token, documentFor(kind, code, {dark: dark === true}));
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
  return {open, close, window: () => view, CSP};
}

module.exports = {createArtifacts, documentFor, CSP};
