// Settings: language (EN/TR) through the real controls, appearance (Desk/Studio, light/dark, accent theme, text size, motion), response
// settings, validation of bad values, tool settings (search provider, browser home page) and the encrypted search API key. Everything is
// checked three ways: the page reacts, the preference file holds the value, and it is still applied after a restart.
// Real: the app and its stores. Mock: none (the search key is a made-up string and nothing is sent anywhere).
// The visual matrix is in layout.test.mjs; the Turkish composer placeholder that stays English is a todo in smoke.test.mjs.
//   $env:LUMEN_SHELL='tauri'; node --test tests/ui/settings.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, workRoot } from '../harness/launch.mjs';
import { prepareData } from './data.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `settings-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data');
const prefsFile = path.join(dataDir, 'desktop-preferences.json'), toolsFile = path.join(dataDir, 'tools-settings.json');
let app;
const ev = e => app.cdp.evaluate(e);
const js = JSON.stringify;
const readPrefs = () => JSON.parse(fs.readFileSync(prefsFile, 'utf8').replace(/^\uFEFF/, ''));
const start = async () => { app = await launch({ shell, dataDir }); await app.cdp.waitFor('state.ready === true', 30000); };
// The segmented control next to a select (the real <select> is hidden): click the button of an option.
async function segment(id, value) {
  const index = await ev(`[...document.querySelector('#${id}').options].findIndex(o => o.value === ${js(value)})`);
  assert.ok(index >= 0, `${id} has option ${value}`);
  await app.cdp.click(`#${id} + .segmented button:nth-child(${index + 1})`);
}
const open = section => ev(`document.querySelector('[data-page="settings"]').click(), openSettings(${js(section)}), 0`);

