// Artifact preview window (Task 7): a Preview of an html/svg code block opens a sandboxed, offline window of its own.
// Runs on both shells: LUMEN_SHELL=electron|tauri (default electron).
//   $env:LUMEN_SHELL='tauri'; node --test tests/ui/artifact.test.mjs
// The artifact window is a second CDP target: Electron lists it next to the main window (lumen-artifact://<32hex>/); in Tauri it
// is a WebView2 of its own profile (<data>/webview/artifact) with a debugging port of its own (port 0, written to DevToolsActivePort),
// at http://lumen-artifact.localhost/<32hex>/. A local HTTP server (127.0.0.1, random port) proves that no request leaves the page.
// No model is needed: the conversation is seeded. Test data goes to <work>/ui-tests/artifact-<shell>-<run>.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { launch, workRoot } from '../harness/launch.mjs';
import { connect } from '../harness/cdp.mjs';
import { prepareData } from './data.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `artifact-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data');
const CHAT_ID = crypto.randomBytes(16).toString('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ARTIFACT_URL = shell === 'tauri' ? /^http:\/\/lumen-artifact\.localhost\/[0-9a-f]{32}\/$/ : /^lumen-artifact:\/\/[0-9a-f]{32}\/$/;
const MAIN_URL = shell === 'tauri' ? /^http:\/\/lumen\.localhost\// : /^lumen:\/\/app\//;

// ---------- a local server that must never be reached ----------
const hits = [];
const server = http.createServer((req, res) => { hits.push(`${req.method} ${req.url}`); res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }); res.end('reached'); });
let serverPort;

// ---------- PNG pixel (screenshots of the window) ----------
function pixel(png, x, y) {
  let pos = 8, width, height, depth, type; const idat = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos), name = png.toString('ascii', pos + 4, pos + 8), data = png.subarray(pos + 8, pos + 8 + len);
    if (name === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; }
    if (name === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  assert.equal(depth, 8); assert.ok(type === 2 || type === 6, 'RGB(A)');
  const bpp = type === 6 ? 4 : 3, stride = width * bpp, raw = zlib.inflateSync(Buffer.concat(idat));
  let prev = Buffer.alloc(stride);
  for (let row = 0; row <= y; row++) {
    const filter = raw[row * (stride + 1)], line = Buffer.from(raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      line[i] = (line[i] + (filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : (pa <= pb && pa <= pc ? a : pb <= pc ? b : c))) & 255;
    }
    prev = line;
  }
  return [prev[x * bpp], prev[x * bpp + 1], prev[x * bpp + 2]];
}

// ---------- top-level window titles (user32), independent of the shell ----------
function windowTitles(file) {
  fs.writeFileSync(file, `[Console]::OutputEncoding=[Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class Wnd { public delegate bool P(IntPtr h, IntPtr l);
 [DllImport("user32.dll")] static extern bool EnumWindows(P p, IntPtr l);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 public static List<string> Titles() { var r = new List<string>(); EnumWindows((h, l) => { if (IsWindowVisible(h)) { var s = new StringBuilder(256); GetWindowText(h, s, 256); if (s.Length > 0) r.Add(s.ToString()); } return true; }, IntPtr.Zero); return r; } }
"@
[Wnd]::Titles() | ForEach-Object { $_ }
`, 'utf8');
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
}

