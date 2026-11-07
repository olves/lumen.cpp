// Image generation through the real UI. Local engine: a compiled stand-in for stable-diffusion.cpp's sd-server.exe that speaks the same
// HTTP API (tests/ui/mocks.mjs) with sparse placeholder files for the model package, so no multi-GB model is downloaded. Cloud images:
// a mock OpenAI-compatible server. Real: the app, the image pipeline (engine start, job polling, preview, PNG storage, thumbnails,
// links to the chat, save, restart), the UI. Mock: the diffusion engine itself and the provider.
// NOT verified here: a real Z-Image model producing a picture (needs the multi-GB package), CUDA 12 / Vulkan device probing.
//   $env:LUMEN_SHELL='tauri'; node --test tests/ui/images.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launch, workRoot } from '../harness/launch.mjs';
import { prepareData } from './data.mjs';
import { buildSdServer, sparseFile, cloudServer, sleep } from './mocks.mjs';

const require = createRequire(import.meta.url);
const { PACKAGES } = require('../../app/imagegen.cjs');
// The pinned engine release is a private constant of imagegen.cjs; the data folder layout is <data>/image-runtime/<tag>/<kind>.
const TAG = /const TAG = '([^']+)'/.exec(fs.readFileSync(new URL('../../app/imagegen.cjs', import.meta.url), 'utf8'))[1];
const shell = process.env.LUMEN_SHELL || 'electron';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const js = JSON.stringify;
const mockDir = path.join(workRoot, 'mock-sd'); // compiled once, reused
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe(`images, local engine stand-in (${shell})`, () => {
  const runDir = path.join(workRoot, 'ui-tests', `images-${shell}-${stamp}`), dataDir = path.join(runDir, 'data'), saveDir = path.join(runDir, 'saved');
  let app;
  const ev = e => app.cdp.evaluate(e);
  const shot = n => app?.cdp.screenshot(path.join(runDir, n + '.png')).catch(() => {});
  const engineDir = path.join(dataDir, 'image-runtime', TAG, 'vulkan');
  const pkg = PACKAGES.find(p => p.id === 'z-image-turbo');
  const sdLog = () => { try { return fs.readFileSync(path.join(engineDir, 'requests.log'), 'utf8'); } catch { return ''; } };
  const startApp = async () => { app = await launch({ shell, dataDir, env: { LUMEN_TEST_SAVE_DIR: saveDir, LUMEN_MOCK_SD_STEPS: '12' } }); await app.cdp.waitFor('state.ready === true', 30000); };

  before(async () => {
    if (!fs.existsSync(path.join(mockDir, 'sd-server.exe'))) buildSdServer(mockDir);
    prepareData(dataDir, null);
    fs.mkdirSync(engineDir, { recursive: true }); fs.mkdirSync(saveDir, { recursive: true });
    fs.copyFileSync(path.join(mockDir, 'sd-server.exe'), path.join(engineDir, 'sd-server.exe'));
    fs.copyFileSync(path.join(mockDir, 'out.png'), path.join(engineDir, 'out.png'));
    fs.writeFileSync(path.join(engineDir, 'ready.json'), JSON.stringify({ tag: TAG, kind: 'vulkan', devices: ['Mock'], installed: new Date().toISOString() }));
    for (const f of pkg.files) sparseFile(path.join(dataDir, 'models', 'img-' + f.sha.slice(0, 12) + '-' + path.basename(f.file)), f.bytes);
    await startApp();
  });
  after(async () => { await app?.stop(); });

  test('status: engine installed, model package ready', async () => {
    const s = await ev("window.lumen.images('status')");
    assert.equal(s.engines.find(e => e.id === 'vulkan').installed, true);
    const p = s.packages.find(x => x.id === 'z-image-turbo');
    assert.equal(p.ready, true);
    assert.equal(p.missing, 0);
  });

  test('Settings -> Images shows the engine and the package as installed', async () => {
    await ev("openSettings('images'); 0");
    await app.cdp.waitFor("document.querySelector('#settings-page').textContent.includes('Z-Image')", 10000);
    await shot('settings');
  });

  test('Create image: chip, progress with live preview, picture under the reply', async () => {
    await ev("setPage('chat'); 0");
    await app.cdp.click('#add-button');
    await app.cdp.waitFor("!!document.querySelector('#create-image')", 5000);
    await app.cdp.click('#create-image');
    await app.cdp.waitFor("!!document.querySelector('.image-chip')", 10000);
    await app.cdp.type('#prompt', 'a red fox in the snow');
    await app.cdp.click('#send');
    await app.cdp.waitFor("!!document.querySelector('.image-progress')", 20000);
    await app.cdp.waitFor("document.querySelector('.image-progress .img-preview') && !document.querySelector('.image-progress .img-preview').hidden", 30000);
    assert.match(await ev("document.querySelector('.image-progress .img-progress-label').textContent"), /\d/);
    await shot('progress');
    await app.cdp.waitFor("!!document.querySelector('.message.assistant .gen-grid img')", 60000);
    await app.cdp.waitFor('state.busy === false', 30000);
    await shot('done');
    const g = await ev("state.chat.Messages.at(-1).Generated");
    assert.equal(g.engine, 'local');
    assert.equal(g.prompt, 'a red fox in the snow');
    assert.equal(g.images.length, 1);
    assert.deepEqual([g.images[0].width, g.images[0].height], [512, 384], 'the size of the PNG the engine returned');
    // Files: full PNG and thumbnail in generated/.
    const full = path.join(dataDir, 'generated', g.images[0].sha + '.png');
    assert.ok(fs.readFileSync(full).subarray(0, 4).equals(PNG_MAGIC));
    assert.ok(fs.existsSync(path.join(dataDir, 'generated', g.images[0].sha + '.thumb.png')));
    // The engine received the request: size for a square 1024, the prompt, the three model files.
    const log = sdLog();
    assert.match(log, /POST \/sdcpp\/v1\/img_gen .*a red fox in the snow/);
    assert.match(log, /"width":1024,"height":1024/);
    const args = fs.readFileSync(path.join(engineDir, 'args.txt'), 'utf8');
    for (const flag of ['--listen-ip\n127.0.0.1', '--diffusion-model', '--llm', '--vae']) assert.ok(args.includes(flag), flag + ' in ' + args.replace(/\n/g, ' '));
    // The chat model sees a short note, not pixels.
    assert.match(await ev("state.chat.Messages.at(-1).Content"), /^\[Image · Z-Image Turbo · Q4 · 512×384\]$/);
    // The image is shown from the app's own protocol.
    assert.equal(await ev("document.querySelector('.message.assistant .gen-grid img').naturalWidth > 0"), true);
  });

  test('Save writes the PNG through the save dialog', async () => {
    await ev("document.querySelector('.gen-actions button').click(); 0");
    const g = await ev("state.chat.Messages.at(-1).Generated");
    const file = path.join(saveDir, 'lumen-' + g.images[0].sha.slice(0, 8) + '.png');
    for (let i = 0; i < 50 && !fs.existsSync(file); i++) await sleep(100);
    assert.ok(fs.readFileSync(file).equals(fs.readFileSync(path.join(dataDir, 'generated', g.images[0].sha + '.png'))));
  });

  test('Stop cancels a running job and keeps a note', async () => {
    await ev("(state.chat.Model && 0, 0)");
    const before = await ev('state.chat.Messages.length');
    await app.cdp.type('#prompt', 'a slow picture');
    await app.cdp.click('#send');
    await app.cdp.waitFor("!!document.querySelector('.image-progress')", 20000);
    await app.cdp.waitFor("document.querySelector('.image-progress .img-progress-label').textContent.match(/\\d/)", 30000);
    await app.cdp.click('#send'); // the send button is Stop while the image works
    await app.cdp.waitFor('state.busy === false', 30000);
    const last = await ev("state.chat.Messages.at(-1)");
    assert.equal(last.Role, 'assistant');
    assert.equal(last.Interrupted, true);
    assert.match(last.Content, /stopped/i);
    assert.equal(await ev('state.chat.Messages.length'), before + 2);
    assert.match(sdLog(), /POST \/sdcpp\/v1\/jobs\/job\d+\/cancel/);
  });

  test('the picture stays linked to its reply after a restart', async () => {
    await app.stop();
    await startApp();
    await app.cdp.click('.history-item');
    await app.cdp.waitFor("!!document.querySelector('.message.assistant .gen-grid img')", 15000);
    assert.equal(await ev("document.querySelectorAll('.gen-grid img').length"), 1);
  });

  test('without the engine a clear message is shown (no silent failure)', async () => {
    await ev("window.lumen.images('remove-engine', {kind: 'vulkan'}).then(() => 0)");
    const r = await ev(`window.lumen.images('generate', {chat: {...state.chat, Messages: [...state.chat.Messages, {Role: 'user', Content: 'x', Interrupted: false}]}, prompt: 'x', options: {}}).then(() => 'ok', e => e.message)`);
    assert.match(r, /Install the image engine/);
  });

  test('no console errors', async () => { assert.deepEqual(app.cdp.errors, []); });
});

