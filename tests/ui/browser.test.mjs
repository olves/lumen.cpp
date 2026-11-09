// In-app browser (Task 9): the web panel next to the chat and the hidden JavaScript renderer, on both shells.
//   $env:LUMEN_SHELL='tauri'; node --test tests/ui/browser.test.mjs        (default electron)
// A local test server (127.0.0.1, one random port for HTTP and HTTPS with a self-signed certificate) stands in for the web. It is
// not a public address, so the app is started with LUMEN_TEST_ALLOW_HOST=127.0.0.1:<port>, which only the core's --ui-check test
// hook honours (web.cjs allowTestHost; tests/core prove it has no effect without --ui-check). A second local server (the trap)
// must never be reached: it stands for the user's private network. The panel is a CDP target of its own: Electron lists it next
// to the main window; Tauri's browser webviews have their own WebView2 profile (<data>/webview/browser) and debugging port (port
// 0, written to DevToolsActivePort). The research test needs an installed chat model (tests/ui/data.mjs pickModel).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import dns from 'node:dns';
import { launch, workRoot } from '../harness/launch.mjs';
import { connect } from '../harness/cdp.mjs';
import { pickModel, prepareData } from './data.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `browser-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const model = pickModel();

// ---------- a self-signed certificate for 127.0.0.1 (DER by hand: no npm, no openssl) ----------
function selfSigned() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const len = n => n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]);
  const tlv = (tag, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), len(body.length), body]); };
  const seq = (...p) => tlv(0x30, ...p);
  const oid = text => { const n = text.split('.').map(Number); const out = [40 * n[0] + n[1]]; for (const v of n.slice(2)) { const b = []; let x = v; do { b.unshift(x & 127); x >>= 7; } while (x); for (let i = 0; i < b.length - 1; i++) b[i] |= 128; out.push(...b); } return tlv(0x06, Buffer.from(out)); };
  const time = d => tlv(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
  const name = seq(tlv(0x31, seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from('127.0.0.1')))));
  const alg = seq(oid('1.2.840.113549.1.1.11'), Buffer.from([0x05, 0x00]));
  const san = seq(oid('2.5.29.17'), tlv(0x04, seq(tlv(0x87, Buffer.from([127, 0, 0, 1])))));
  const tbs = seq(tlv(0xa0, tlv(0x02, Buffer.from([2]))), tlv(0x02, Buffer.from([1, ...crypto.randomBytes(8)])), alg, name,
    seq(time(new Date(Date.now() - 86400000)), time(new Date(Date.now() + 7 * 86400000))), name, publicKey.export({ type: 'spki', format: 'der' }), tlv(0xa3, seq(san)));
  const cert = seq(tbs, alg, tlv(0x03, Buffer.from([0]), crypto.sign('sha256', tbs, privateKey)));
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: '-----BEGIN CERTIFICATE-----\n' + cert.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n' };
}