// ---------- the artifact target ----------
let app, art = null, activeDataDir = dataDir;
const listTargets = async port => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter(t => t.type === 'page' && ARTIFACT_URL.test(t.url));
function artifactPort() {
  if (shell === 'electron') return app.port;
  // Chromium writes the port of --remote-debugging-port=0 into the profile folder.
  const root = path.join(activeDataDir, 'webview', 'artifact');
  const find = dir => { for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) { const p = path.join(dir, e.name); if (e.isFile() && e.name === 'DevToolsActivePort') return p; if (e.isDirectory()) { const r = find(p); if (r) return r; } } return null; };
  const file = find(root);
  assert.ok(file, 'DevToolsActivePort of the artifact profile under ' + root);
  return Number(fs.readFileSync(file, 'utf8').split(/\r?\n/)[0]);
}
async function artifactTargets() {
  let last;
  for (let i = 0; i < 100; i++) {
    try { const t = await listTargets(artifactPort()); if (t.length) return t; } catch (e) { last = e; }
    await sleep(150);
  }
  throw new Error('no artifact target' + (last ? ': ' + last.message : ''));
}
async function openPreview(code, kind = 'html', title = '') {
  const r = await app.cdp.evaluate(`window.lumen.artifact('open', ${JSON.stringify({ code, kind, title })})`);
  assert.deepEqual(r, { open: true });
  const targets = await artifactTargets();
  assert.equal(targets.length, 1, 'exactly one artifact window');
  return targets[0];
}
async function attach(target = null) {
  art?.close();
  art = await connect(artifactPort(), { target: ARTIFACT_URL, timeoutMs: 15000 });
  await art.waitFor("document.readyState==='complete'", 15000);
  return art;
}
async function titled(title) {
  let titles = [];
  for (let i = 0; i < 20; i++) { titles = windowTitles(path.join(runDir, 'titles.ps1')); if (titles.includes(title)) return; await sleep(200); }
  assert.fail('window title ' + title + ' not among: ' + titles.join(' | '));
}
const html = (body, script = '') => `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>${body}<script>${script}</script></body></html>`;

