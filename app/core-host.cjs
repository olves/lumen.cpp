'use strict';
// Lumen's core as a standalone process (stdio host): the Tauri shell starts
//   node core-host.cjs --data <dir> --app <dir> [--ui-check] [--asset-base <url>] [--update-mode full|check-only] [--version <v>]
// and talks to it with one JSON object per line on stdin/stdout (UTF-8, '\n'). stdout carries ONLY these lines; everything the
// core or a library prints goes to stderr. A line may be at most 64 MiB; a longer one is dropped and answered with
// {type:'protocol-error', reason:'too-large'}. Binary data never travels in JSON: it is a file path.
//
//  shell -> core   {id, type:'call', channel, args}                the renderer's invoke (core.call)
//                  {type:'shutdown'}                               stop everything and exit (stdin closing does the same)
//                  {id, type:'platform-result', ok, value|error}   answer to a 'platform' request
//                  {type:'platform-event', name, payload}          a callback event of the platform: name is
//                                                                  'browser.onNavigate' | 'browser.onPopup' | 'browser.onState'
//                  {id, type:'asset', path}                        a request of the shell's UI protocol (core.asset(urlPath))
//  core -> shell   {type:'ready', channels}                        the core has started
//                  {id, type:'result', ok, value|error}            answer to a 'call'; error is the message text
//                  {type:'event', channel, payload}                platform.send (engine-event, agent-event, ...)
//                  {id, type:'platform', method, args}             a platform service the shell must answer (platform.cjs)
//                  {id, type:'asset-result', status, headers, filePath|body}   answer to 'asset': the shell serves the file at
//                                                                  filePath, or body (UTF-8 text: index.html, 'Not found')
//                  {type:'protocol-error', reason}                 'too-large' | 'invalid-json' | 'invalid-message'
//
// Platform request ids are 'p<nonce>-<n>': the nonce is random per process, so an answer meant for a core that has died (the shell
// restarts it) can never settle a request of the new one; such an answer is logged to stderr and dropped. Exit codes: 0 after
// shutdown, 1 on a failed start, 3 (EXIT_LOCKED) when another running Lumen holds the data folder's core.lock (the shell shows
// that instead of restarting).
//
// Platform values that are plain data come from the command line (assetBase, appDir, updateMode, app.version). Image buffers go
// through files under <data>/temp/rpc: image.decodeWebp [inPath, outPath], image.normalize [inPath, outPath, maxSide|null,
// quality] (maxSide null = no limit; answer null when the image cannot be decoded, else {width, height, original}),
// image.thumbnail [inPath, outPath, maxSide, fit]; the shell writes the PNG to outPath. browser.render [url, {}] can be
// cancelled with the request {method:'browser.cancel', args:[renderRequestId]}. The browser webviews of the shell send all their
// traffic through the filtering proxy of this process (webproxy.cjs): browser.configure carries [settings, {proxy, realm, testHost}].
// browser.onPopup events carry {url}. The full list is in platform.cjs.
// Once stdin has ended (the shell is gone) every platform request is rejected at once; after an explicit 'shutdown' message the
// shell can still answer, so requests keep working until the core has stopped.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const LINE_LIMIT = 64 * 1024 * 1024;
const EXIT_LOCKED = 3;
// The Tauri shell ends the process 5 s after 'shutdown' (shell-tauri/src/core.rs SHUTDOWN_GRACE): the engine gets at most 4 s, so
// the lock is released and clearOnExit has run before that.
const STOP_CAP_MS = 4000;

// Nothing but protocol lines on stdout.
const stdout = process.stdout;
let onShellGone = null;

function parseArgs(argv) {
  const out = {uiCheck: false};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ui-check') out.uiCheck = true;
    else if (['--data', '--app', '--asset-base', '--update-mode', '--version'].includes(a)) out[a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i];
  }
  return out;
}

const emit = message => stdout.write(JSON.stringify(message) + '\n');
const CALLBACK_NAMES = ['browser.onNavigate', 'browser.onPopup', 'browser.onState'];