// ---------- the test web ----------
const requests = []; // {path, headers, tls}
const trapHits = [];
let P, Q, base, trap;
const DOWNLOAD = `lumen-test-${crypto.randomBytes(6).toString('hex')}.bin`;
const html = (title, body, script = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}<script>${script}</script></body></html>`;
function route(req, res, tls) {
  const url = new URL(req.url, 'http://x');
  requests.push({ path: url.pathname + url.search, headers: req.headers, tls });
  const page = (title, body, script) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(html(title, body, script)); };
  switch (url.pathname) {
    case '/page1': return page('Page one', '<h1>Birinci sayfa</h1>');
    case '/page2': return page('Page two', '<h1>İkinci sayfa</h1>');
    case '/nav-private': return page('Nav private', '<p>stays</p>', `setTimeout(()=>{location.href='${trap}/navigated'},50)`);
    case '/redirect-private': res.writeHead(302, { location: `${trap}/redirected` }); return res.end();
    case '/subresource': return page('Subresources', `<img src="${trap}/x.png"><img src="/ok.png"><iframe src="${trap}/frame"></iframe><script src="${trap}/x.js"></script>`,
      `fetch('${trap}/fetch').catch(()=>{});fetch('http://[::ffff:127.0.0.1]:${Q}/mapped').catch(()=>{});new Image().src='http://localhost:${Q}/name.png';`);
    case '/ok.png': res.writeHead(200, { 'content-type': 'image/gif' }); return res.end(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'));
    case '/tamper': return page('Tamper', '<p id="t">Gerçek metin</p><button id="b" style="font-size:20px;padding:12px">Gerçek düğme</button>',
      `window.clicks=0;document.getElementById('b').addEventListener('click',e=>{if(e.isTrusted)window.clicks++;document.title='clicked '+window.clicks;});
       Object.defineProperty(HTMLElement.prototype,'innerText',{get(){return 'FAKE'},configurable:true});
       Object.defineProperty(Node.prototype,'textContent',{get(){return 'FAKE'},configurable:true});`);
    case '/click': return page('count 0', '<button id="b" style="font-size:20px;padding:12px;margin:180px 0 0 280px">Count me</button><p>needle one</p><p>needle two</p><p>a needle three</p>',
      `let n=0;document.getElementById('b').addEventListener('click',e=>{if(e.isTrusted){n++;document.title='count '+n;}});`);
    case '/headers': return page('Headers', '<img src="/headers-sub.png">');
    case '/headers-sub.png': res.writeHead(200, { 'content-type': 'image/gif' }); return res.end(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'));
    case '/download-page': return page('Download', '<a id="d" href="/download" style="font-size:20px">Get file</a>');
    case '/download': res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${DOWNLOAD}"` }); return res.end(Buffer.alloc(4096, 7));
    case '/popup-page': return page('Popup', '<a href="/popup-target" target="_blank" style="font-size:20px">Open popup</a>');
    case '/popup-target': return page('Popup target', '<p>came from a pop-up</p>');
    case '/dialogs': return page('Dialogs', '<p>dialogs</p>');
    // A site that sends the proxy's mark itself must not be shown as blocked.
    case '/spoof': res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-lumen-proxy': 'blocked' }); return res.end(html('Spoof', '<p>a normal page</p>'));
    // Privacy headers beyond the page target: a cross-site frame (https inside an http page: another site, so another process)
    // with an image and a worker that fetches.
    case '/xframe': return page('Cross frame', `<iframe src="https://127.0.0.1:${P}/frame-headers"></iframe>`);
    case '/frame-headers': return page('Frame', '<img src="/frame-img.png">', `new Worker('/worker.js');`);
    case '/frame-img.png': res.writeHead(200, { 'content-type': 'image/gif' }); return res.end(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'));
    case '/worker.js': res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(`fetch('/worker-fetch').catch(()=>{});`);
    case '/worker-fetch': res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok');
    // Research: a page whose text exists only after its script runs, and whose page world lies about innerText.
    case '/js': return page('Secret page', '<p>' + 'This page loads its content with a script. '.repeat(4) + '</p><div id="root"></div>',
      `fetch('/js-data').then(r=>r.text()).then(t=>{const p=document.createElement('p');p.textContent=t;document.getElementById('root').append(p);});
       Object.defineProperty(HTMLElement.prototype,'innerText',{get(){return 'FAKE'},configurable:true});`);
    case '/js-data': res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('The secret word is ZEPHYR-4711. ' + 'This paragraph was written by JavaScript after the page loaded. '.repeat(12));
    case '/search': res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ results: [{ title: 'Secret page', url: `${base}/js`, content: 'A page that tells the secret word.' }] }));
    default: res.writeHead(404); return res.end('nope');
  }
}
// One port, HTTP and HTTPS: the first byte of a TLS connection is 0x16.
async function startWeb() {
  const tls = selfSigned();
  const plain = http.createServer((q, s) => route(q, s, false)), secure = https.createServer(tls, (q, s) => route(q, s, true));
  const front = net.createServer(socket => socket.once('readable', () => { const first = socket.read(1); if (!first) return socket.destroy(); socket.unshift(first); (first[0] === 0x16 ? secure : plain).emit('connection', socket); }));
  const trapServer = http.createServer((q, s) => { trapHits.push(q.url); s.writeHead(200, { 'access-control-allow-origin': '*' }); s.end('reached'); });
  await new Promise(r => front.listen(0, '127.0.0.1', r));
  await new Promise(r => trapServer.listen(0, '127.0.0.1', r));
  P = front.address().port; Q = trapServer.address().port;
  base = `http://127.0.0.1:${P}`; trap = `http://127.0.0.1:${Q}`;
  return () => { front.close(); trapServer.close(); plain.close(); secure.close(); };
}

