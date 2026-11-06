// Core isolation tests: core.cjs runs without Electron, behind the platform contract (platform.cjs).
//   node --test tests/core/
// Test data goes to <work>/core-tests/<run>; no model, engine or network is used.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
    secrets: { available: () => false, encrypt: () => { throw Error('unavailable'); }, decrypt: () => '' },
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
    assert.equal(fs.readFileSync(path.join(dir, 'core.lock'), 'utf8').trim(), String(process.pid));
    const second = createCore({ platform: fakePlatform(), dataDir: dir, test: true });
    await assert.rejects(second.start(), Error);
    await first.stop();
    assert.equal(fs.existsSync(path.join(dir, 'core.lock')), false, 'stop releases the lock');

    // A lock left by a process that is gone is taken over.
    const dead = spawnSync(process.execPath, ['-e', '0']).pid;
    const stale = freshDir('lock-stale');
    fs.writeFileSync(path.join(stale, 'core.lock'), String(dead));
    const third = createCore({ platform: fakePlatform(), dataDir: stale, test: true });
    await third.start();
    assert.equal(fs.readFileSync(path.join(stale, 'core.lock'), 'utf8').trim(), String(process.pid));
    await third.stop();
    assert.deepEqual(electronLoads, []);
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
      assert.match(String(index.body), /<body class="no-motion" data-layout="studio" data-mode="light" data-theme="ocean">/);
      const css = await core.asset('/style.css');
      assert.equal(css.filePath, path.join(appDir, 'style.css'));
      assert.deepEqual(css.headers, { 'content-type': 'text/css; charset=utf-8' });
      assert.equal((await core.asset('/main.cjs')).status, 404, 'files outside the allowlist are not served');
      assert.equal((await core.asset('/photo/' + 'a'.repeat(64) + '.png')).status, 404);
      assert.equal((await core.asset('/vendor/fonts/KaTeX_Main-Regular.woff2')).mime, 'font/woff2');
    } finally { await core.stop(); }
  });
});
