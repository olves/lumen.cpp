'use strict';
// The services a shell (Electron today, Tauri later) gives Lumen's core (core.cjs). The core never requires electron;
// everything that needs a window, a webview or an OS service goes through this object. Each shell implements it with the same
// inputs and outputs as Electron's equivalent. Callers await every method (a shell may answer synchronously or with a promise), secrets.* included.
//
//  send(channel, payload)                         event to the main window's renderer (engine-event, agent-event, ...)
//  windowAction('minimize'|'maximize'|'close')
//  dialog.open(opts) -> {canceled, filePaths}     dialog.save(opts) -> {canceled, filePath}     dialog.message(opts) -> {response}
//  clipboard.writeText(text)   clipboard.writePng(pngPath)
//  clipboard.read() -> [{type:'text', text} | {type:'image', mime, path}]   raw image bytes in a temp file the caller deletes
//  image.decodeWebp(buffer) -> pngBuffer           WebP fallback (at most 1600 px, 50 million pixels)
//  image.normalize(buffer, maxSide, quality) -> {png, width, height, original:{width, height}} | null (cannot decode)
//                                                  scaled down to fit maxSide only when larger; quality 'best'|'good'
//  image.thumbnail(pngBuffer, maxSide, fit='longest'|'width') -> pngBuffer   never scales up; quality 'good'
//  secrets.available() -> bool   secrets.encrypt(text) -> base64   secrets.decrypt(base64) -> text   (all three may return a promise)
//  openExternal(url)
//  assetBase    root of UI asset URLs ('lumen://app/' in Electron)
//  appDir       folder of the running executable (updates.cjs)
//  updateMode   'full' | 'check-only'
//  app.version  app.quit()  app.relaunchArgs() -> string[]   (test flags to keep when the updater restarts Lumen)
//  browser.*    the web panel and the hidden JavaScript renderer (separate web session; see browser.cjs):
//    configure(settings)   latest Settings → Browser values (privacySignals); the first call sets the web session up
//    create({javascript})  creates the panel page if there is none
//    show(bounds) hide() navigate(url) back() forward() reload() stop() close()
//    find(text, {forward, findNext}) -> bool   stopFind('clearSelection'|'keepSelection') -> bool
//    evalIsolated(script) -> value   (the page's own scripts cannot see or change it)
//    input(event)                    mouse event {type:'mouseMove'|'mouseDown'|'mouseUp', x, y, button?, clickCount?}
//    info() -> {url, title, loading, canGoBack, canGoForward, zoom} | null   setZoom(factor)   waitIdle(ms)
//    render(url, {signal}) -> {title, url, text}   clearData()
//    onNavigate(cb) cb({type:'start'|'update'|'finish'|'fail'|'gone', code?, description?, url?})
//    onPopup(cb)    cb(url)   (already checked; the core decides whether the panel follows it)
//    onState(cb)    cb({type:'found', matches, active} | {type:'shortcut', name})
//  artifact.open(html, kind, {title, dark})   artifact.close()
//
// A shell that runs the core out of process (core-host.cjs, newline-delimited JSON on stdin/stdout) answers each member above as
// a request {id, type:'platform', method, args} with {id, type:'platform-result', ok, value|error}. Where the contract carries
// something JSON cannot, core-host.cjs uses these conventions (the Rust shell implements them from here):
//  - Buffers are files under <data>/temp/rpc; the core picks both paths and removes them afterwards. The shell writes PNG output
//    to outPath:  image.decodeWebp [inPath, outPath] -> any value;  image.thumbnail [inPath, outPath, maxSide, fit] -> any value;
//    image.normalize [inPath, outPath, maxSide|null, quality] -> null (cannot decode) | {width, height, original:{width, height}}
//    (maxSide null = no limit).
//  - browser.render [url, {}]: the AbortSignal stays in the core. When it aborts, the core stops waiting and sends the request
//    {method:'browser.cancel', args:[idOfTheRenderRequest]}; the shell should stop that render (best effort, answer ignored).
//  - browser.onNavigate / browser.onPopup / browser.onState (no args): the shell starts forwarding that callback and, for each
//    event, sends {type:'platform-event', name:'browser.onNavigate'|'browser.onPopup'|'browser.onState', payload} to the core
//    (payload is the callback's argument; it must be an object, other names and payloads are ignored).
//  - app.version, assetBase, appDir, updateMode are command-line arguments of core-host.cjs and never requests.
//  - After the shell closes the core's stdin every platform request fails at once; after an explicit {type:'shutdown'} the shell
//    must keep answering until the core has exited.

const FUNCTIONS = [
  'send', 'windowAction',
  'dialog.open', 'dialog.save', 'dialog.message',
  'clipboard.writeText', 'clipboard.writePng', 'clipboard.read',
  'image.decodeWebp', 'image.normalize', 'image.thumbnail',
  'secrets.available', 'secrets.encrypt', 'secrets.decrypt',
  'openExternal',
  'app.quit', 'app.relaunchArgs',
  'browser.configure', 'browser.create', 'browser.show', 'browser.hide', 'browser.navigate', 'browser.back', 'browser.forward',
  'browser.reload', 'browser.stop', 'browser.close', 'browser.find', 'browser.stopFind', 'browser.evalIsolated', 'browser.input',
  'browser.info', 'browser.setZoom', 'browser.waitIdle', 'browser.render', 'browser.clearData',
  'browser.onNavigate', 'browser.onPopup', 'browser.onState',
  'artifact.open', 'artifact.close',
];
const STRINGS = ['assetBase', 'appDir', 'app.version'];
const UPDATE_MODES = ['full', 'check-only'];

function lookup(platform, name) { return name.split('.').reduce((o, key) => (o == null ? undefined : o[key]), platform); }

// Throws Error('platform.<name> missing') for the first member that is absent or of the wrong kind.
function assertPlatform(platform) {
  if (!platform || typeof platform !== 'object') throw Error('platform missing');
  for (const name of FUNCTIONS) if (typeof lookup(platform, name) !== 'function') throw Error('platform.' + name + ' missing');
  for (const name of STRINGS) if (typeof lookup(platform, name) !== 'string' || !lookup(platform, name)) throw Error('platform.' + name + ' missing');
  if (!UPDATE_MODES.includes(platform.updateMode)) throw Error('platform.updateMode missing');
  return platform;
}

module.exports = {assertPlatform, FUNCTIONS, STRINGS, UPDATE_MODES};
