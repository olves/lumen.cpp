// Model download through the real UI against a local file host (LUMEN_TEST_DOWNLOAD_BASE, test hook): start from the Library row,
// header pill and dock, pause, resume, completion with SHA-256 verification, installed afterwards, a corrupted file rejected.
// Real: the downloader, the Library UI, the file system. Mock: the file host (127.0.0.1). Nothing is downloaded from the internet.
//   $env:LUMEN_SHELL='tauri'; node --test tests/ui/download.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { launch, workRoot } from '../harness/launch.mjs';
import { prepareData } from './data.mjs';
import { downloadServer, sleep } from './mocks.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `download-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data');
const NAME = 'Mock model Q4';
let app, host;
const ev = e => app.cdp.evaluate(e);
const js = JSON.stringify;
const list = () => ev("window.lumen.downloads('list')");
const modelFile = () => path.join(dataDir, 'models', host.sha.slice(0, 12) + '-mock-model-q4.gguf');
const shot = n => app?.cdp.screenshot(path.join(runDir, n + '.png')).catch(() => {});
const sha256 = file => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });

describe(`download (${shell})`, () => {
  before(async () => {
    host = await downloadServer({ bytes: 48 << 20, delayMs: 500, file: 'mock-model-q4.gguf' });
    prepareData(dataDir, null);
    app = await launch({ shell, dataDir, env: { LUMEN_TEST_DOWNLOAD_BASE: host.base } });
    await app.cdp.waitFor('state.ready === true', 30000);
    await ev(`window.lumen.request('register', {model: ${js(host.model(NAME))}}).then(m => { state.models = m; renderModels(); renderPickers(); return 0; })`);
  });
  after(async () => { await app?.stop(); host?.close(); });

  test('the registered model is listed as not installed', async () => {
    const row = await ev(`(() => { const m = state.models.find(x => x.Name === ${js(NAME)}); return m && { installed: m.Installed, bytes: m.Bytes }; })()`);
    assert.deepEqual(row, { installed: false, bytes: host.bytes });
  });

  test('download starts like the Download button, shows the pill and the dock, pauses and resumes', async () => {
    // The Explore rows need Hugging Face's file listing; this is the function their Download button calls.
    await ev(`download(${js(NAME)}); 0`);
    await app.cdp.waitFor("!document.querySelector('#download-pill').hidden && document.querySelector('#download-pill').dataset.phase === 'downloading'", 20000);
    await app.cdp.waitFor("!document.querySelector('#download-dock').hidden", 10000);
    assert.equal(await ev("document.querySelector('#download-name').textContent"), NAME);
    await app.cdp.waitFor("document.querySelector('#download-fill').style.transform !== 'scaleX(0)' && document.querySelector('#download-meta').textContent.includes('MB')", 20000);
    await shot('downloading');
    // Pause with the dock button.
    await app.cdp.click('#download-toggle');
    await app.cdp.waitFor("document.querySelector('#download-pill').dataset.phase === 'paused'", 15000);
    const paused = (await list())[0];
    assert.equal(paused.phase, 'paused');
    assert.ok(paused.bytes < host.bytes, 'paused before the end: ' + paused.bytes);
    assert.equal(paused.resumable, true);
    await sleep(1200);
    const still = (await list())[0];
    assert.equal(still.phase, 'paused');
    assert.ok(still.bytes - paused.bytes < (9 << 20), 'no further progress while paused beyond in-flight chunks');
    await shot('paused');
    // Resume.
    await app.cdp.click('#download-toggle');
    await app.cdp.waitFor("['downloading','verifying','completed'].includes(document.querySelector('#download-pill').dataset.phase)", 15000);
  });

  test('completes with a verified file and the model becomes installed', async () => {
    await app.cdp.waitFor("document.querySelector('#download-pill').dataset.phase === 'completed' || document.querySelector('#download-pill').hidden", 120000);
    assert.equal(fs.statSync(modelFile()).size, host.bytes);
    assert.equal(await sha256(modelFile()), host.sha, 'the file on disk matches the SHA-256 the catalog promised');
    assert.equal(fs.existsSync(modelFile() + '.partial'), false);
    assert.equal(fs.existsSync(modelFile() + '.partial.json'), false);
    await app.cdp.waitFor(`state.models.find(m => m.Name === ${js(NAME)})?.Installed === true`, 15000);
    // The server saw a range request after the resume (it continued, it did not start over).
    assert.ok(host.state.requests.some(r => r.range && !r.range.startsWith('bytes=0-')), 'a ranged continuation: ' + JSON.stringify(host.state.requests.slice(-4)));
    await app.cdp.click('[data-page="settings"]');
    await app.cdp.click('[data-setting="library"]');
    await app.cdp.waitFor(`[...document.querySelectorAll('#model-list .repo-row, #model-list > *')].some(r => r.textContent.includes('Mock'))`, 10000);
    await shot('installed');
  });

  test('a file whose hash does not match is rejected and removed', async () => {
    const bad = { ...host.model('Corrupt model'), File: 'corrupt-model.gguf', Sha: 'a'.repeat(64), Bytes: host.bytes }; // the same host serves it; the promised hash is wrong
    await ev(`window.lumen.request('register', {model: ${js(bad)}}).then(m => { state.models = m; return 0; })`);
    const result = await ev(`window.lumen.downloads('start', {name: ${js(bad.Name)}}).then(r => ({ok: true, r}), e => ({ok: false, e: e.message}))`);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.match(result.e, /SHA-256|verification|failed/i);
    const dest = path.join(dataDir, 'models', 'a'.repeat(12) + '-corrupt-model.gguf');
    assert.equal(fs.existsSync(dest), false);
    assert.equal(fs.existsSync(dest + '.partial'), false, 'the partial file is removed');
  });

  test('no console errors', async () => { assert.deepEqual(app.cdp.errors, []); });
});
