// Core host tests: app/core-host.cjs run as a real child process, driven by a fake shell over stdin/stdout (newline-delimited JSON).
//   node --test "tests/core/*.test.mjs"
// The core needs lumen-host.exe for start(): --app points at <work>/electron-dev, whose resources/app/backend holds the compiled
// host. Test data goes to <work>/core-host-tests/<run>; no model, engine download or network is used.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const hostScript = path.join(repoRoot, 'app', 'core-host.cjs');
const appRoot = path.join(repoRoot, '..', 'work', 'electron-dev');
const runDir = path.join(repoRoot, '..', 'work', 'core-host-tests', new Date().toISOString().replace(/[:.]/g, '-'));
let counter = 0;
const freshDir = name => { const dir = path.join(runDir, name + '-' + (++counter)); fs.mkdirSync(dir, { recursive: true }); return dir; };

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function hostPidOf(parentPid) {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${parentPid} and Name='lumen-host.exe'" | Select-Object -First 1).ProcessId`], { encoding: 'utf8' });
  return Number(String(r.stdout).trim()) || 0;
}

// The fake shell: starts core-host.cjs, answers 'platform' requests, collects events and results.
class FakeShell {
  constructor(extra = [], prepare = null) {
    this.dataDir = freshDir('data');
    if (prepare) prepare(this.dataDir);
    this.lines = []; this.events = []; this.platformRequests = []; this.protocolErrors = []; this.stderr = ''; this.stdoutNoise = [];
    this.waiting = new Map(); this.seq = 0; this.ready = null; this.exit = null;
    this.platform = { 'dialog.open': async () => ({ canceled: true, filePaths: [] }) };
    this.child = spawn(process.execPath, [hostScript, '--data', this.dataDir, '--app', appRoot, '--asset-base', 'http://lumen.localhost/', '--update-mode', 'check-only', '--version', '9.9.9-test', ...extra], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.readyPromise = new Promise(resolve => { this.onReady = resolve; });
    this.exited = new Promise(resolve => this.child.on('exit', (code, signal) => { this.exit = { code, signal, at: Date.now() }; resolve(this.exit); }));
    this.child.stderr.on('data', d => { this.stderr += d; });
    let buffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => { buffer += chunk; let i; while ((i = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); this.onLine(line); } });
  }
  onLine(line) {
    let m; try { m = JSON.parse(line); } catch { this.stdoutNoise.push(line); return; }
    this.lines.push(m);
    if (m.type === 'ready') { this.ready = m; this.onReady(m); }
    else if (m.type === 'result' || m.type === 'asset-result') { this.waiting.get(m.id)?.(m); this.waiting.delete(m.id); }
    else if (m.type === 'event') this.events.push(m);
    else if (m.type === 'protocol-error') this.protocolErrors.push(m);
    else if (m.type === 'platform') this.answer(m);
  }
  async answer(m) {
    this.platformRequests.push(m);
    const fn = this.platform[m.method];
    if (!fn) return this.write({ id: m.id, type: 'platform-result', ok: false, error: 'not supported by the fake shell: ' + m.method });
    try { this.write({ id: m.id, type: 'platform-result', ok: true, value: await fn(...(m.args || [])) }); }
    catch (e) { this.write({ id: m.id, type: 'platform-result', ok: false, error: e.message }); }
  }
  write(message) { this.child.stdin.write(JSON.stringify(message) + '\n'); }
  async start() { await Promise.race([this.readyPromise, this.exited.then(() => { throw Error('core-host exited before ready: ' + this.stderr); }), sleep(30000).then(() => { throw Error('core-host not ready in 30 s: ' + this.stderr); })]); return this.ready; }
  call(channel, args = []) { const id = 'c' + (++this.seq); return new Promise(resolve => { this.waiting.set(id, resolve); this.write({ id, type: 'call', channel, args }); }); }
  asset(urlPath) { const id = 'a' + (++this.seq); return new Promise(resolve => { this.waiting.set(id, resolve); this.write({ id, type: 'asset', path: urlPath }); }); }
  async until(predicate, ms = 10000) { const end = Date.now() + ms; for (;;) { const hit = predicate(); if (hit) return hit; if (Date.now() > end) throw Error('timed out waiting'); await sleep(25); } }
  async shutdown() { const t0 = Date.now(); this.write({ type: 'shutdown' }); const exit = await Promise.race([this.exited, sleep(15000).then(() => null)]); return { exit, ms: Date.now() - t0 }; }
  kill() { try { this.child.kill(); } catch {} }
}