describe(`artifact preview (${shell})`, () => {
  before(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    serverPort = server.address().port;
    prepareData(dataDir, null);
    fs.mkdirSync(path.join(dataDir, 'chats'), { recursive: true });
    const reply = 'Here is a page:\n\n```html\n<!doctype html><html><body><h1 id="hello">Merhaba artifact</h1><p>ğüşiöç İı</p></body></html>\n```\n';
    const chat = { Id: CHAT_ID, Title: 'Preview chat ' + CHAT_ID.slice(0, 6), Model: 'Test model', SystemPrompt: '', Updated: new Date().toISOString(),
      Messages: [{ Role: 'user', Content: 'page', Interrupted: false }, { Role: 'assistant', Content: reply, Interrupted: false }] };
    fs.writeFileSync(path.join(dataDir, 'chats', CHAT_ID + '.json'), '﻿' + JSON.stringify(chat), 'utf8');
    app = await launch({ shell, dataDir });
    await app.cdp.waitFor('state.ready === true', 30000);
    await app.cdp.waitFor(`[...document.querySelectorAll('#history .history-item')].some(b => b.title === ${JSON.stringify(chat.Title)})`, 15000);
    await app.cdp.evaluate(`[...document.querySelectorAll('#history .history-item')].find(b => b.title === ${JSON.stringify(chat.Title)}).click(); 0`);
    await app.cdp.waitFor(`state.chat?.Id === '${CHAT_ID}' && !!document.querySelector('.code-preview')`, 15000);
  });
  after(async () => {
    art?.close();
    await app?.stop();
    server.close();
    fs.mkdirSync(runDir, { recursive: true });
  });

  test('Preview button opens an HTML page on a white background', async () => {
    const mainUrl = await app.cdp.evaluate('location.href');
    await app.cdp.click('.code-preview');
    const target = await artifactTargets().then(t => t[0]);
    assert.match(target.url, ARTIFACT_URL);
    await attach();
    assert.equal(await art.evaluate("document.getElementById('hello')?.textContent"), 'Merhaba artifact');
    assert.equal(await art.evaluate("document.body.textContent.includes('ğüşiöç İı')"), true);
    const shot = await art.send('Page.captureScreenshot', { format: 'png' });
    const png = Buffer.from(shot.data, 'base64');
    fs.mkdirSync(runDir, { recursive: true }); fs.writeFileSync(path.join(runDir, 'html.png'), png);
    assert.deepEqual(pixel(png, png.readUInt32BE(16) - 3, png.readUInt32BE(20) - 3), [255, 255, 255], 'white background');
    // The main window stayed where it was.
    assert.equal(await app.cdp.evaluate('location.href'), mainUrl);
    assert.match(mainUrl, MAIN_URL);
    // The window title is "<chat title> · preview".
    const titles = windowTitles(path.join(runDir, 'titles.ps1'));
    assert.ok(titles.some(t => t === `Preview chat ${CHAT_ID.slice(0, 6)} · preview`), 'window titles: ' + titles.filter(t => /preview/i.test(t)).join(' | '));
  });

  test('a dark SVG gets the dark background', async () => {
    const before = await artifactTargets().then(t => t[0]);
    await openPreview('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="10" fill="red"/></svg>', 'svg', '');
    await attach();
    await art.waitFor("!!document.querySelector('svg')", 10000);
    await sleep(300);
    const png = Buffer.from((await art.send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
    fs.writeFileSync(path.join(runDir, 'svg.png'), png);
    assert.deepEqual(pixel(png, 4, 4), [0x1c, 0x1c, 0x1b], 'dark background');
    await titled('SVG · preview');
    assert.equal((await artifactTargets()).length, 1);
    assert.equal(before.id, (await artifactTargets())[0].id, 'same window reused');
  });

  test('a second preview reuses the same window', async () => {
    const first = (await artifactTargets())[0];
    await openPreview(html('<h1 id="second">Second page</h1>'), 'html', 'Second');
    await art.waitFor("document.getElementById('second')?.textContent === 'Second page'", 10000);
    const targets = await artifactTargets();
    assert.equal(targets.length, 1);
    assert.equal(targets[0].id, first.id, 'same target');
    assert.notEqual(targets[0].url, first.url, 'a new document under a new address');
    assert.equal(await art.evaluate("document.querySelector('svg')"), null, 'the previous page is gone');
    // The window title follows the document's <title> (Electron: the page title wins over the name set at open); a page without a
    // <title> keeps "<name> · preview".
    await titled('t');
    await openPreview(html('<h1 id="third">Third</h1>').replace('<title>t</title>', '<title>Doc title ğ</title>'), 'html', 'Third');
    await art.waitFor("document.getElementById('third')", 10000);
    await titled('Doc title ğ');
    await openPreview(html('<h1 id="fourth">Fourth</h1>').replace('<title>t</title>', ''), 'html', 'Fourth');
    await art.waitFor("document.getElementById('fourth')", 10000);
    await titled('Fourth · preview');
  });

  test('nothing leaves the page: no request reaches a local server', async () => {
    hits.length = 0;
    const base = `http://127.0.0.1:${serverPort}`;
    const script = `
const R = window.__R = {}, base = ${JSON.stringify(base)};
const timeout = p => Promise.race([p, new Promise(r => setTimeout(() => r('timeout'), 2500))]);
const tries = [
  ['fetch', () => fetch(base + '/fetch').then(() => 'LOADED', () => 'blocked')],
  ['fetch-example', () => fetch('https://example.com/').then(() => 'LOADED', () => 'blocked')],
  ['xhr', () => new Promise(r => { const x = new XMLHttpRequest(); x.open('GET', base + '/xhr'); x.onload = () => r('LOADED'); x.onerror = () => r('blocked'); x.send(); })],
  ['img', () => new Promise(r => { const i = new Image(); i.onload = () => r('LOADED'); i.onerror = () => r('blocked'); i.src = base + '/img.png'; })],
  ['script', () => new Promise(r => { const s = document.createElement('script'); s.onload = () => r('LOADED'); s.onerror = () => r('blocked'); s.src = base + '/s.js'; document.head.appendChild(s); })],
  ['style', () => new Promise(r => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.onload = () => r('LOADED'); l.onerror = () => r('blocked'); l.href = base + '/s.css'; document.head.appendChild(l); })],
  ['iframe', () => new Promise(r => { const f = document.createElement('iframe'); f.onload = () => r('loaded-frame'); f.onerror = () => r('blocked'); f.src = base + '/frame'; document.body.appendChild(f); })],
  ['beacon', () => String(navigator.sendBeacon(base + '/beacon', 'x'))],
  ['websocket', () => new Promise(r => { try { const w = new WebSocket('ws://127.0.0.1:${serverPort}/ws'); w.onopen = () => r('LOADED'); w.onerror = () => r('blocked'); } catch (e) { r('blocked'); } })],
  ['open', () => String(window.open(base + '/open'))],
];
(async () => {
  for (const [name, f] of tries) { try { R[name] = await timeout(Promise.resolve(f())); } catch (e) { R[name] = 'error:' + e.message; } }
  const f = document.createElement('form'); f.method = 'post'; f.action = base + '/form'; document.body.appendChild(f); f.submit();
  setTimeout(() => { R.done = true; location.href = base + '/location'; setTimeout(() => { R.done2 = true; }, 400); }, 400);
})();`;
    await openPreview(html('<h1 id="net">network</h1>', script), 'html', 'Network');
    await art.waitFor("document.getElementById('net')?.textContent === 'network' && !!window.__R", 10000);
    const href = await art.evaluate('location.href');
    await art.waitFor('window.__R && window.__R.done2 === true', 30000);
    await sleep(1500);
    const results = await art.evaluate('window.__R');
    fs.writeFileSync(path.join(runDir, 'network-results.json'), JSON.stringify({ results, hits }, null, 2));
    assert.deepEqual(hits, [], 'the local server saw: ' + hits.join(', '));
    for (const k of ['fetch', 'fetch-example', 'xhr', 'img', 'script', 'style', 'websocket']) assert.notEqual(results[k], 'LOADED', `${k}: ${results[k]}`);
    // (a frame refused by the CSP still fires load with an error page; only the server log proves what was fetched)
    assert.ok(results.open === 'null', 'window.open returned ' + results.open);
    assert.equal(await art.evaluate('location.href'), href, 'the page did not navigate away');
    assert.equal(await art.evaluate("document.getElementById('net')?.textContent"), 'network', 'the original document is still shown (not replaced by an error page)');
    assert.match(await app.cdp.evaluate('location.href'), MAIN_URL, 'the main window did not navigate');
    assert.equal((await artifactTargets()).length, 1, 'no extra window');
  });

  // The CSP is the first line; the request filter (Electron: webRequest, Tauri: WebResourceRequested) is the second. With the CSP
  // switched off from the debugger the filter alone must still stop every request.
  test('the request filter holds without the CSP', async () => {
    hits.length = 0;
    const base = `http://127.0.0.1:${serverPort}`;
    await art.send('Page.setBypassCSP', { enabled: true });
    try {
      const script = `
const R = window.__R = {}, base = ${JSON.stringify(base)};
const timeout = p => Promise.race([p, new Promise(r => setTimeout(() => r('timeout'), 2500))]);
const load = (tag, attr, url) => new Promise(r => { const e = document.createElement(tag); e.onload = () => r('LOADED'); e.onerror = () => r('blocked'); e[attr] = url; document.head.appendChild(e); });
(async () => {
  R.fetch = await timeout(fetch(base + '/nocsp-fetch').then(() => 'LOADED', () => 'blocked'));
  R.img = await timeout(load('img', 'src', base + '/nocsp.png'));
  R.script = await timeout(load('script', 'src', base + '/nocsp.js'));
  R.worker = await timeout(new Promise(r => { try { const w = new Worker(URL.createObjectURL(new Blob(['fetch(' + JSON.stringify(base + '/worker-fetch') + ').then(() => postMessage("LOADED"), () => postMessage("blocked"))'], { type: 'text/javascript' }))); w.onmessage = e => r(e.data); w.onerror = () => r('error'); } catch (e) { r('error:' + e.message); } }));
  R.shared = await timeout(new Promise(r => { try { const w = new SharedWorker(URL.createObjectURL(new Blob(['onconnect = e => { const p = e.ports[0]; fetch(' + JSON.stringify(base + '/shared-fetch') + ').then(() => p.postMessage("LOADED"), () => p.postMessage("blocked")); };'], { type: 'text/javascript' }))); w.port.onmessage = e => r(e.data); w.onerror = () => r('error'); } catch (e) { r('error:' + e.message); } }));
  R.favicon = await timeout(fetch('/favicon.ico').then(r => 'status ' + r.status, () => 'blocked'));
  R.done = true;
})();`;
      await openPreview(html('<h1 id="nocsp">nocsp</h1>', script), 'html', 'No CSP');
      await art.waitFor('window.__R && window.__R.done === true', 20000);
      const results = await art.evaluate('window.__R');
      fs.writeFileSync(path.join(runDir, 'nocsp-results.json'), JSON.stringify({ results, hits }, null, 2));
      assert.deepEqual(hits, [], 'the local server saw: ' + hits.join(', '));
      for (const k of ['fetch', 'img', 'script', 'worker', 'shared']) assert.notEqual(results[k], 'LOADED', k);
      for (const k of ['worker', 'shared']) assert.equal(results[k], 'blocked', `${k} ran and its fetch was refused`);
      assert.notEqual(results.favicon, 'status 200');
    } finally {
      await art.send('Page.setBypassCSP', { enabled: false });
    }
  });

  test('no bridge: window.lumen is undefined, the core cannot be reached', async () => {
    await openPreview(html('<h1 id="iso">iso</h1>'), 'html', 'Isolation');
    await art.waitFor("document.getElementById('iso')?.textContent === 'iso'", 10000);
    assert.equal(await art.evaluate("typeof window.lumen"), 'undefined');
    assert.equal(await art.evaluate("typeof require + typeof process + typeof Buffer"), 'undefinedundefinedundefined');
    if (shell === 'electron') return;
    // Tauri injects __TAURI_INTERNALS__ into every webview; what it can do is decided by the ACL and the command handlers.
    const surface = await art.evaluate(`({
      internals: typeof window.__TAURI_INTERNALS__, global: typeof window.__TAURI__,
      keys: Object.keys(window.__TAURI_INTERNALS__ || {}).sort(), globalKeys: Object.keys(window.__TAURI__ || {}).sort(),
      label: window.__TAURI_INTERNALS__?.metadata?.currentWebview?.label })`);
    fs.writeFileSync(path.join(runDir, 'tauri-surface.json'), JSON.stringify(surface, null, 2));
    assert.equal(surface.label, 'artifact');
    assert.equal(surface.global, 'undefined', 'no window.__TAURI__ (withGlobalTauri is off)');
    const attempt = cmd => art.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd[0])}, ${JSON.stringify(cmd[1] || {})}).then(v => ({ok: true, v: JSON.stringify(v)}), e => ({ok: false, e: String(e && e.message || e)}))`);
    const outcomes = {};
    for (const cmd of [['lumen_call', { channel: 'preferences', args: [] }], ['lumen_call', { channel: 'artifact', args: ['close'] }], ['window_action', { action: 'minimize' }], ['window_action', { action: 'close' }],
      ['plugin:event|listen', { event: 'lumen-event', target: { kind: 'Any' }, handler: 1 }], ['plugin:window|close', { label: 'main' }], ['plugin:window|minimize', { label: 'main' }], ['plugin:webview|webview_close', { label: 'main' }], ['plugin:app|version'], ['plugin:path|resolve_directory', { directory: 13 }]]) {
      const r = await attempt(cmd);
      outcomes[cmd[0] + ' ' + JSON.stringify(cmd[1] || {})] = r;
      assert.equal(r.ok, false, `${cmd[0]} was allowed: ${JSON.stringify(r)}`);
    }
    fs.writeFileSync(path.join(runDir, 'tauri-outcomes.json'), JSON.stringify(outcomes, null, 2));
    // ...and the main window is still there and not minimized or closed.
    assert.equal(await app.cdp.evaluate("document.visibilityState !== undefined && typeof state.ready"), 'boolean');
    assert.equal(await app.cdp.evaluate("window.lumen.preferences().then(p => typeof p)"), 'object');
    // The core answers only the main window: an IPC from the artifact page via the event system also fails (listen above).
    assert.equal(await art.evaluate("location.href.startsWith('http://lumen-artifact.localhost/')"), true);
  });

  test('dialogs are the browser\'s own and never block; permissions are denied', async () => {
    const r = await art.evaluate(`({alert: String(window.alert), confirm: String(window.confirm), prompt: String(window.prompt), async: window.confirm.constructor.name})`);
    assert.match(r.alert, /\[native code\]/); assert.match(r.confirm, /\[native code\]/); assert.match(r.prompt, /\[native code\]/);
    assert.equal(r.async, 'Function');
    // They return at once (no dialog waits for a click).
    const answers = await Promise.race([art.evaluate("({a: String(alert('x')), c: confirm('x'), p: (() => { try { return prompt('x'); } catch (e) { return null; } })()})"), sleep(8000).then(() => 'stuck')]);
    assert.notEqual(answers, 'stuck', 'a script dialog blocked the page');
    assert.equal(answers.c, false);
    assert.equal(answers.p, null);
    const geo = await art.evaluate("new Promise(res => navigator.geolocation.getCurrentPosition(() => res('granted'), e => res('code ' + e.code), {timeout: 5000}))");
    assert.notEqual(geo, 'granted');
    const notification = await art.evaluate("Notification.requestPermission().then(p => p)");
    assert.notEqual(notification, 'granted');
    const media = await art.evaluate("navigator.mediaDevices.getUserMedia({video: true}).then(() => 'granted', e => e.name)");
    assert.notEqual(media, 'granted');
  });

  test('downloads are refused', async () => {
    const name = 'lumen-artifact-test-' + crypto.randomBytes(5).toString('hex') + '.txt';
    const downloads = path.join(os.homedir(), 'Downloads');
    await art.evaluate(`(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['x'])); a.download = ${JSON.stringify(name)}; document.body.appendChild(a); a.click(); const b = document.createElement('a'); b.href = 'data:text/plain,hello'; b.download = ${JSON.stringify(name)}; document.body.appendChild(b); b.click(); return 0; })()`);
    await sleep(1500);
    assert.equal(fs.existsSync(path.join(downloads, name)), false, 'no file in Downloads');
    assert.equal((await artifactTargets()).length, 1);
  });

  test('close ends the window', async () => {
    assert.equal(await app.cdp.evaluate("window.lumen.artifact('close')"), true);
    let gone = false;
    for (let i = 0; i < 50 && !gone; i++) { await sleep(150); try { gone = (await listTargets(artifactPort())).length === 0; } catch { gone = shell === 'tauri'; } }
    assert.ok(gone, 'the artifact target closed');
    assert.ok(!windowTitles(path.join(runDir, 'titles.ps1')).some(t => /· preview$/.test(t)), 'no preview window left');
    // The main window is untouched, and a new preview opens again.
    assert.match(await app.cdp.evaluate('location.href'), MAIN_URL);
    await openPreview(html('<h1 id="again">again</h1>'), 'html', 'Again');
    await attach();
    await art.waitFor("document.getElementById('again')?.textContent === 'again'", 10000);
    assert.equal(await app.cdp.evaluate("window.lumen.artifact('close')"), true);
  });
});

// The very first document of a freshly created window (not a reused one) must already be guarded. In Tauri the shell serves it
// without its CSP header here (LUMEN_ARTIFACT_NO_CSP=1, --ui-check builds only), so the WebView2 request filter works alone; a
// document that records securitypolicyviolation events proves that the CSP did not do the blocking.
describe(`artifact first document (${shell})`, () => {
  const dir = path.join(runDir, 'first');
  let first;
  after(async () => { art?.close(); art = null; await first?.stop(); server.close(); server.closeAllConnections?.(); });
  test('a new window blocks every request on its first document', async () => {
    hits.length = 0;
    if (!serverPort || !server.listening) { await new Promise(r => server.listen(0, '127.0.0.1', r)); serverPort = server.address().port; }
    prepareData(path.join(dir, 'data'), null);
    first = await launch({ shell, dataDir: path.join(dir, 'data'), env: { LUMEN_ARTIFACT_NO_CSP: '1' } });
    app = first; activeDataDir = path.join(dir, 'data');
    await first.cdp.waitFor('state.ready === true', 30000);
    const base = `http://127.0.0.1:${serverPort}`;
    const script = `
const R = window.__R = { violations: 0 }, base = ${JSON.stringify(base)};
document.addEventListener('securitypolicyviolation', () => R.violations++);
const timeout = p => Promise.race([p, new Promise(r => setTimeout(() => r('timeout'), 3000))]);
const load = (tag, attr, url) => new Promise(r => { const e = document.createElement(tag); e.onload = () => r('LOADED'); e.onerror = () => r('blocked'); e[attr] = url; document.head.appendChild(e); });
(async () => {
  R.fetch = await timeout(fetch(base + '/first-fetch').then(() => 'LOADED', () => 'blocked'));
  R.img = await timeout(load('img', 'src', base + '/first.png'));
  R.script = await timeout(load('script', 'src', base + '/first.js'));
  R.done = true;
})();`;
    const r = await first.cdp.evaluate(`window.lumen.artifact('open', ${JSON.stringify({ code: html('<h1 id="first">first</h1>', script), kind: 'html', title: 'First' })})`);
    assert.deepEqual(r, { open: true });
    await artifactTargets();
    await attach();
    await art.waitFor('window.__R && window.__R.done === true', 20000);
    const results = await art.evaluate('window.__R');
    fs.writeFileSync(path.join(runDir, 'first-results.json'), JSON.stringify({ results, hits }, null, 2));
    assert.deepEqual(hits, [], 'the local server saw: ' + hits.join(', '));
    for (const k of ['fetch', 'img', 'script']) assert.equal(results[k], 'blocked', k);
    if (shell === 'tauri') assert.equal(results.violations, 0, 'no CSP in this run: the request filter did the blocking');
  });
});