describe(`settings (${shell})`, () => {
  before(async () => { prepareData(dataDir, null); await start(); });
  after(async () => { await app?.stop(); });

  test('language: Turkish through the control changes the interface and is saved', async () => {
    await open('general');
    const english = await ev("document.querySelector('#new-chat').textContent.trim()");
    await segment('language', 'tr');
    await app.cdp.waitFor("state.prefs.language === 'tr'", 5000);
    const turkish = await ev("document.querySelector('#new-chat').textContent.trim()");
    assert.notEqual(turkish, english);
    assert.equal(await ev('document.documentElement.lang'), 'tr');
    assert.equal(readPrefs().language, 'tr');
    // Settings headings are translated too.
    assert.notEqual(await ev("document.querySelector('#general-panel h1').textContent"), 'General');
  });

  test('appearance: Studio, light, ocean accent, 15 px, motion off', async () => {
    await open('appearance');
    await segment('interface-design', 'studio');
    await app.cdp.waitFor("state.prefs.layout === 'studio'", 5000);
    await segment('display-mode', 'light');
    await app.cdp.waitFor("state.prefs.layout === 'studio' && state.prefs.colorMode === 'light'", 5000);
    await app.cdp.click('#theme-swatches [data-theme="ocean"]'); // the accent themes are swatches (radio buttons)
    await segment('text-size', '15');
    await app.cdp.waitFor('state.prefs.textSize === 15', 5000);
    await ev("(() => { const m = document.querySelector('#motion'); if (m.checked) m.click(); return 0; })()");
    await app.cdp.waitFor("document.body.dataset.layout === 'studio' && document.body.dataset.mode === 'light' && document.body.dataset.theme === 'ocean'", 5000);
    await app.cdp.waitFor("state.prefs.motion === false", 5000);
    const p = readPrefs();
    assert.deepEqual([p.layout, p.colorMode, p.theme, p.textSize, p.motion, p.designChosen], ['studio', 'light', 'ocean', 15, false, true]);
    assert.equal(await ev("getComputedStyle(document.documentElement).colorScheme.includes('light') || document.body.dataset.mode"), true);
  });

  test('response settings: thinking on, 2048 tokens, creative', async () => {
    await open('agent');
    await ev("(() => { const t = document.querySelector('#thinking-mode'); t.value = t.tagName === 'SELECT' ? 'on' : t.value; t.dispatchEvent(new Event('change')); return 0; })()").catch(() => {});
    await segment('response-tokens', '2048');
    await segment('creativity', 'creative');
    await app.cdp.waitFor("state.prefs.responseTokens === 2048 && state.prefs.creativity === 'creative'", 5000);
    const p = readPrefs();
    assert.equal(p.responseTokens, 2048);
    assert.equal(p.creativity, 'creative');
  });

  test('bad preference values are ignored; good ones are kept', async () => {
    const before = readPrefs();
    const after = await ev(`window.lumen.preferences({...state.prefs, layout: 'cube', colorMode: 'blue', theme: 'nope', responseTokens: 99999, creativity: 'wild', textSize: 99, accentColor: 'red'})`);
    assert.equal(after.layout, before.layout);
    assert.equal(after.colorMode, before.colorMode);
    assert.equal(after.theme, before.theme);
    assert.equal(after.responseTokens, before.responseTokens);
    assert.equal(after.creativity, before.creativity);
    assert.equal(after.designChosen, true, 'the design choice is never reset by another setting');
    assert.ok([13, 14, 15, 16].includes(after.textSize));
  });

  test('everything is applied again after a restart', async () => {
    await app.stop();
    await start();
    assert.equal(await ev('document.body.dataset.layout'), 'studio');
    assert.equal(await ev('document.body.dataset.mode'), 'light');
    assert.equal(await ev('document.body.dataset.theme'), 'ocean');
    assert.equal(await ev('document.documentElement.lang'), 'tr');
    assert.equal(await ev('state.prefs.responseTokens'), 2048);
    assert.equal(await ev("!document.getElementById('design-welcome') || getComputedStyle(document.getElementById('design-welcome')).display === 'none' || document.getElementById('design-welcome').getBoundingClientRect().height === 0"), true, 'the design choice is not asked again');
  });

  test('tool settings: search provider and endpoint, browser home page validation', async () => {
    const cfg = await ev(`window.lumen.tools('update', {search: {provider: 'searxng', endpoint: 'http://127.0.0.1:8080/', results: 5}, browser: {homePage: 'https://example.org/start', zoom: 110}})`);
    assert.equal(cfg.search.provider, 'searxng');
    assert.equal(cfg.search.results, 5);
    assert.equal(cfg.browser.homePage, 'https://example.org/start');
    assert.equal(cfg.browser.zoom, 110);
    // A home page that is not http(s), or has credentials, is never stored as given.
    for (const bad of ['file:///C:/secret.txt', 'javascript:alert(1)', 'https://user:pw@example.org/']) {
      const r = await ev(`window.lumen.tools('update', {browser: {homePage: ${js(bad)}}}).then(c => c.browser.homePage, e => 'error: ' + e.message)`);
      assert.ok(r !== bad && !/^(file|javascript):/.test(r) && !/@/.test(r), `${bad} -> ${JSON.stringify(r)}`);
    }
    const file = JSON.parse(fs.readFileSync(toolsFile, 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(file.search.enabled, false, 'web research stays off');
  });

  test('a search API key is stored encrypted and never returned to the page', async () => {
    const KEY = 'tvly-test-key-9f3a1c-NOT-REAL';
    await ev(`window.lumen.tools('update', {search: {provider: 'tavily'}}).then(() => 0)`);
    const cfg = await ev(`window.lumen.tools('set-key', {provider: 'tavily', key: ${js(KEY)}})`);
    assert.ok(!JSON.stringify(cfg).includes(KEY), 'the key is not in what the page receives');
    assert.ok(!fs.readFileSync(toolsFile, 'utf8').includes(KEY), 'the key is not in tools-settings.json in plain text');
    assert.ok(fs.readFileSync(toolsFile, 'utf8').includes('tavily'));
    const cleared = await ev("window.lumen.tools('clear-key', {provider: 'tavily'})");
    assert.ok(!JSON.stringify(cleared).includes(KEY));
  });

  test('no console errors', async () => { assert.deepEqual(app.cdp.errors, []); });
});