// ---------- the app ----------
let app, stopWeb, panel = null;
const ev = expr => app.cdp.evaluate(expr);
const js = v => JSON.stringify(v);
const open = url => ev(`openBrowser(${js(url)}).then(()=>0)`);
const waitState = (cond, ms = 20000) => app.cdp.waitFor(`(s=>${cond})(browserState)`, ms);
const browser = (action, args = {}) => ev(`window.lumen.browser(${js(action)}, ${js(args)})`);
const hit = p => requests.some(r => r.path === p);
async function loaded(url, ms = 20000) { await waitState(`s.url===${js(url)}&&!s.loading`, ms); }

function panelPort() {
  if (shell === 'electron') return app.port;
  const root = path.join(dataDir, 'webview', 'browser');
  const find = dir => { for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) { const p = path.join(dir, e.name); if (e.isFile() && e.name === 'DevToolsActivePort') return p; if (e.isDirectory()) { const r = find(p); if (r) return r; } } return null; };
  const file = find(root);
  if (!file) throw new Error('no DevToolsActivePort under ' + root);
  return Number(fs.readFileSync(file, 'utf8').split(/\r?\n/)[0]);
}
const pageTargets = async () => (await (await fetch(`http://127.0.0.1:${panelPort()}/json`)).json()).filter(t => t.type === 'page' && t.url.startsWith(base));
async function attachPanel(urlPrefix) {
  panel?.close();
  let last;
  for (let i = 0; i < 100; i++) {
    try { panel = await connect(panelPort(), { target: new RegExp('^' + urlPrefix.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')), timeoutMs: 1000 }); return panel; } catch (e) { last = e; }
    await sleep(150);
  }
  throw new Error('panel target not found: ' + (last && last.message));
}

// Tauri: what a browser webview's page (panel or hidden renderer) can reach of Lumen. Nothing: no bridge, no command, no event
// listening, no Lumen protocol, native script dialogs that never block.
async function assertNoBridge(page, what) {
  const surface = await page.evaluate(`({ global: typeof window.__TAURI__, lumen: typeof window.lumen,
    natives: [alert, confirm, prompt].map(f => Function.prototype.toString.call(f).includes('[native code]')) })`);
  assert.equal(surface.global, 'undefined', what + ': no window.__TAURI__');
  assert.equal(surface.lumen, 'undefined', what + ': no window.lumen');
  assert.deepEqual(surface.natives, [true, true, true], what + ': alert/confirm/prompt are not replaced by a plugin script');
  // Script dialogs never block the page (Electron: disableDialogs).
  const t0 = Date.now();
  assert.equal(await page.evaluate('confirm("x")'), false);
  assert.ok(Date.now() - t0 < 3000, what + ': confirm returned at once');
  const attempt = (cmd, args) => page.evaluate(`(window.__TAURI_INTERNALS__ ? window.__TAURI_INTERNALS__.invoke(${js(cmd)}, ${js(args)}) : Promise.reject(Error('no internals'))).then(v => ({ok: true, v: JSON.stringify(v)}), e => ({ok: false, e: String(e && e.message || e)}))`);
  for (const [cmd, args] of [['lumen_call', { channel: 'preferences', args: [] }], ['lumen_call', { channel: 'browser', args: ['state'] }], ['window_action', { action: 'minimize' }], ['plugin:event|listen', { event: 'lumen-event', target: { kind: 'Any' }, handler: 1 }]]) {
    const r = await attempt(cmd, args);
    assert.equal(r.ok, false, `${what}: ${cmd} must be refused: ${JSON.stringify(r)}`);
  }
  // The Lumen protocols answer these webviews 403.
  for (const url of ['http://lumen.localhost/index.html', 'http://lumen-artifact.localhost/']) {
    const status = await page.evaluate(`fetch(${js(url)}).then(r => r.status, () => 'refused')`);
    assert.ok(status === 403 || status === 'refused', `${what}: ${url}: ${status}`);
  }
}

describe(`browser panel and renderer (${shell})`, () => {
  before(async () => {
    stopWeb = await startWeb();
    prepareData(dataDir, model);
    // Test windows sit off screen. Chromium's native occlusion tracking then marks Electron's WebContentsView hidden and drops its
    // input, so real mouse events never land (test environment only; WebView2 keeps the panel visible). Off for this run.
    app = await launch({ shell, dataDir, env: { LUMEN_TEST_ALLOW_HOST: `127.0.0.1:${P}` }, args: shell === 'electron' ? ['--disable-features=CalculateNativeWinOcclusion'] : [] });
    await app.cdp.waitFor('state.ready === true', 30000);
  });
  after(async () => {
    panel?.close();
    await app?.stop();
    stopWeb?.();
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'requests.json'), JSON.stringify({ requests: requests.map(r => ({ path: r.path, tls: r.tls, gpc: r.headers['sec-gpc'], dnt: r.headers.dnt })), trapHits }, null, 1));
  });

  test('navigates and reports state', async () => {
    await open(`${base}/page1`);
    await loaded(`${base}/page1`);
    await waitState(`s.title==='Page one'&&s.open&&!s.error`);
    await open(`${base}/page2`);
    await loaded(`${base}/page2`);
    await waitState(`s.title==='Page two'&&s.canGoBack&&!s.canGoForward`);
    await browser('back');
    await loaded(`${base}/page1`);
    await waitState(`s.title==='Page one'&&s.canGoForward`);
    await browser('forward');
    await loaded(`${base}/page2`);
    const s = await browser('state');
    assert.equal(s.url, `${base}/page2`);
    assert.equal(s.title, 'Page two');
    assert.equal(s.canGoBack, true);
    assert.equal(s.zoom, 100);
    // The panel sits over the browser viewport of the window.
    await attachPanel(`${base}/page2`);
    assert.equal(await panel.evaluate('document.title'), 'Page two');
    assert.ok(await panel.evaluate('innerWidth') >= 80, 'the panel has the viewport size');
    // The proxy's credentials never reach a web server.
    assert.ok(!requests.some(r => r.headers['proxy-authorization']), 'no Proxy-Authorization reached the server');
    // Tauri: the page came through the core's proxy (it sends every upstream request with Connection: close).
    if (shell === 'tauri') assert.ok(requests.filter(r => r.path === '/page2').every(r => r.headers.connection === 'close'), 'requests came through the proxy');
  });

  test('the panel can be resized by dragging its left edge; double-click returns to the default', async () => {
    const width = () => ev("Math.round(document.getElementById('browser-panel').getBoundingClientRect().width)");
    await app.cdp.waitFor("!!document.querySelector('#browser-panel .browser-resizer')", 5000);
    const before = await width();
    const h = await ev("(() => { const r = document.querySelector('#browser-panel .browser-resizer').getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()");
    const mouse = (type, x) => app.cdp.send('Input.dispatchMouseEvent', { type, x, y: h.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
    await mouse('mousePressed', h.x);
    for (let i = 1; i <= 5; i++) await mouse('mouseMoved', h.x - i * 30);
    await mouse('mouseReleased', h.x - 150);
    await app.cdp.waitFor(`Math.abs(document.getElementById('browser-panel').getBoundingClientRect().width - ${before + 150}) <= 3`, 5000);
    await app.cdp.waitFor('toolsConfig.browser.panelPx > 0', 5000);
    assert.ok(Math.abs((await ev('toolsConfig.browser.panelPx')) - (before + 150)) <= 3, 'the width is saved');
    assert.equal(await ev("document.body.classList.contains('browser-resizing')"), false);
    // The page follows the panel.
    await waitState('s.open && !s.error');
    await panel.waitFor?.(`innerWidth >= ${before + 100}`, 5000);
    // Keyboard: ArrowRight narrows the panel.
    await ev("document.querySelector('#browser-panel .browser-resizer').dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true})); 0");
    await app.cdp.waitFor(`document.getElementById('browser-panel').getBoundingClientRect().width < ${before + 140}`, 5000);
    // Double-click: back to the default width, and the saved width is cleared.
    await ev("document.querySelector('#browser-panel .browser-resizer').dispatchEvent(new MouseEvent('dblclick', {bubbles: true})); 0");
    await app.cdp.waitFor(`Math.abs(document.getElementById('browser-panel').getBoundingClientRect().width - ${before}) <= 3 && !toolsConfig.browser.panelPx`, 5000);
  });

  // WebRTC must not reveal the computer's addresses: with disable_non_proxied_udp no UDP (host/srflx) candidate is gathered.
  test('WebRTC gathers no UDP candidates in the panel', async () => {
    await attachPanel(`${base}/page2`);
    const r = await panel.evaluate(`(async () => {
      const pc = new RTCPeerConnection({ iceServers: [] }); pc.createDataChannel('x');
      const found = []; pc.onicecandidate = e => { if (e.candidate && e.candidate.candidate) found.push(e.candidate.candidate); };
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise(res => { if (pc.iceGatheringState === 'complete') return res(); pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && res(); setTimeout(res, 5000); });
      pc.close(); return found;
    })()`);
    // Electron applies the policy fully. WebView2 (Tauri preview) still gathers an mDNS-obfuscated host candidate (….local),
    // which carries no address; any UDP candidate with a real IP fails on both shells.
    const udp = r.filter(c => / udp /i.test(c));
    if (shell === 'electron') assert.deepEqual(udp, [], 'UDP candidates: ' + JSON.stringify(r));
    else assert.deepEqual(udp.filter(c => !/ [0-9a-f-]{36}\.local /i.test(c)), [], 'UDP candidates with an address: ' + JSON.stringify(r));
  });

  test('blocks private address', async () => {
    // Typed or opened by the core: refused before anything loads, shown as "blocked".
    await open('http://192.168.1.1/');
    await waitState(`!!s.error&&s.error.blocked===true`);
    // A page that navigates itself to a private address stays where it is; a redirect there is not followed.
    await open(`${base}/nav-private`);
    await waitState(`s.url===${js(`${base}/nav-private`)}&&!s.error`);
    await sleep(1500);
    assert.equal((await browser('state')).url, `${base}/nav-private`);
    await open(`${base}/redirect-private`);
    await app.cdp.waitFor(`true`, 1000);
    for (let i = 0; i < 30 && !hit('/redirect-private'); i++) await sleep(100);
    assert.ok(hit('/redirect-private'), 'the redirecting page was requested');
    await sleep(1500);
    assert.deepEqual(trapHits, [], 'nothing reached the private server');
    // A name that passes the address checks but resolves to private addresses (this computer's own name: its LAN and link-local
    // addresses, no internet needed) is refused after DNS (Electron: onBeforeRequest; Tauri: the proxy) and shown as blocked.
    const own = os.hostname().toLowerCase();
    const answers = await dns.promises.lookup(own, { all: true }).catch(() => []);
    if (answers.length) {
      await open(`http://${own}:${Q}/by-name`);
      await waitState(`!!s.error&&s.error.blocked===true&&s.error.code===-20`);
      assert.deepEqual(trapHits, []);
    } else console.log('# the name of this computer does not resolve: DNS step skipped');
  });

  test('blocks private subresource', async () => {
    await open(`${base}/subresource`);
    await loaded(`${base}/subresource`);
    for (let i = 0; i < 50 && !hit('/ok.png'); i++) await sleep(100);
    assert.ok(hit('/ok.png'), 'the allowed image loaded');
    await sleep(2000);
    assert.deepEqual(trapHits, [], 'images, scripts, frames and fetches to private addresses never left');
  });

  test('isolated read resists tampering', async () => {
    await open(`${base}/tamper`);
    await loaded(`${base}/tamper`);
    await attachPanel(`${base}/tamper`);
    assert.equal(await panel.evaluate("document.getElementById('t').innerText"), 'FAKE', 'the page world is tampered');
    const r = await browser('click', { labels: ['Gerçek düğme'] });
    assert.equal(r.status, 'clicked', JSON.stringify(r));
    assert.equal(r.text, 'Gerçek düğme', 'the agent read the real text');
    assert.equal(r.how, 'mouse', 'a real mouse click reached the button');
    await panel.waitFor('window.clicks===1', 5000);
    // Scrolling runs in the isolated world too.
    assert.equal((await browser('scroll', { direction: 'down' })).status, 'scrolled');
  });

  test('click and find', async () => {
    await open(`${base}/click`);
    await loaded(`${base}/click`);
    const r = await browser('click', { labels: ['Count me'] });
    assert.equal(r.status, 'clicked', JSON.stringify(r));
    assert.equal(r.how, 'mouse');
    await waitState(`s.title==='count 1'`, 5000);
    assert.equal(await browser('find', { text: 'needle' }), true);
    await waitState(`!!s.find&&s.find.matches===3&&s.find.active===1`, 10000);
    await browser('find', { text: 'needle', next: true });
    await waitState(`!!s.find&&s.find.matches===3&&s.find.active>=1`, 10000);
    await waitState(`s.find.active===2`, 10000);
    assert.equal(await browser('find-stop'), true);
    await waitState(`s.find===null`, 5000);
    // A real click lands on the button at another zoom too (page coordinates scaled by the zoom factor).
    await browser('zoom', { step: 1 });
    await browser('zoom', { step: 1 });
    await waitState(`s.zoom===125`, 5000);
    const zoomed = await browser('click', { labels: ['Count me'] });
    assert.equal(zoomed.how, 'mouse', JSON.stringify(zoomed));
    await waitState(`s.title==='count 2'`, 5000);
    await browser('zoom', { step: 0 });
    await waitState(`s.zoom===100`, 5000);
  });

  test('privacy headers', async () => {
    const secure = `https://127.0.0.1:${P}/headers`;
    await open(secure);
    await loaded(secure);
    for (let i = 0; i < 50 && !requests.some(r => r.tls && r.path === '/headers-sub.png'); i++) await sleep(100);
    const page = requests.filter(r => r.tls && r.path === '/headers').at(-1), sub = requests.filter(r => r.tls && r.path === '/headers-sub.png').at(-1);
    assert.ok(page && sub, 'the HTTPS page and its image were requested over TLS');
    for (const r of [page, sub]) { assert.equal(r.headers['sec-gpc'], '1', r.path); assert.equal(r.headers.dnt, '1', r.path); }
    await ev(`window.lumen.tools('update', {browser:{privacySignals:false}}).then(()=>0)`);
    const before = requests.length;
    await open(secure + '?off');
    await loaded(secure + '?off');
    for (let i = 0; i < 50 && !requests.slice(before).some(r => r.tls && r.path === '/headers-sub.png'); i++) await sleep(100);
    const off = requests.slice(before).filter(r => r.tls);
    assert.ok(off.length >= 1, 'requested again');
    for (const r of off) { assert.equal(r.headers['sec-gpc'], undefined, r.path); assert.equal(r.headers.dnt, undefined, r.path); }
    await ev(`window.lumen.tools('update', {browser:{privacySignals:true}}).then(()=>0)`);
  });

  test('privacy headers reach cross-site frames and their workers', async () => {
    const before = requests.length;
    const want = ['/frame-headers', '/frame-img.png', '/worker.js', '/worker-fetch'];
    const seen = () => requests.slice(before).filter(r => r.tls && want.includes(r.path));
    await open(`${base}/xframe`);
    await loaded(`${base}/xframe`);
    for (let i = 0; i < 80 && new Set(seen().map(r => r.path)).size < want.length; i++) await sleep(100);
    assert.deepEqual([...new Set(seen().map(r => r.path))].sort(), [...want].sort(), 'the frame, its image, its worker and the worker fetch were requested over TLS');
    for (const r of seen()) { assert.equal(r.headers['sec-gpc'], '1', r.path); assert.equal(r.headers.dnt, '1', r.path); }
  });

  test('a site cannot pose as the proxy', async () => {
    for (const url of [`${base}/spoof`, `https://127.0.0.1:${P}/spoof`]) {
      await open(url);
      await loaded(url);
      await waitState(`s.title==='Spoof'`);
      await sleep(300);
      assert.equal((await browser('state')).error, null, url + ' must not show as blocked');
    }
  });

  test('download denied', async () => {
    await open(`${base}/download-page`);
    await loaded(`${base}/download-page`);
    const r = await browser('click', { labels: ['Get file'] });
    assert.equal(r.status, 'clicked', JSON.stringify(r));
    for (let i = 0; i < 50 && !hit('/download'); i++) await sleep(100);
    await sleep(2500);
    const places = [path.join(os.homedir(), 'Downloads'), dataDir, path.join(dataDir, '..')];
    for (const dir of places) {
      const found = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.startsWith(DOWNLOAD)) : [];
      for (const f of found) fs.rmSync(path.join(dir, f), { force: true });
      assert.deepEqual(found, [], 'no download in ' + dir);
    }
    assert.equal((await browser('state')).url, `${base}/download-page`, 'the panel stays on its page');
  });

  test('popup goes to panel', async () => {
    await open(`${base}/popup-page`);
    await loaded(`${base}/popup-page`);
    const r = await browser('click', { labels: ['Open popup'] });
    assert.equal(r.status, 'clicked', JSON.stringify(r));
    await loaded(`${base}/popup-target`);
    await waitState(`s.title==='Popup target'`);
    await sleep(500);
    const targets = (await pageTargets()).map(t => t.url);
    assert.equal(targets.filter(u => u === `${base}/popup-target`).length, 1, 'no new window: ' + targets.join(' | '));
  });

  test('panel page has no bridge, no commands and native dialogs', { skip: shell !== 'tauri' && 'Tauri only' }, async () => {
    await open(`${base}/dialogs`);
    await loaded(`${base}/dialogs`);
    await attachPanel(`${base}/dialogs`);
    await assertNoBridge(panel, 'panel');
  });

  test('JavaScript setting recreates the panel at the same address', async () => {
    await open(`${base}/click`);
    await loaded(`${base}/click`);
    await ev(`window.lumen.tools('update', {browser:{javascript:false}}).then(()=>0)`);
    await loaded(`${base}/click`);
    await attachPanel(`${base}/click`);
    // The page script never ran: no click listener, so a click changes nothing; the agent's click says scripts are off.
    assert.deepEqual(await browser('click', { labels: ['Count me'] }), { status: 'no-script' });
    await ev(`window.lumen.tools('update', {browser:{javascript:true}}).then(()=>0)`);
    await loaded(`${base}/click`);
    const r = await browser('click', { labels: ['Count me'] });
    assert.equal(r.how, 'mouse', JSON.stringify(r));
    await waitState(`s.title==='count 1'`, 5000);
  });

  test('clearing browsing data removes cookies', async () => {
    await open(`${base}/page1`);
    await loaded(`${base}/page1`);
    await attachPanel(`${base}/page1`);
    await panel.evaluate(`document.cookie='lumen_test=1; max-age=3600'; localStorage.setItem('k','v'); 0`);
    assert.match(await panel.evaluate('document.cookie'), /lumen_test=1/);
    assert.equal(await ev(`window.lumen.tools('clear-browser')`), true);
    await waitState('!s.open', 5000).catch(() => {});
    await open(`${base}/page1`);
    await loaded(`${base}/page1`);
    await attachPanel(`${base}/page1`);
    assert.equal(await panel.evaluate('document.cookie'), '');
    assert.equal(await panel.evaluate(`localStorage.getItem('k')`), null);
  });

  test('research renders a JS page', { skip: !model && 'no installed model', timeout: 600000 }, async () => {
    await ev(`window.lumen.tools('update', {agent:{maxSubtasks:1,maxToolCalls:2}, search:{enabled:true, provider:'searxng', endpoint:${js(base + '/')}}, browser:{render:true}}).then(()=>0)`);
    await ev(`(window.__agentEvents=[], window.lumen.onChannel('agent-event', e => window.__agentEvents.push(e)), 0)`);
    const before = requests.length;
    const rendered = () => ev(`window.__agentEvents.some(e => e.type==='task' && (e.task.ops||[]).some(o => o.kind==='read' && o.status==='done' && o.detail==='rendered'))`);
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      await ev(`(loadToolsConfig ? loadToolsConfig() : Promise.resolve()).then(()=>{researchMode=true;renderToolChips();return 0;})`);
      await app.cdp.type('#prompt', `Read the page ${base}/js and tell me the secret word written on it.`);
      await app.cdp.click('#send');
      await app.cdp.waitFor('state.busy === true', 30000).catch(() => {});
      await app.cdp.waitFor('state.busy === false', 540000);
      ok = await rendered();
      console.log(`# research attempt ${attempt + 1}: ${ok ? 'page rendered' : 'the model did not read the page'}`);
    }
    assert.ok(ok, 'a read_page op finished with the hidden renderer: ' + JSON.stringify(await ev(`window.__agentEvents.filter(e=>e.type==='task').map(e=>e.task.ops)`)));
    const later = requests.slice(before).map(r => r.path);
    assert.ok(later.filter(p => p === '/js').length >= 2, 'the reader and the renderer both loaded /js: ' + later.join(' '));
    assert.ok(later.includes('/js-data'), 'the page script ran in the renderer');
    // 'rendered' means the renderer's text was longer than the reader's (about 180 characters of static text): the page world's
    // innerText says FAKE, so the isolated world read the real text.
    const read = await ev(`window.__agentEvents.filter(e=>e.type==='task').flatMap(e=>e.task.ops).find(o=>o.detail==='rendered')`);
    assert.ok(read.url.startsWith(`${base}/js`), JSON.stringify(read));
    assert.deepEqual(trapHits, []);
    const reply = await ev("[...document.querySelectorAll('.message.assistant')].at(-1)?.textContent || ''");
    console.log('# the model ' + (/ZEPHYR-4711/i.test(reply) ? 'quoted' : 'did not quote') + ' the secret word');
  });

  // The hidden renderer stays for a minute after a render, still showing the page it read: the same checks as the panel.
  test('renderer page has no bridge, no commands and native dialogs', { skip: (shell !== 'tauri' && 'Tauri only') || (!model && 'no installed model') }, async () => {
    const renderer = await connect(panelPort(), { target: new RegExp('^' + `${base}/js`.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')), timeoutMs: 10000 });
    try {
      assert.equal(await renderer.evaluate('document.title'), 'Secret page');
      assert.equal((await browser('state')).url === `${base}/js`, false, 'this target is the renderer, not the panel');
      await assertNoBridge(renderer, 'renderer');
    } finally { renderer.close(); }
  });

  // Electron (unchanged, noted in the task report): its hidden renderer window, alive for a minute after the last render, keeps
  // window-all-closed from firing, so Electron quits only when that window goes. Tauri quits at once.
  test('the window closes with the panel open', { timeout: 120000 }, async () => {
    await open(`${base}/page1`);
    await loaded(`${base}/page1`);
    const exited = new Promise(resolve => { if (app.process.exitCode !== null) resolve(app.process.exitCode); app.process.once('exit', code => resolve(code)); });
    await ev("window.lumen.window('close'); 0").catch(() => {});
    const t0 = Date.now();
    const code = await Promise.race([exited, sleep(shell === 'electron' ? 90000 : 20000).then(() => 'still running')]);
    console.log('# quit after ' + (Date.now() - t0) + ' ms');
    assert.equal(code, 0, 'the title bar close quits Lumen');
  });
});