const shells = [];
const launch = async (extra, prepare) => { const s = new FakeShell(extra, prepare); shells.push(s); await s.start(); return s; };
after(() => { for (const s of shells) s.kill(); });

describe('core host', () => {
  test('ready lists channels', async () => {
    const shell = await launch();
    assert.equal(shell.ready.type, 'ready');
    const preload = fs.readFileSync(path.join(repoRoot, 'app', 'preload.cjs'), 'utf8');
    const invoked = [...new Set([...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(m => m[1]))].sort();
    assert.deepEqual([...shell.ready.channels].sort(), invoked);
    assert.deepEqual(shell.stdoutNoise, [], 'stdout carries only protocol lines');
    await shell.shutdown();
  });

  test('call returns result', async () => {
    const shell = await launch();
    const r = await shell.call('preferences', []);
    assert.equal(r.ok, true);
    assert.equal(r.value.language, 'en');
    assert.equal(r.value.contextSize, 4096);
    // Plain data from the command line: no platform request is needed for it.
    const asset = await shell.call('tools', ['get']);
    assert.equal(asset.ok, true);
    assert.equal(shell.platformRequests.filter(p => /^(assetBase|appDir|updateMode|app\.version)/.test(p.method)).length, 0);
    await shell.shutdown();
  });

  test('unknown channel -> ok:false', async () => {
    const shell = await launch();
    const r = await shell.call('no-such-channel', []);
    assert.equal(r.ok, false);
    assert.match(r.error, /Unknown channel/);
    await shell.shutdown();
  });

  test('platform round-trip', async () => {
    const shell = await launch();
    // attach-text asks the shell for a file dialog; the fake shell answers "cancelled".
    const r = await shell.call('attach-text', ['en']);
    const request = shell.platformRequests.find(p => p.method === 'dialog.open');
    assert.ok(request, 'the core asked the shell for dialog.open');
    assert.equal(request.type, 'platform');
    assert.ok(request.id);
    assert.deepEqual(request.args[0].properties, ['openFile', 'multiSelections']);
    assert.equal(r.ok, true);
    assert.deepEqual(r.value, []);
    // A refusal from the shell becomes the call's error.
    shell.platform['dialog.save'] = async () => { throw Error('no save dialog here'); };
    const refused = await shell.call('export', ['text']);
    assert.equal(refused.ok, false);
    assert.match(refused.error, /no save dialog here/);
    await shell.shutdown();
  });

  test('events are forwarded', async () => {
    const shell = await launch();
    const pid = hostPidOf(shell.child.pid);
    assert.ok(pid, 'lumen-host runs under the core');
    // The engine stopping is reported to the renderer as an engine-event.
    process.kill(pid);
    const event = await shell.until(() => shell.events.find(e => e.channel === 'engine-event'));
    assert.equal(event.type, 'event');
    assert.equal(event.payload.type, 'fatal');
    assert.match(event.payload.data.message, /Local engine stopped/);
    assert.deepEqual(shell.stdoutNoise, []);
    await shell.shutdown();
  });

  test('too-large line rejected', async () => {
    const shell = await launch();
    const big = Buffer.alloc(64 * 1024 * 1024 + 4096, 120);
    shell.child.stdin.write(big); shell.child.stdin.write('\n');
    const error = await shell.until(() => shell.protocolErrors[0], 20000);
    assert.deepEqual(error, { type: 'protocol-error', reason: 'too-large' });
    assert.equal(shell.protocolErrors.length, 1);
    // The next line is processed normally.
    const r = await shell.call('preferences', []);
    assert.equal(r.ok, true);
    // A line of exactly the limit is accepted (and is not valid JSON, so it is reported as that).
    await shell.shutdown();
  });

  test('invalid JSON is reported, not fatal', async () => {
    const shell = await launch();
    shell.child.stdin.write('{nope\n');
    await shell.until(() => shell.protocolErrors.find(e => e.reason === 'invalid-json'));
    assert.equal((await shell.call('preferences', [])).ok, true);
    await shell.shutdown();
  });

  test('shutdown exits within 5 s and stops lumen-host', async () => {
    const shell = await launch();
    const hostPid = hostPidOf(shell.child.pid);
    assert.ok(hostPid && alive(hostPid), 'lumen-host is running');
    const { exit, ms } = await shell.shutdown();
    assert.ok(exit, 'core-host exited');
    assert.equal(exit.code, 0);
    assert.ok(ms < 5000, 'exited in ' + ms + ' ms');
    for (let i = 0; i < 40 && alive(hostPid); i++) await sleep(100);
    assert.equal(alive(hostPid), false, 'lumen-host is gone');
    assert.equal(fs.existsSync(path.join(shell.dataDir, 'core.lock')), false, 'the lock is released');
  });

  test('exception in a handler -> ok:false, process stays up', async () => {
    const shell = await launch();
    const bad = await shell.call('delete-chat', ['not-a-chat-id']);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /Invalid conversation ID/);
    const bad2 = await shell.call('hub', ['nonsense']);
    assert.equal(bad2.ok, false);
    assert.equal(shell.exit, null, 'core-host is still running');
    assert.equal((await shell.call('preferences', [])).ok, true);
    await shell.shutdown();
  });

  test('stdin closing shuts the core down', async () => {
    const shell = await launch();
    const hostPid = hostPidOf(shell.child.pid);
    shell.child.stdin.end();
    const exit = await Promise.race([shell.exited, sleep(10000).then(() => null)]);
    assert.ok(exit, 'core-host exited when its shell went away');
    for (let i = 0; i < 40 && alive(hostPid); i++) await sleep(100);
    assert.equal(alive(hostPid), false);
  });

  test('a second core on the same data folder fails with core.lock', async () => {
    const shell = await launch();
    const second = spawnSync(process.execPath, [hostScript, '--data', shell.dataDir, '--app', appRoot], { encoding: 'utf8', timeout: 20000, input: '' });
    assert.equal(second.status, 1);
    assert.match(second.stderr, /core\.lock: Lumen is already running/);
    assert.equal(second.stdout, '', 'nothing on stdout');
    await shell.shutdown();
  });

  const LIMIT = 64 * 1024 * 1024;
  const results = (shell, ids) => ids.map(id => new Promise(r => shell.waiting.set(id, r)));

  test('a line of exactly 64 MiB is accepted', async () => {
    const shell = await launch();
    const head = '{"id":"big","type":"call","channel":"preferences","args":[],"pad":"', tail = '"}';
    const line = head + 'a'.repeat(LIMIT - Buffer.byteLength(head) - Buffer.byteLength(tail)) + tail;
    assert.equal(Buffer.byteLength(line), LIMIT);
    const [pending] = results(shell, ['big']);
    shell.child.stdin.write(line + '\n');
    const r = await pending;
    assert.equal(r.ok, true);
    assert.deepEqual(shell.protocolErrors, []);
    await shell.shutdown();
  });

  test('CRLF lines and several messages in one chunk', async () => {
    const shell = await launch();
    const call = id => JSON.stringify({ id, type: 'call', channel: 'preferences', args: [] });
    const crlf = results(shell, ['crlf']);
    shell.child.stdin.write(call('crlf') + '\r\n');
    assert.equal((await crlf[0]).ok, true);
    const ids = ['m1', 'm2', 'm3'], pending = results(shell, ids);
    shell.child.stdin.write(ids.map(id => call(id) + '\n').join('') + '\n   \n');
    for (const r of await Promise.all(pending)) assert.equal(r.ok, true);
    assert.deepEqual(shell.protocolErrors, []);
    await shell.shutdown();
  });

  test('a call with a non-string channel gets an error result', async () => {
    const shell = await launch();
    const [pending] = results(shell, ['bad1']);
    shell.child.stdin.write(JSON.stringify({ id: 'bad1', type: 'call', channel: 5, args: [] }) + '\n');
    const r = await pending;
    assert.equal(r.ok, false);
    assert.match(r.error, /channel must be a string/);
    assert.equal((await shell.call('preferences', [])).ok, true);
    await shell.shutdown();
  });

  test('platform-event reaches the core; unknown names and non-object payloads are ignored', async () => {
    const shell = await launch();
    for (const m of ['configure', 'create', 'show', 'hide', 'navigate', 'onNavigate', 'onPopup', 'onState']) shell.platform['browser.' + m] = async () => null;
    shell.platform['browser.info'] = async () => ({ url: 'https://example.com/', title: 'Example', loading: false, canGoBack: false, canGoForward: false, zoom: 1 });
    assert.equal((await shell.call('browser', ['open', { url: 'https://example.com/' }])).ok, true);
    for (const name of ['browser.onNavigate', 'browser.onPopup', 'browser.onState']) assert.ok(shell.platformRequests.some(p => p.method === name), name + ' registered with the shell');
    const errors = () => shell.events.filter(e => e.channel === 'browser-event' && e.payload.error);
    shell.write({ type: 'platform-event', name: 'browser.onNavigate', payload: { type: 'fail', code: -105, description: 'Name not resolved', url: 'https://example.com/' } });
    const first = await shell.until(() => errors()[0]);
    assert.equal(first.payload.error.code, -105);
    const before = shell.events.length;
    shell.write({ type: 'platform-event', name: 'constructor', payload: { type: 'fail' } });
    shell.write({ type: 'platform-event', name: '__proto__', payload: { type: 'fail' } });
    shell.write({ type: 'platform-event', name: 'browser.nope', payload: { type: 'fail' } });
    shell.write({ type: 'platform-event', name: 'browser.onNavigate', payload: 'fail' });
    shell.write({ type: 'platform-event', name: 'browser.onNavigate', payload: null });
    shell.write({ type: 'platform-event', name: 'browser.onNavigate', payload: { type: 'fail', code: -106, description: 'x', url: 'https://example.com/' } });
    await shell.until(() => errors().some(e => e.payload.error.code === -106));
    assert.equal(shell.events.slice(before).filter(e => e.channel === 'browser-event').length, 1, 'only the valid event produced a browser-event');
    assert.equal(shell.exit, null);
    await shell.shutdown();
  });

  test('browser.render abort sends browser.cancel; requests fail once the shell is gone', async () => {
    const require = createRequire(import.meta.url);
    const { createRpcPlatform } = require(hostScript);
    const sent = [];
    const { platform, state } = createRpcPlatform({ data: freshDir('rpc-unit'), assetBase: 'x://', appDir: 'x', updateMode: 'full', version: '1', send: m => sent.push(m) });
    const abort = new AbortController();
    const render = platform.browser.render('https://a.example/', { signal: abort.signal, ignored: () => {} });
    const request = sent.find(m => m.method === 'browser.render');
    assert.deepEqual(request.args, ['https://a.example/', {}], 'no signal or function crosses the wire');
    abort.abort();
    await assert.rejects(render, { cancelled: true });
    const cancel = sent.find(m => m.method === 'browser.cancel');
    assert.deepEqual(cancel.args, [request.id]);
    await assert.rejects(platform.browser.render('https://b.example/', { signal: abort.signal }), { cancelled: true });
    state.gone = true;
    const before = sent.length;
    await assert.rejects(platform.openExternal('https://x.example/'), /shell is gone/);
    assert.equal(sent.length, before, 'nothing is sent once the shell is gone');
  });

  test('browser requests wait for the proxy in order; configure carries its address; pop-ups arrive as {url} and are checked', async () => {
    const require = createRequire(import.meta.url);
    const { createRpcPlatform } = require(hostScript);
    const sent = [];
    let started = 0, release;
    const webProxy = () => { started++; return new Promise(r => { release = () => r({ url: 'http://lumen:tok@127.0.0.1:5', realm: 'lumen-r' }); }); };
    const { platform, state } = createRpcPlatform({ data: freshDir('rpc-proxy'), assetBase: 'x://', appDir: 'x', updateMode: 'full', version: '1', send: m => sent.push(m), webProxy });
    platform.browser.configure({ privacySignals: true });
    platform.browser.create({ javascript: true });
    const render = platform.browser.render('https://a.example/', {});
    platform.browser.navigate('https://b.example/');
    await new Promise(r => setTimeout(r, 20));
    assert.equal(sent.length, 0, 'nothing reaches the shell before the proxy runs');
    release();
    await new Promise(r => setTimeout(r, 20));
    assert.deepEqual(sent.map(m => m.method), ['browser.configure', 'browser.create', 'browser.render', 'browser.navigate']);
    assert.deepEqual(sent[0].args, [{ privacySignals: true }, { proxy: 'http://lumen:tok@127.0.0.1:5', realm: 'lumen-r', testHost: null }]);
    platform.browser.configure({ privacySignals: false });
    await new Promise(r => setTimeout(r, 20));
    assert.equal(started, 1, 'one proxy for the whole run');
    state.pending.get(sent[2].id).resolve({ title: 't', url: 'https://a.example/', text: 'x' });
    assert.equal((await render).title, 't');
    // Pop-ups: {url} only, and only addresses web.cjs accepts.
    const popups = [];
    platform.browser.onPopup(url => popups.push(url));
    for (const payload of [{ url: 'https://c.example/p#x' }, { url: 'http://192.168.1.1/' }, { url: 'file:///C:/x' }, { url: 'https://u:p@d.example/' }, {}, { url: 5 }]) state.deliver('browser.onPopup', payload);
    assert.deepEqual(popups, ['https://c.example/p']);
  });

  test('a proxy that fails to start is tried again on the next browser request', async () => {
    const require = createRequire(import.meta.url);
    const { createRpcPlatform } = require(hostScript);
    const sent = [];
    let attempts = 0;
    const webProxy = async () => { attempts++; if (attempts === 1) throw Error('port in use'); return { url: 'http://lumen:t@127.0.0.1:6', realm: 'lumen-x' }; };
    const { platform } = createRpcPlatform({ data: freshDir('rpc-retry'), assetBase: 'x://', appDir: 'x', updateMode: 'full', version: '1', send: m => sent.push(m), webProxy });
    await assert.rejects(platform.browser.configure({}), /port in use/);
    assert.equal(sent.length, 0);
    platform.browser.configure({});
    await new Promise(r => setTimeout(r, 20));
    assert.equal(attempts, 2);
    assert.deepEqual(sent.map(m => m.method), ['browser.configure']);
    assert.equal(sent[0].args[1].proxy, 'http://lumen:t@127.0.0.1:6');
  });

  test('LUMEN_TEST_ALLOW_HOST takes effect only with --ui-check (core checks, proxy and the testHost given to the shell)', async () => {
    const target = 'http://127.0.0.1:' + 47321 + '/page';
    const run = async extra => {
      const saved = process.env.LUMEN_TEST_ALLOW_HOST;
      process.env.LUMEN_TEST_ALLOW_HOST = '127.0.0.1:47321';
      let shell;
      try { shell = await launch(extra); } finally { if (saved === undefined) delete process.env.LUMEN_TEST_ALLOW_HOST; else process.env.LUMEN_TEST_ALLOW_HOST = saved; }
      for (const m of ['configure', 'create', 'show', 'hide', 'navigate', 'onNavigate', 'onPopup', 'onState']) shell.platform['browser.' + m] = async () => null;
      shell.platform['browser.info'] = async () => ({ url: target, title: '', loading: false, canGoBack: false, canGoForward: false, zoom: 1 });
      const open = await shell.call('browser', ['open', { url: target }]);
      const configure = await shell.until(() => shell.platformRequests.find(p => p.method === 'browser.configure'));
      // The proxy the shell is told about: does it let the test host through?
      const proxy = new URL(configure.args[1].proxy);
      const auth = 'Basic ' + Buffer.from(decodeURIComponent(proxy.username) + ':' + decodeURIComponent(proxy.password)).toString('base64');
      const reply = await new Promise(resolve => { const s = net.connect(Number(proxy.port), '127.0.0.1'); let d = ''; s.on('data', x => { d += x; }); s.on('close', () => resolve(d)); s.on('error', () => resolve(d)); s.write('GET ' + target + ' HTTP/1.1\r\nHost: 127.0.0.1:47321\r\nProxy-Authorization: ' + auth + '\r\nConnection: close\r\n\r\n'); });
      await shell.shutdown();
      return { open, configure, reply };
    };
    const product = await run([]);
    assert.equal(product.open.ok, false, 'blocked without --ui-check');
    assert.match(product.open.error, /blocked/);
    assert.equal(product.configure.args[1].testHost, null);
    assert.match(product.configure.args[1].realm, /^lumen-[0-9a-f]{32}$/);
    assert.match(product.reply, /^HTTP\/1\.1 403 [^]*X-Lumen-Proxy: blocked/i, 'the proxy blocks it too');
    const testMode = await run(['--ui-check']);
    assert.equal(testMode.open.ok, true, testMode.open.error);
    assert.equal(testMode.configure.args[1].testHost, '127.0.0.1:47321');
    assert.doesNotMatch(testMode.reply, /X-Lumen-Proxy: blocked/i, 'the proxy dials the test host (nothing listens there: 502)');
  });

  test('stdin EOF rejects pending and new platform calls and the core exits quickly', async () => {
    const shell = await launch([], dir => fs.writeFileSync(path.join(dir, 'tools-settings.json'), JSON.stringify({ browser: { clearOnExit: true } })));
    shell.platform['dialog.open'] = () => new Promise(() => {}); // never answered
    const pending = shell.call('attach-text', ['en']);
    await shell.until(() => shell.platformRequests.some(p => p.method === 'dialog.open'));
    const t0 = Date.now();
    shell.child.stdin.end();
    const r = await pending;
    assert.equal(r.ok, false, 'the pending platform call was rejected');
    assert.match(r.error, /shell is gone/);
    const exit = await Promise.race([shell.exited, sleep(7000).then(() => null)]);
    assert.ok(exit, 'core-host exited');
    assert.ok(Date.now() - t0 < 5000, 'exited in ' + (Date.now() - t0) + ' ms, not at the 8 s kill');
    // stop() asks browser.clearData (clearOnExit): with the shell gone that request is rejected, never sent.
    assert.equal(shell.platformRequests.some(p => p.method === 'browser.clearData'), false);
  });

  test('an explicit shutdown keeps platform requests working until the core stops', async () => {
    const shell = await launch([], dir => fs.writeFileSync(path.join(dir, 'tools-settings.json'), JSON.stringify({ browser: { clearOnExit: true } })));
    shell.platform['browser.clearData'] = async () => true;
    const { exit } = await shell.shutdown();
    assert.equal(exit.code, 0);
    assert.ok(shell.platformRequests.some(p => p.method === 'browser.clearData'), 'clearData was sent and answered');
  });

  test('binary data travels as files: image.normalize through the shell', async () => {
    const shell = await launch();
    const png = Buffer.alloc(33); // signature + IHDR 10x10: enough for the size checks
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0); png.writeUInt32BE(13, 8); png.write('IHDR', 12, 'ascii'); png.writeUInt32BE(10, 16); png.writeUInt32BE(10, 20);
    shell.platform['image.normalize'] = async (input, output, maxSide, quality) => {
      assert.ok(path.resolve(input).startsWith(path.join(shell.dataDir, 'temp', 'rpc')));
      assert.equal(maxSide, 1600); assert.equal(quality, 'best');
      assert.deepEqual(fs.readFileSync(input), png);
      fs.writeFileSync(output, Buffer.from('normalized'));
      return { width: 10, height: 10, original: { width: 10, height: 10 } };
    };
    shell.platform['image.thumbnail'] = async (input, output) => { fs.writeFileSync(output, Buffer.from('thumb')); return true; };
    // photos 'choose' needs a dialog; use the clipboard path instead: the shell hands over a PNG in <data>/temp/clipboard.
    const clip = path.join(shell.dataDir, 'temp', 'clipboard'); fs.mkdirSync(clip, { recursive: true });
    const file = path.join(clip, 'abc'); fs.writeFileSync(file, png);
    shell.platform['clipboard.read'] = async () => [{ type: 'image', mime: 'image/png', path: file }];
    const r = await shell.call('photos', ['paste', { language: 'en' }]);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.value.length, 1);
    assert.equal(r.value[0].width, 10);
    assert.equal(fs.existsSync(file), false, 'the clipboard temp file was removed by the core');
    const rpcDir = path.join(shell.dataDir, 'temp', 'rpc');
    for (let i = 0; i < 20 && fs.existsSync(rpcDir) && fs.readdirSync(rpcDir).length; i++) await sleep(50);
    assert.deepEqual(fs.existsSync(rpcDir) ? fs.readdirSync(rpcDir) : [], [], 'rpc temp files cleaned up');
    for (const p of shell.platformRequests) assert.ok(!JSON.stringify(p).includes('"type":"Buffer"'), 'no Buffer in JSON');
    await shell.shutdown();
  });

  test('asset requests are answered by core.asset (the Tauri lumen protocol)', async () => {
    const shell = await launch([], dir => fs.writeFileSync(path.join(dir, 'desktop-preferences.json'), JSON.stringify({ layout: 'studio', colorMode: 'light', designChosen: true })));
    const index = await shell.asset('/');
    assert.equal(index.status, 200);
    assert.match(index.headers['content-type'], /^text\/html/);
    assert.equal(typeof index.body, 'string');
    assert.match(index.body, /<body data-layout="studio" data-mode="light"/, 'index.html carries the saved design');
    assert.equal(index.filePath, undefined);
    const css = await shell.asset('/style.css');
    assert.equal(css.status, 200);
    assert.equal(path.resolve(css.filePath), path.join(repoRoot, 'app', 'style.css'));
    assert.equal(css.body, undefined);
    for (const p of ['/core.cjs', '/../core.lock', '/photo/' + 'a'.repeat(64) + '.png', '/backend/lumen-host.exe']) {
      const r = await shell.asset(p);
      assert.equal(r.status, 404, p);
      assert.equal(r.filePath, undefined, p);
    }
    const before = shell.protocolErrors.length;
    shell.write({ type: 'asset', path: 7 });
    await shell.until(() => shell.protocolErrors.length > before);
    await shell.shutdown();
  });
});
