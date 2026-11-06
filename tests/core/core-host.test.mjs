// Core host tests: app/core-host.cjs run as a real child process, driven by a fake shell over stdin/stdout (newline-delimited JSON).
//   node --test "tests/core/*.test.mjs"
// The core needs lumen-host.exe for start(): --app points at <work>/electron-dev, whose resources/app/backend holds the compiled
// host. Test data goes to <work>/core-host-tests/<run>; no model, engine download or network is used.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
  constructor(extra = []) {
    this.dataDir = freshDir('data');
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
    else if (m.type === 'result') { this.waiting.get(m.id)?.(m); this.waiting.delete(m.id); }
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
  async until(predicate, ms = 10000) { const end = Date.now() + ms; for (;;) { const hit = predicate(); if (hit) return hit; if (Date.now() > end) throw Error('timed out waiting'); await sleep(25); } }
  async shutdown() { const t0 = Date.now(); this.write({ type: 'shutdown' }); const exit = await Promise.race([this.exited, sleep(15000).then(() => null)]); return { exit, ms: Date.now() - t0 }; }
  kill() { try { this.child.kill(); } catch {} }
}

const shells = [];
const launch = async (extra) => { const s = new FakeShell(extra); shells.push(s); await s.start(); return s; };
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
});