describe(`images, cloud provider mock (${shell})`, () => {
  const runDir = path.join(workRoot, 'ui-tests', `images-cloud-${shell}-${stamp}`), dataDir = path.join(runDir, 'data');
  let app, cloud;
  const ev = e => app.cdp.evaluate(e);

  before(async () => {
    cloud = await cloudServer();
    prepareData(dataDir, null);
    app = await launch({ shell, dataDir });
    await app.cdp.waitFor('state.ready === true', 30000);
  });
  after(async () => { await app?.stop(); cloud?.close(); });

  test('a cloud image model makes a picture; the provider got the prompt and key', async () => {
    await ev("window.lumen.connections('cloud', {enabled: true, consented: true}).then(() => 0)");
    await ev(`window.lumen.connections('provider', {provider: 'custom', base: ${js(cloud.base)}, label: 'Mock cloud', key: ${js(cloud.key)}, models: [${js(cloud.model)}]}).then(() => 0)`);
    await ev(`window.lumen.images('settings', {cloudModels: {custom: [${js(cloud.imageModel)}]}, model: ${js('cloud:custom/' + cloud.imageModel)}}).then(() => 0)`);
    await ev('Promise.all([loadImages(), loadConnections()]).then(() => 0)');
    await app.cdp.click('#add-button');
    await app.cdp.waitFor("!!document.querySelector('#create-image')", 5000);
    await app.cdp.click('#create-image');
    await app.cdp.waitFor("!!document.querySelector('.image-chip')", 10000);
    await app.cdp.type('#prompt', 'a lighthouse at dawn');
    await app.cdp.click('#send');
    await app.cdp.waitFor("!!document.querySelector('.message.assistant .gen-grid img')", 60000);
    await app.cdp.waitFor('state.busy === false', 30000);
    const g = await ev("state.chat.Messages.at(-1).Generated");
    assert.equal(g.engine, 'cloud');
    assert.deepEqual([g.images[0].width, g.images[0].height], [320, 192]);
    const req = cloud.requests.find(r => r.path === '/v1/images/generations');
    assert.equal(req.auth, 'Bearer ' + cloud.key);
    assert.equal(req.body.prompt, 'a lighthouse at dawn');
    assert.equal(req.body.model, cloud.imageModel);
    assert.ok(fs.existsSync(path.join(dataDir, 'generated', g.images[0].sha + '.png')));
  });

  test('turned off, cloud image models are refused', async () => {
    await ev("window.lumen.connections('cloud', {enabled: false}).then(() => 0)");
    const r = await ev(`window.lumen.images('generate', {chat: {...state.chat, Messages: [...state.chat.Messages, {Role: 'user', Content: 'again', Interrupted: false}]}, prompt: 'again', options: {model: ${js('cloud:custom/' + cloud.imageModel)}}}).then(() => 'ok', e => e.message)`);
    assert.match(r, /Cloud models are turned off/);
  });

  test('no console errors', async () => { assert.deepEqual(app.cdp.errors, []); });
});