// createRpcPlatform: the platform object whose methods are platform requests. `send(message)` writes one protocol line.
// Returns {platform, state}; state.pending/callbacks/gone are what the stdin loop needs.
// webProxy() -> Promise<{url, realm}> (optional): starts the browser proxy; given, every browser.* request waits for it, in order.
function createRpcPlatform({data, assetBase, appDir, updateMode, version, send = emit, webProxy = null}) {
  const {FUNCTIONS} = require('./platform.cjs');
  const state = {pending: new Map(), callbacks: Object.create(null), gone: false, seq: 0, nonce: crypto.randomBytes(8).toString('hex')};
  // Asks the shell to run one platform method. The promise settles with the shell's platform-result.
  function rpc(method, args = []) {
    if (state.gone) return Object.assign(Promise.reject(Error('The shell is gone.')), {id: ''});
    const id = 'p' + state.nonce + '-' + (++state.seq);
    const promise = new Promise((resolve, reject) => { state.pending.set(id, {resolve, reject}); send({id, type: 'platform', method, args}); });
    promise.id = id;
    return promise;
  }
  const emit = send;
  const platform = {assetBase, appDir, updateMode, app: {version}};
  const set = (name, fn) => { const keys = name.split('.'); let o = platform; for (const k of keys.slice(0, -1)) o = o[k] = o[k] || {}; o[keys.at(-1)] = fn; };
  for (const name of FUNCTIONS) set(name, (...args) => rpc(name, args));
  set('send', (channel, payload) => { emit({type: 'event', channel, payload}); });

  // Buffers travel as files: the core picks both paths, the shell writes the result to outPath.
  const dir = path.join(data, 'temp', 'rpc');
  async function withTemp(buffer, call, after) {
    await fs.promises.mkdir(dir, {recursive: true});
    const name = crypto.randomBytes(12).toString('hex'), input = path.join(dir, name + '.in'), output = path.join(dir, name + '.out');
    try { await fs.promises.writeFile(input, buffer); const value = await call(input, output); return await after(value, output); }
    finally { fs.promises.rm(input, {force: true}).catch(() => {}); fs.promises.rm(output, {force: true}).catch(() => {}); }
  }
  set('image.decodeWebp', buffer => withTemp(buffer, (i, o) => rpc('image.decodeWebp', [i, o]), (_v, o) => fs.promises.readFile(o)));
  set('image.normalize', (buffer, maxSide, quality) => withTemp(buffer, (i, o) => rpc('image.normalize', [i, o, Number.isFinite(maxSide) ? maxSide : null, quality]),
    async (info, o) => info ? {png: await fs.promises.readFile(o), width: info.width, height: info.height, original: info.original} : null));
  set('image.thumbnail', (buffer, maxSide, fit = 'longest') => withTemp(buffer, (i, o) => rpc('image.thumbnail', [i, o, maxSide, fit]), (_v, o) => fs.promises.readFile(o)));

  // The browser webviews (Tauri) reach the web only through the filtering proxy: it starts with the first browser request, and
  // browser.configure tells the shell its address, the realm of its challenge and, in test mode only, the test server's host:port
  // (web.cjs allowTestHost). Requests wait for the proxy in the order they were made (then-callbacks of one promise run in order).
  let proxyStart = null;
  // A proxy that failed to start is not kept: the next browser request tries again.
  const proxyReady = () => {
    if (!webProxy) return null;
    if (!proxyStart) { const start = proxyStart = Promise.resolve().then(webProxy); start.catch(() => { if (proxyStart === start) proxyStart = null; }); }
    return proxyStart;
  };
  const viaProxy = (name, call) => (...args) => { const ready = proxyReady(); return ready ? ready.then(proxy => call(proxy, ...args)) : call(null, ...args); };
  for (const name of FUNCTIONS.filter(n => n.startsWith('browser.') && !CALLBACK_NAMES.includes(n) && n !== 'browser.render')) set(name, viaProxy(name, (proxy, ...args) => rpc(name, args)));
  set('browser.configure', viaProxy('browser.configure', (proxy, settings) => rpc('browser.configure', proxy ? [settings, {proxy: proxy.url, realm: proxy.realm, testHost: require('./web.cjs').allowedTestHost()}] : [settings])));
  // An AbortSignal cannot travel: the shell is told to cancel by request id and the caller is released at once.
  set('browser.render', viaProxy('browser.render', (proxy, url, options = {}) => {
    const signal = options.signal;
    const cancelled = () => Object.assign(Error('Cancelled'), {cancelled: true});
    if (signal?.aborted) return Promise.reject(cancelled());
    const plain = Object.fromEntries(Object.entries(options).filter(([k, v]) => k !== 'signal' && typeof v !== 'function'));
    const request = rpc('browser.render', [url, plain]);
    if (!signal) return request;
    return new Promise((resolve, reject) => {
      const abort = () => { state.pending.delete(request.id); rpc('browser.cancel', [request.id]).catch(() => {}); reject(cancelled()); };
      signal.addEventListener('abort', abort, {once: true});
      request.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }));
  // Callback registrations stay here; the shell is told once (so it starts forwarding) and pushes 'platform-event' messages.
  for (const name of CALLBACK_NAMES) set(name, cb => { state.callbacks[name] = cb; rpc(name, []).catch(() => {}); });
  // A pop-up arrives as {url}; the callback gets the address only when it passes web.cjs checkUrl (Electron: setWindowOpenHandler).
  const popup = cb => payload => { let url; try { url = require('./web.cjs').checkUrl(payload.url).href; } catch { return; } cb(url); };
  state.deliver = (name, payload) => { const cb = state.callbacks[name]; if (cb) (name === 'browser.onPopup' ? popup(cb) : cb)(payload); };
  return {platform, state};
}

function backendDirFor(app) {
  for (const candidate of [path.join(app, 'resources', 'app', 'backend'), path.join(app, 'backend')]) if (fs.existsSync(path.join(candidate, 'lumen-host.exe'))) return candidate;
  return path.join(__dirname, 'backend');
}

// Process-wide guards, installed only when running as the host (not when a test requires this file).
function installProcessGuards() {
  console.log = console.info = console.debug = (...a) => console.error(...a);
  process.on('unhandledRejection', e => console.error('[core-host] unhandled rejection:', e && e.stack || e));
  // A broken stdout pipe means the shell is gone (shut down quietly); any other uncaught exception ends the process with an error.
  process.on('uncaughtException', e => {
    console.error('[core-host] uncaught exception:', e && e.stack || e);
    if (e && e.code === 'EPIPE' && e.syscall === 'write') { if (onShellGone) onShellGone(); else process.exit(0); return; }
    process.exit(1);
  });
}

async function main() {
  installProcessGuards();
  const args = parseArgs(process.argv.slice(2));
  if (!args.data || !args.app) { console.error('usage: node core-host.cjs --data <dir> --app <dir> [--ui-check] [--asset-base <url>] [--update-mode full|check-only] [--version <v>]'); process.exit(2); }
  let proxy = null;
  const webProxy = () => require('./webproxy.cjs').startProxy().then(p => (proxy = p));
  const {platform, state} = createRpcPlatform({data: path.resolve(args.data), assetBase: args.assetBase || 'lumen://app/', appDir: path.resolve(args.app),
    updateMode: args.updateMode === 'check-only' ? 'check-only' : 'full', version: args.version || require('./package.json').version, webProxy});
  const {createCore} = require('./core.cjs');
  const core = createCore({platform, dataDir: path.resolve(args.data), test: args.uiCheck, backendDir: backendDirFor(path.resolve(args.app))});
  let stopping = false;

  // gone: the shell cannot answer any more (stdin ended), so nothing pending or new can settle. An explicit shutdown message
  // leaves the platform working: the core's own stop() may still need the shell.
  async function shutdown(code, gone = false) {
    if (gone) { state.gone = true; for (const p of state.pending.values()) p.reject(Error('The shell is gone.')); state.pending.clear(); }
    if (stopping) return; stopping = true;
    // The engine's shutdown is capped below the shell's grace period; the lock is released inside stop(), before the exit.
    try { await core.stop({cap: STOP_CAP_MS}); } catch (e) { console.error('[core-host] stop failed:', e && e.message); }
    try { await proxy?.stop(); } catch {}
    stdout.write('', () => process.exit(code));
  }

  async function onCall(message) {
    try { const value = await core.call(message.channel, message.args); emit({id: message.id, type: 'result', ok: true, value}); }
    catch (e) { emit({id: message.id, type: 'result', ok: false, error: String(e && e.message || e)}); }
  }

  // The shell's lumen protocol (Tauri: http://lumen.localhost/) asks for one URL path; the core's allowlist and routes decide.
  async function onAsset(message) {
    try {
      const r = await core.asset(message.path);
      const out = {id: message.id, type: 'asset-result', status: r.status, headers: r.headers || {}};
      if (r.body !== undefined) out.body = Buffer.isBuffer(r.body) ? r.body.toString('utf8') : String(r.body);
      else if (r.filePath) out.filePath = r.filePath;
      emit(out);
    } catch (e) { console.error('[core-host] asset failed:', e && e.message); emit({id: message.id, type: 'asset-result', status: 500, headers: {}, body: 'Internal error'}); }
  }

  function onLine(line) {
    let message; try { message = JSON.parse(line); } catch { return emit({type: 'protocol-error', reason: 'invalid-json'}); }
    if (!message || typeof message !== 'object') return emit({type: 'protocol-error', reason: 'invalid-message'});
    if (message.type === 'call') {
      if (typeof message.channel !== 'string') return message.id === undefined ? emit({type: 'protocol-error', reason: 'invalid-message'}) : emit({id: message.id, type: 'result', ok: false, error: 'Invalid call: channel must be a string.'}); if (stopping) return emit({id: message.id, type: 'result', ok: false, error: 'Lumen is shutting down.'}); return void onCall(message); }
    if (message.type === 'shutdown') return void shutdown(0);
    if (message.type === 'asset') { if (message.id === undefined || typeof message.path !== 'string') return emit({type: 'protocol-error', reason: 'invalid-message'}); return void onAsset(message); }
    if (message.type === 'platform-result') {
      const p = state.pending.get(message.id); if (!p) return void console.error('[core-host] platform-result for an unknown request: ' + String(message.id).slice(0, 80)); state.pending.delete(message.id);
      return message.ok ? p.resolve(message.value) : p.reject(Error(String(message.error || 'Platform call failed.')));
    }
    if (message.type === 'platform-event') {
      if (!CALLBACK_NAMES.includes(message.name) || !message.payload || typeof message.payload !== 'object') return; // unknown names and non-object payloads are ignored
      try { state.deliver(message.name, message.payload); } catch (e) { console.error('[core-host] platform event failed:', e && e.message); } return; }
    emit({type: 'protocol-error', reason: 'invalid-message'});
  }

  // Lines are cut from the byte stream by hand so that a huge line is never held in memory: past the limit it is dropped.
  let parts = [], size = 0, dropping = false;
  process.stdin.on('data', chunk => {
    let pos = 0;
    while (pos < chunk.length) {
      const nl = chunk.indexOf(10, pos);
      const end = nl < 0 ? chunk.length : nl, piece = chunk.subarray(pos, end);
      if (!dropping) {
        size += piece.length;
        if (size > LINE_LIMIT) { dropping = true; parts = []; size = 0; emit({type: 'protocol-error', reason: 'too-large'}); }
        else parts.push(piece);
      }
      if (nl < 0) break;
      if (dropping) dropping = false;
      else { const line = Buffer.concat(parts).toString('utf8').replace(/\r$/, ''); parts = []; size = 0; if (line.trim()) onLine(line); }
      pos = nl + 1;
    }
  });
  process.stdin.on('end', () => shutdown(0, true));
  process.stdin.on('error', () => shutdown(0, true));
  onShellGone = () => shutdown(0, true);
  stdout.on('error', e => { if (e.code === 'EPIPE') shutdown(0, true); });

  try { await core.start(); }
  catch (e) { console.error('[core-host] start failed:', e && e.stack || e); try { await core.stop({now: true}); } catch {} const code = /^core\.lock: Lumen is already running/.test(String(e && e.message)) ? EXIT_LOCKED : 1; stdout.write('', () => process.exit(code)); return; }
  emit({type: 'ready', channels: core.channels});
}

if (require.main === module) main().catch(e => { console.error('[core-host] fatal:', e && e.stack || e); process.exit(1); });
module.exports = {createRpcPlatform, EXIT_LOCKED, STOP_CAP_MS};