// Fail closed (Tauri; the seam exists only in --ui-check builds): when the request filter cannot be installed, the open fails, the
// window is destroyed and the NEXT open builds a fresh, guarded window instead of loading into an unguarded one.
describe(`artifact fails closed (${shell})`, { skip: shell !== 'tauri' }, () => {
  const dir = path.join(runDir, 'failclosed');
  let started;
  after(async () => { art?.close(); art = null; await started?.stop(); server.close(); server.closeAllConnections?.(); });
  test('a failed hardening leaves no window and the next open rebuilds', async () => {
    hits.length = 0;
    if (!server.listening) { await new Promise(r => server.listen(0, '127.0.0.1', r)); serverPort = server.address().port; }
    prepareData(path.join(dir, 'data'), null);
    started = await launch({ shell, dataDir: path.join(dir, 'data'), env: { LUMEN_ARTIFACT_FAIL_HARDEN: '1', LUMEN_ARTIFACT_NO_CSP: '1' } });
    app = started; activeDataDir = path.join(dir, 'data');
    await started.cdp.waitFor('state.ready === true', 30000);
    const open = code => started.cdp.evaluate(`window.lumen.artifact('open', ${JSON.stringify({ code, kind: 'html', title: 'Fail' })}).then(() => 'opened', e => 'rejected: ' + e.message)`);
    const first = await open(html('<h1>never</h1>'));
    assert.match(first, /^rejected: .*protected/, first);
    assert.ok(!windowTitles(path.join(runDir, 'titles.ps1')).some(x => /· preview$/.test(x)), 'the unguarded window was destroyed');
    const base = `http://127.0.0.1:${serverPort}`;
    const script = `
const R = window.__R = { violations: 0 }, base = ${JSON.stringify(base)};
document.addEventListener('securitypolicyviolation', () => R.violations++);
(async () => {
  R.fetch = await fetch(base + '/after-failure').then(() => 'LOADED', () => 'blocked');
  R.done = true;
})();`;
    assert.equal(await open(html('<h1 id="ok">second</h1>', script)), 'opened');
    await artifactTargets();
    await attach();
    await art.waitFor('window.__R && window.__R.done === true', 20000);
    const results = await art.evaluate('window.__R');
    assert.equal(results.fetch, 'blocked');
    assert.equal(results.violations, 0, 'no CSP in this run: the request filter did the blocking');
    assert.deepEqual(hits, []);
    assert.equal(await art.evaluate("document.getElementById('ok')?.textContent"), 'second');
  });
});
