// Core isolation tests: core.cjs runs without Electron, behind the platform contract (platform.cjs).
//   node --test tests/core/
// Test data goes to <work>/core-tests/<run>; no model, engine or network is used.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const appDir = path.join(repoRoot, 'app');
const runDir = path.join(repoRoot, '..', 'work', 'core-tests', new Date().toISOString().replace(/[:.]/g, '-'));
const require = createRequire(import.meta.url);

// Any attempt to load electron from the core fails the test that caused it.
const electronLoads = [];
const originalLoad = Module._load;
before(() => {
  Module._load = function (request, ...rest) {
    if (request === 'electron') { electronLoads.push(new Error('electron required').stack); throw Error('electron must not be loaded by the core'); }
    return originalLoad.call(this, request, ...rest);
  };
});
after(() => { Module._load = originalLoad; });

// A platform where every service is a recording stub.
function fakePlatform(overrides = {}) {
  const calls = [];
  const fn = name => (...args) => { calls.push([name, ...args]); return undefined; };
  const platform = {
    send: fn('send'), windowAction: fn('windowAction'),
    dialog: { open: async () => ({ canceled: true, filePaths: [] }), save: async () => ({ canceled: true }), message: async () => ({ response: 0 }) },
    clipboard: { writeText: fn('clipboard.writeText'), writePng: fn('clipboard.writePng'), read: async () => [] },
    image: { decodeWebp: async () => { throw Error('no webp'); }, normalize: async () => null, thumbnail: async () => Buffer.alloc(0) },
    secrets: { available: async () => false, encrypt: async () => { throw Error('unavailable'); }, decrypt: async () => '' },
    openExternal: fn('openExternal'),
    assetBase: 'lumen://app/', appDir: runDir, updateMode: 'full',
    app: { version: '0.0.0-test', quit: fn('app.quit'), relaunchArgs: () => [] },
    browser: Object.fromEntries(['configure', 'create', 'show', 'hide', 'navigate', 'back', 'forward', 'reload', 'stop', 'close', 'find', 'stopFind', 'evalIsolated', 'input', 'info', 'setZoom', 'waitIdle', 'render', 'clearData', 'onNavigate', 'onPopup', 'onState'].map(m => [m, fn('browser.' + m)])),
    artifact: { open: fn('artifact.open'), close: fn('artifact.close') },
    calls,
  };
  return Object.assign(platform, overrides);
}

const freshDir = name => { const dir = path.join(runDir, name); fs.mkdirSync(dir, { recursive: true }); return dir; };

// A real PNG header (signature + IHDR) is enough for photos.cjs's format and size checks.
function pngHeader(width, height) {
  const b = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20);
  return b;
}

