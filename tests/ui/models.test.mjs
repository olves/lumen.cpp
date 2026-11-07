// Models: the composer's model menu (logos, filter, keyboard, "download needed" tag, selection kept in the chat), the Library page,
// memory-fit and context information from the core. Downloading is in download.test.mjs; searching Hugging Face needs the internet
// and is not part of this suite (NOT verified here: Explore collections, Best fit, MTP filter - they are network-bound).
// Real: the app, the installed chat model (hard-linked; needs one). Mock: one catalog entry that is not installed (registered offline).
//   $env:LUMEN_SHELL='tauri'; node --test tests/ui/models.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, workRoot } from '../harness/launch.mjs';
import { pickModel, prepareData } from './data.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `models-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data');
const model = pickModel();
const NO_MODEL = model ? false : 'no installed model';
const MISSING = 'Offline sample model Q4';
let app, installed;
const ev = e => app.cdp.evaluate(e);
const js = JSON.stringify;
const shot = n => app?.cdp.screenshot(path.join(runDir, n + '.png')).catch(() => {});
const options = () => ev("[...document.querySelectorAll('#model-options .model-option')].map(o => ({ name: o.querySelector('strong').textContent, small: o.querySelector('small').textContent, selected: o.classList.contains('selected'), aria: o.getAttribute('aria-selected'), logo: !!o.querySelector('.model-logo, img, svg, span') }))");

describe(`models (${shell})`, { skip: NO_MODEL }, () => {
  before(async () => {
    prepareData(dataDir, model);
    app = await launch({ shell, dataDir });
    await app.cdp.waitFor('state.ready === true', 30000);
    await ev(`window.lumen.request('register', {model: {Name: ${js(MISSING)}, Repo: 'lumen-test/offline-sample', File: 'offline-sample-q4.gguf', Sha: '${'b'.repeat(64)}', Bytes: 123456789}}).then(m => { state.models = m; renderPickers(); return 0; })`);
    installed = await ev("state.models.filter(m => m.Installed && !m.Cloud).map(m => m.Name)");
  });
  after(async () => { await app?.stop(); });

  test('the installed model is selected and the menu is closed', async () => {
    assert.ok(installed.length >= 1);
    assert.equal(await ev("document.querySelector('#model-menu').hidden"), true);
    assert.equal(await ev("document.querySelector('#model-trigger').getAttribute('aria-expanded')"), 'false');
    assert.ok((await ev("document.querySelector('#selected-model-name').textContent")).length > 0);
  });

  test('the menu lists installed and not-installed models with the right tags', async () => {
    await app.cdp.click('#model-trigger');
    assert.equal(await ev("document.querySelector('#model-menu').hidden"), false);
    assert.equal(await ev("document.querySelector('#model-trigger').getAttribute('aria-expanded')"), 'true');
    const list = await options();
    const sample = list.find(o => o.name.includes('Offline sample'));
    assert.ok(sample, 'the catalog entry is listed: ' + JSON.stringify(list.map(o => o.name)));
    assert.match(sample.small, /Download needed|First download|download/i);
    const ready = list.find(o => o.selected);
    assert.ok(ready, 'one option is selected');
    assert.equal(ready.aria, 'true');
    assert.match(ready.small, /Ready/i);
    assert.equal(list.filter(o => o.selected).length, 1);
    await shot('menu');
  });

  test('the filter narrows the list; no match says so', async () => {
    await app.cdp.type('#model-filter', 'offline sample');
    assert.deepEqual((await options()).map(o => o.name.includes('Offline sample')), [true]);
    await ev("(document.querySelector('#model-filter').value = 'zzzz-nothing', document.querySelector('#model-filter').dispatchEvent(new Event('input')), 0)");
    assert.equal((await options()).length, 0);
    assert.equal(await ev("!!document.querySelector('#model-options .model-menu-empty')"), true);
  });

  test('Escape closes the menu', async () => {
    await app.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await app.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await app.cdp.waitFor("document.querySelector('#model-menu').hidden === true", 3000);
  });

  test('choosing a not-installed model shows the download note; choosing the installed one restores it', async () => {
    await app.cdp.click('#model-trigger');
    await ev("[...document.querySelectorAll('#model-options .model-option')].find(o => o.textContent.includes('Offline sample')).click(); 0");
    await app.cdp.waitFor(`state.chat.Model === ${js(MISSING)}`, 5000);
    assert.equal(await ev("document.querySelector('#model-menu').hidden"), true);
    assert.match(await ev("document.querySelector('#selected-model-name').textContent"), /Offline sample/);
    assert.match(await ev("document.querySelector('#model-note').textContent"), /download/i);
    await app.cdp.click('#model-trigger');
    await ev(`(() => { const want = ${js(installed[0])}; const o = [...document.querySelectorAll('#model-options .model-option')].find(x => x.title && x.querySelector('small').textContent.includes('Ready')); o.click(); })(); 0`);
    await app.cdp.waitFor(`state.chat.Model === ${js(installed[0])}`, 5000);
  });

  test('the Library page lists the installed models with sizes', async () => {
    await app.cdp.click('[data-page="settings"]');
    await app.cdp.click('[data-setting="library"]');
    await app.cdp.waitFor("document.querySelectorAll('#model-list > *').length > 0", 5000);
    const count = Number(await ev("document.querySelector('#settings-model-count').textContent"));
    assert.equal(count, installed.length);
    assert.match(await ev("document.querySelector('#model-list').textContent"), /GB|MB/);
    assert.ok(!(await ev("document.querySelector('#model-list').textContent")).includes('Offline sample'), 'not-installed models are not in the Library');
    await shot('library');
  });

  test('the core reports memory fit and the context for the installed model', async () => {
    const info = await ev(`window.lumen.modelsInfo('context', {model: ${js(installed[0])}})`);
    assert.ok([2048, 4096, 8192, 16384, 32768].includes(info.value), JSON.stringify(info));
    assert.ok(['auto', 'manual'].includes(info.mode));
    const fit = await ev(`window.lumen.modelsInfo('fit', {items: [{key: 'a', name: ${js(installed[0])}, bytes: ${await ev(`state.models.find(m => m.Name === ${js(installed[0])}).Bytes`)}}, {key: 'b', name: ${js(MISSING)}, bytes: 123456789}]})`);
    assert.ok(fit.estimates.a && fit.estimates.b);
    assert.ok(['gpu', 'hybrid', 'cpu', 'strain', 'unknown'].includes(fit.estimates.a.placement), JSON.stringify(fit.estimates.a));
    assert.equal(fit.estimates.a.contextIncluded, true, 'installed: the GGUF shape and the context are counted');
    assert.notEqual(fit.estimates.b.contextIncluded, true, 'not installed: file size only');
    assert.ok(fit.hardware.ramTotal > 0);
  });

  test('the chosen model is stored with the conversation', { timeout: 300000 }, async () => {
    await ev("setPage('chat'); 0");
    await app.cdp.type('#prompt', 'Merhaba');
    await app.cdp.click('#send');
    await app.cdp.waitFor("document.querySelectorAll('.message.assistant').length >= 1", 120000);
    await app.cdp.waitFor('state.busy === false', 240000);
    const id = await ev('state.chat.Id');
    const file = path.join(dataDir, 'chats', id + '.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    assert.equal(saved.Model, installed[0]);
  });

  test('no console errors', async () => { assert.deepEqual(app.cdp.errors, []); });
});