describe('core isolation', () => {
  test('does not load electron', () => {
    const { createCore } = require(path.join(appDir, 'core.cjs'));
    const core = createCore({ platform: fakePlatform(), dataDir: freshDir('no-electron'), test: true });
    assert.equal(typeof core.call, 'function');
    assert.deepEqual(electronLoads, []);
  });

  test('channels match preload', () => {
    const { createCore } = require(path.join(appDir, 'core.cjs'));
    const preload = fs.readFileSync(path.join(appDir, 'preload.cjs'), 'utf8');
    const invoked = [...new Set([...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(m => m[1]))].sort();
    const core = createCore({ platform: fakePlatform(), dataDir: freshDir('channels'), test: true });
    assert.ok(invoked.length >= 30, 'preload lists its invoke channels');
    assert.deepEqual([...core.channels].sort(), invoked);
  });

  test('assertPlatform rejects missing methods', () => {
    const { assertPlatform } = require(path.join(appDir, 'platform.cjs'));
    const { createCore } = require(path.join(appDir, 'core.cjs'));
    assert.doesNotThrow(() => assertPlatform(fakePlatform()));
    const broken = fakePlatform(); delete broken.dialog.save;
    assert.throws(() => assertPlatform(broken), { message: 'platform.dialog.save missing' });
    assert.throws(() => createCore({ platform: broken, dataDir: freshDir('broken'), test: true }), { message: 'platform.dialog.save missing' });
    const noNormalize = fakePlatform(); delete noNormalize.image.normalize;
    assert.throws(() => assertPlatform(noNormalize), { message: 'platform.image.normalize missing' });
    const noVersion = fakePlatform({ app: { quit() {}, relaunchArgs: () => [] } });
    assert.throws(() => assertPlatform(noVersion), { message: 'platform.app.version missing' });
    const noClear = fakePlatform(); delete noClear.browser.clearData;
    assert.throws(() => assertPlatform(noClear), { message: 'platform.browser.clearData missing' });
  });

  test('core.lock', async () => {
    const { createCore } = require(path.join(appDir, 'core.cjs'));
    const dir = freshDir('lock');
    const first = createCore({ platform: fakePlatform(), dataDir: dir, test: true });
    await first.start();
    assert.equal(fs.readFileSync(path.join(dir, 'core.lock'), 'utf8').split(/\r?\n/)[0], String(process.pid));
    const second = createCore({ platform: fakePlatform(), dataDir: dir, test: true });
    await assert.rejects(second.start(), /core.lock: Lumen is already running/);
    await first.stop();
    assert.equal(fs.existsSync(path.join(dir, 'core.lock')), false, 'stop releases the lock');

    // A lock left by a process that is gone is taken over.
    const dead = spawnSync(process.execPath, ['-e', '0']).pid;
    const stale = freshDir('lock-stale');
    fs.writeFileSync(path.join(stale, 'core.lock'), String(dead));
    const third = createCore({ platform: fakePlatform(), dataDir: stale, test: true });
    await third.start();
    assert.equal(fs.readFileSync(path.join(stale, 'core.lock'), 'utf8').split(/\r?\n/)[0], String(process.pid));
    await third.stop();
    assert.deepEqual(electronLoads, []);
  });

  // A shell that can only answer secrets asynchronously (an RPC shell): keys must round-trip through connections and toolsettings.
  const asyncSecrets = () => {
    const wait = () => new Promise(r => setTimeout(r, 5));
    return { available: async () => { await wait(); return true; }, encrypt: async text => { await wait(); return Buffer.from('enc:' + text).toString('base64'); },
      decrypt: async value => { await wait(); const t = Buffer.from(value, 'base64').toString('utf8'); if (!t.startsWith('enc:')) throw Error('bad'); return t.slice(4); } };
  };

  test('async secrets round-trip through connections', async () => {
    const { createConnections } = require(path.join(appDir, 'connections.cjs'));
    const dir = freshDir('secrets-connections');
    const c = createConnections(dir, asyncSecrets());
    const view = await c.setCloudProvider('openai', { models: ['gpt-test'], key: 'sk-test-123' });
    assert.equal(view.cloud.providers.openai.key, true);
    assert.equal(view.encryption, true);
    assert.equal(await c.cloudKey('openai'), 'sk-test-123');
    const stored = JSON.parse(fs.readFileSync(path.join(dir, 'connections.json'), 'utf8'));
    assert.equal(stored.cloud.keys.openai, Buffer.from('enc:sk-test-123').toString('base64'), 'the stored format is base64 of the encrypted text');
    assert.doesNotMatch(JSON.stringify(c.summary()), /sk-test-123/);
    const id = await c.addServer({ name: 'x', url: 'https://example.com/mcp', token: 'tok-1' });
    assert.equal((await c.server(id)).token, 'tok-1');
    await c.updateServer(id, { token: 'tok-2' });
    assert.equal((await c.server(id)).token, 'tok-2');
    assert.equal((await c.servers())[0].token, 'tok-2');
    await c.setApi({ enabled: true });
    const api = await c.api();
    assert.match(api.token, /^lumen-/);
    assert.equal((await c.public()).api.token, api.token);
    // A secret store that is not available refuses to save.
    const off = createConnections(freshDir('secrets-off'), { available: async () => false, encrypt: async () => { throw Error('x'); }, decrypt: async () => '' });
    await assert.rejects(off.setCloudProvider('openai', { key: 'sk-x' }), /Secure storage is not available/);
  });

  test('async secrets round-trip through toolsettings and the core', async () => {
    const { createToolSettings } = require(path.join(appDir, 'toolsettings.cjs'));
    const dir = freshDir('secrets-tools');
    const t = createToolSettings(dir, asyncSecrets());
    const pub = await t.setKey('brave', 'brave-key-1');
    assert.equal(pub.search.keys.brave, true);
    assert.equal(pub.encryption, true);
    await t.update({ search: { provider: 'brave' } });
    assert.equal((await t.get()).search.key, 'brave-key-1');
    assert.equal(t.plain().search.key, undefined, 'the plain view has no key');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'tools-settings.json'), 'utf8')).keys.brave, Buffer.from('enc:brave-key-1').toString('base64'));
    assert.equal((await t.clearKey('brave')).search.keys.brave, false);

    const { createCore } = require(path.join(appDir, 'core.cjs'));
    const core = createCore({ platform: fakePlatform({ secrets: asyncSecrets() }), dataDir: freshDir('secrets-core'), test: true });
    await core.start();
    try {
      const set = await core.call('tools', ['set-key', { provider: 'tavily', key: 'tvly-abc' }]);
      assert.equal(set.search.keys.tavily, true);
      const view = await core.call('connections', ['provider', { provider: 'openai', models: ['gpt-test'], key: 'sk-core' }]);
      assert.equal(view.cloud.providers.openai.key, true);
      assert.equal((await core.call('connections', ['get'])).encryption, true);
    } finally { await core.stop(); }
  });

  test('clipboard paste deletes only temp files under temp/clipboard', async () => {
    const { createCore } = require(path.join(appDir, 'core.cjs'));
    const dir = freshDir('paste');
    const clip = path.join(dir, 'temp', 'clipboard'); fs.mkdirSync(clip, { recursive: true });
    const png = pngHeader(8, 8);
    const mine = path.join(clip, 'first'), second = path.join(clip, 'second');
    const outside = path.join(freshDir('paste-outside'), 'keep.png'), traversal = path.join(clip, '..', '..', 'keep2.png');
    for (const f of [mine, second, outside, traversal]) fs.writeFileSync(f, png);
    const image = { decodeWebp: async () => { throw Error('unused'); }, normalize: async () => ({ png, width: 8, height: 8, original: { width: 8, height: 8 } }), thumbnail: async () => png };
    const third = path.join(clip, 'third'); fs.writeFileSync(third, png);
    const upper = path.join(clip.toUpperCase(), 'third');
    const items = [{ type: 'text', text: 'hello' }, { type: 'image', mime: 'image/png', path: mine }, { type: 'image', mime: 'image/png', path: second }, { type: 'image', mime: 'image/png', path: outside }, { type: 'image', mime: 'image/png', path: traversal }, ...(process.platform === 'win32' ? [{ type: 'image', mime: 'image/png', path: upper }] : [])];
    const core = createCore({ platform: fakePlatform({ image, clipboard: { writeText() {}, writePng() {}, read: async () => items } }), dataDir: dir, test: true });
    await core.start();
    try {
      const photos = await core.call('photos', ['paste', { language: 'en' }]);
      assert.equal(photos.length, 1);
      assert.equal(fs.existsSync(mine), false);
      assert.equal(fs.existsSync(second), false);
      if (process.platform === 'win32') assert.equal(fs.existsSync(third), false, 'the folder is compared case-insensitively on Windows');
      assert.equal(fs.existsSync(outside), true, 'a path outside temp/clipboard is never deleted');
      assert.equal(fs.existsSync(traversal), true, 'a path that climbs out of temp/clipboard is never deleted');
    } finally { await core.stop(); }
  });

  test('core.lock stale takeover: two starters, only one wins', () => {
    const { takeLock } = require(path.join(appDir, 'corelock.cjs'));
    const lock = path.join(freshDir('lock-race'), 'core.lock');
    const dead = 999999, A = 1111, B = 2222;
    const alive = pid => pid === A || pid === B;
    const inspect = () => null; // the image lookup cannot tell (the lock counts as held while alive)
    const holder = () => fs.readFileSync(lock, 'utf8').split(/\r?\n/)[0].trim();
    // B reads the dead PID; before B renames the file, A completes its takeover. B must not move A's live lock away for good.
    fs.writeFileSync(lock, String(dead));
    assert.throws(() => takeLock(lock, { pid: B, alive, inspect, beforeRename: () => { assert.equal(takeLock(lock, { pid: A, alive, inspect }), true); } }),
      /core\.lock: Lumen is already running with this data folder \(process 1111\)/);
    assert.equal(holder(), String(A), 'A still holds the lock');
    assert.deepEqual(fs.readdirSync(path.dirname(lock)), ['core.lock'], 'no stale files left behind');
    // The same interleaving the other way round: B wins first, A (who read the dead PID earlier) loses.
    fs.writeFileSync(lock, String(dead));
    assert.throws(() => takeLock(lock, { pid: A, alive, inspect, beforeRename: () => { takeLock(lock, { pid: B, alive, inspect }); } }), /already running.*\(process 2222\)/);
    assert.equal(holder(), String(B));
    // Without interference a dead holder is taken over, a live one is refused, and the file is created when absent.
    fs.writeFileSync(lock, String(dead));
    assert.equal(takeLock(lock, { pid: A, alive, inspect }), true); assert.equal(holder(), String(A));
    assert.throws(() => takeLock(lock, { pid: B, alive, inspect }), /already running/);
    fs.rmSync(lock); assert.equal(takeLock(lock, { pid: B, alive, inspect }), true); assert.equal(holder(), String(B));
    // An empty or garbage file counts as stale.
    fs.writeFileSync(lock, 'garbage'); assert.equal(takeLock(lock, { pid: A, alive, inspect }), true); assert.equal(holder(), String(A));
  });

  // A PID that Windows has given to another program after a crash is not "Lumen is already running". Real processes and the real
  // lookup (tasklist, PowerShell for the start time) on this conflict path.
  test('core.lock: the start time check is one-directional (slow start still held, later-created process stale)', () => {
    const { takeLock, parseLock } = require(path.join(appDir, 'corelock.cjs'));
    const lock = path.join(freshDir('lock-dir'), 'core.lock');
    const os = 1_700_000_000_000; // OS creation time of the live process
    const opts = { pid: 424242, alive: () => true, inspect: () => ({ image: 'node.exe', start: os }), self: { image: 'node.exe', start: 1 } };
    const withRecorded = recorded => { fs.writeFileSync(lock, `777\nimage=node.exe\nstart=${recorded}\n`); return () => takeLock(lock, opts); };
    assert.throws(withRecorded(os + 6000), /already running/, 'recorded 6 s after OS creation (cold start): held');
    assert.throws(withRecorded(os + 60000), /already running/, 'recorded far after creation: held');
    assert.throws(withRecorded(os - 1000), /already running/, 'process created 1 s after the recorded start: within tolerance, held');
    assert.equal(withRecorded(os - 2000)(), true, 'process created 2 s after the recorded start (PID reused): stale');
    assert.equal(parseLock(fs.readFileSync(lock, 'utf8')).pid, 424242);
    fs.writeFileSync(lock, '777');
    assert.throws(() => takeLock(lock, opts), /already running/, 'legacy PID-only file: held');
  });

  test('core.lock: a reused PID is stale, a live Lumen holds it; files of older versions still work', async () => {
    const { takeLock, parseLock, parseTasklist } = require(path.join(appDir, 'corelock.cjs'));
    const lock = path.join(freshDir('lock-reuse'), 'core.lock');
    const me = 424242;
    const holder = () => parseLock(fs.readFileSync(lock, 'utf8'));
    const nodeChild = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { stdio: 'ignore', windowsHide: true });
    const otherChild = spawn('ping.exe', ['-n', '60', '127.0.0.1'], { stdio: 'ignore', windowsHide: true });
    try {
      await new Promise(r => setTimeout(r, 500));
      const start = Date.now() - 500;
      // Same image (node.exe), started when the file says: held.
      fs.writeFileSync(lock, `${nodeChild.pid}\nimage=node.exe\nstart=${start}\n`);
      assert.throws(() => takeLock(lock, { pid: me }), new RegExp(`already running.*\\(process ${nodeChild.pid}\\)`));
      // Legacy file (PID only) naming a live node.exe: held.
      fs.writeFileSync(lock, String(nodeChild.pid));
      assert.throws(() => takeLock(lock, { pid: me }), /already running/);
      // Same image but another start time (the PID was reused by another node.exe): stale.
      fs.writeFileSync(lock, `${nodeChild.pid}\nimage=node.exe\nstart=${start - 3600000}\n`);
      assert.equal(takeLock(lock, { pid: me }), true);
      assert.equal(holder().pid, me);
      assert.equal(holder().image.toLowerCase(), path.basename(process.execPath).toLowerCase(), 'the new file records the image');
      assert.ok(Math.abs(holder().start - (Date.now() - process.uptime() * 1000)) < 2000, 'and the start time');
      // A live PID of another program (ping.exe), new and legacy format: stale, taken over.
      fs.writeFileSync(lock, `${otherChild.pid}\nimage=lumen.cpp.exe\nstart=${start}\n`);
      assert.equal(takeLock(lock, { pid: me }), true); assert.equal(holder().pid, me);
      fs.writeFileSync(lock, String(otherChild.pid));
      assert.equal(takeLock(lock, { pid: me }), true); assert.equal(holder().pid, me);
      assert.deepEqual(fs.readdirSync(path.dirname(lock)), ['core.lock'], 'no stale files left behind');
    } finally { nodeChild.kill(); otherChild.kill(); }
    // The tasklist output is parsed without relying on its (localized) texts.
    assert.equal(parseTasklist('"node.exe","1234","Console","1","45.000 K"\r\n', 1234), 'node.exe');
    assert.equal(parseTasklist('BİLGİ: Belirtilen ölçütlerle eşleşen görev yok.\r\n', 1234), '');
    assert.equal(parseTasklist('"node.exe","12345","Console","1","45.000 K"\r\n', 1234), '');
    assert.equal(parseTasklist('', 1234), null, 'no output: the lookup failed');
  });

  // FAT/exFAT have no hard links: a live lock moved aside by mistake is renamed back, but never over a lock created meanwhile.
  test('core.lock: the lock is put back by rename where hard links fail', () => {
    const { takeLock } = require(path.join(appDir, 'corelock.cjs'));
    const lock = path.join(freshDir('lock-fat'), 'core.lock');
    const dead = 999999, A = 1111, B = 2222;
    const alive = pid => pid === A || pid === B;
    const inspect = () => null;
    const noLinks = { ...fs, linkSync: () => { throw Object.assign(Error('not supported'), { code: 'EPERM' }); } };
    const holder = () => fs.readFileSync(lock, 'utf8').split(/\r?\n/)[0];
    fs.writeFileSync(lock, String(dead));
    assert.throws(() => takeLock(lock, { pid: B, alive, inspect, fs: noLinks, beforeRename: () => { assert.equal(takeLock(lock, { pid: A, alive, inspect }), true); } }), /already running.*\(process 1111\)/);
    assert.equal(holder(), String(A), 'A still holds the lock (renamed back)');
    assert.deepEqual(fs.readdirSync(path.dirname(lock)), ['core.lock']);
    // A lock that appeared meanwhile is never replaced by the rename back.
    fs.writeFileSync(lock, String(dead));
    const racing = { ...noLinks, existsSync: p => { if (p === lock && !fs.existsSync(lock)) fs.writeFileSync(lock, String(B)); return fs.existsSync(p); } };
    assert.throws(() => takeLock(lock, { pid: B + 1, alive, inspect, fs: racing, beforeRename: () => { takeLock(lock, { pid: A, alive, inspect }); } }), /already running/);
    assert.equal(holder(), String(B), 'the lock created meanwhile stays');
  });

  test('asset urls use platform base', async () => {
    const { createStore } = require(path.join(appDir, 'photos.cjs'));
    const png = pngHeader(10, 10);
    const image = { decodeWebp: async () => { throw Error('unused'); }, normalize: async () => ({ png, width: 10, height: 10, original: { width: 10, height: 10 } }), thumbnail: async () => png };
    const store = createStore(freshDir('assets'), image, path.join(runDir, 'missing-ocr.exe'), 'http://lumen.localhost/');
    const [photo] = await store.importBuffer(png, 'a.png', 'en');
    assert.equal(photo.url, 'http://lumen.localhost/photo/' + photo.id + '.png');
    assert.equal(photo.thumbnail, 'http://lumen.localhost/photo-thumb/' + photo.id + '.png');
  });

  test('photo ID is the SHA-256 of normalize() output', async () => {
    const { createStore } = require(path.join(appDir, 'photos.cjs'));
    const source = pngHeader(3000, 2000);
    const normalized = Buffer.concat([pngHeader(1600, 1067), Buffer.from('normalized pixels')]);
    const seen = [];
    const image = {
      decodeWebp: async () => { throw Error('unused'); },
      normalize: async (buffer, maxSide, quality) => { seen.push(['normalize', buffer, maxSide, quality]); return { png: normalized, width: 1600, height: 1067, original: { width: 3000, height: 2000 } }; },
      thumbnail: async (buffer, maxSide) => { seen.push(['thumbnail', buffer, maxSide]); return Buffer.from('thumb'); },
    };
    const dir = freshDir('photo-id');
    const store = createStore(dir, image, path.join(runDir, 'missing-ocr.exe'), 'lumen://app/');
    const [photo] = await store.importBuffer(source, 'big.png', 'en');
    assert.equal(photo.id, crypto.createHash('sha256').update(normalized).digest('hex'));
    assert.deepEqual(seen[0].slice(1), [source, 1600, 'best']);
    assert.equal(seen[1][1], normalized, 'the thumbnail is made from the normalized PNG');
    assert.equal(seen[1][2], 160);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'images', photo.id + '.png')), normalized);
    assert.equal(fs.readFileSync(path.join(dir, 'images', photo.id + '-thumb.png'), 'utf8'), 'thumb');
    assert.equal(photo.width, 1600); assert.equal(photo.height, 1067);
  });

  test('a photo larger than 50 million pixels is refused after decoding', async () => {
    const { createStore } = require(path.join(appDir, 'photos.cjs'));
    const image = { decodeWebp: async () => { throw Error('unused'); }, normalize: async () => ({ png: pngHeader(1, 1), width: 1600, height: 1600, original: { width: 9000, height: 9000 } }), thumbnail: async () => Buffer.alloc(0) };
    const store = createStore(freshDir('photo-big'), image, path.join(runDir, 'missing-ocr.exe'), 'lumen://app/');
    // A JPEG with no readable size header, so only the decoded size can catch it.
    await assert.rejects(store.importBuffer(Buffer.from([255, 216, 255, 217, 0, 0, 0, 0]), 'x.jpg', 'en'), { message: 'Use a photo with at most 50 million pixels.' });
  });

  test('core.asset serves the UI, photos and 404s', async () => {
    const { createCore } = require(path.join(appDir, 'core.cjs'));
    const dir = freshDir('asset');
    fs.writeFileSync(path.join(dir, 'desktop-preferences.json'), JSON.stringify({ layout: 'studio', colorMode: 'light', theme: 'ocean', motion: false }));
    const core = createCore({ platform: fakePlatform(), dataDir: dir, test: true });
    await core.start();
    try {
      const index = await core.asset('/');
      assert.equal(index.status, 200);
      assert.equal(index.mime, 'text/html; charset=utf-8');
      assert.match(String(index.body), /<body class="no-motion" data-theme="pro" data-mode="light">/);
      for (const file of ['/appearance.js', '/ui/tokens.css', '/ui/base.css', '/ui/c-shell.css', '/ui/c-chat.css']) assert.equal((await core.asset(file)).status, 200, file);
      const css = await core.asset('/style.css');
      assert.equal(css.filePath, path.join(appDir, 'style.css'));
      assert.deepEqual(css.headers, { 'content-type': 'text/css; charset=utf-8' });
      assert.equal((await core.asset('/main.cjs')).status, 404, 'files outside the allowlist are not served');
      assert.equal((await core.asset('/photo/' + 'a'.repeat(64) + '.png')).status, 404);
      assert.equal((await core.asset('/vendor/fonts/KaTeX_Main-Regular.woff2')).mime, 'font/woff2');
    } finally { await core.stop(); }
  });
});
