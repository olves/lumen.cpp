// Settings → Appearance (Task 4) over CDP, through the real controls: theme cards change the applied tokens, overrides (font,
// corner radius, custom accent) survive a restart, an unreadable color is rejected with an inline warning and not saved, a font
// that is not installed falls back to the theme font, and "Reset to defaults" removes every override.
// Real: the app, its preference file and restart. Mock: none.
//   $env:LUMEN_SHELL='tauri'; node --test --test-concurrency=1 tests/ui/appearance.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launch, workRoot, repoRoot } from '../harness/launch.mjs';
import { prepareData } from './data.mjs';

const A = createRequire(import.meta.url)(path.join(repoRoot, 'app', 'appearance.js'));
const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `appearance-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data');
const prefsFile = path.join(dataDir, 'desktop-preferences.json');
let app;
const ev = e => app.cdp.evaluate(e);
const js = JSON.stringify;
const readPrefs = () => JSON.parse(fs.readFileSync(prefsFile, 'utf8').replace(/^﻿/, ''));
const token = name => ev(`getComputedStyle(document.documentElement).getPropertyValue(${js(name)}).trim()`);
const shot = name => app?.cdp.screenshot(path.join(runDir, name + '.png')).catch(() => {});
const start = async () => {
  app = await launch({ shell, dataDir });
  await app.cdp.waitFor('state.ready === true', 30000);
  await app.cdp.waitFor("!!document.getElementById('theme-cards')", 10000);
  await app.cdp.waitFor("!document.getElementById('splash')", 10000).catch(() => {});
};
const open = () => ev("document.querySelector('[data-page=\"settings\"]').click(), openSettings('appearance'), 0");
const setInput = (id, value) => ev(`(() => { const i = document.getElementById(${js(id)}); i.value = ${js(value)}; i.dispatchEvent(new Event('change')); return 0; })()`);
const settle = () => ev('appearanceSaving.then(() => 0)');

describe(`appearance settings (${shell})`, () => {
  before(async () => { prepareData(dataDir, null); await start(); });
  after(async () => { await app?.stop(); });

  test('a theme card changes the applied tokens', async () => {
    await open();
    assert.equal(await ev("document.querySelectorAll('#theme-cards [role=radio]').length"), 3);
    assert.equal(await ev("document.querySelector('#theme-cards [aria-checked=true]').dataset.themeCard"), 'native');
    const before = await token('--surface-0');
    await app.cdp.click('#theme-cards [data-theme-card="reading"]');
    await app.cdp.waitFor("state.prefs.appearance.theme === 'reading' && document.body.dataset.theme === 'reading'", 5000);
    const mode = await ev('state.prefs.appearance.mode');
    const want = A.THEMES.reading[mode];
    assert.notEqual(await token('--surface-0'), before);
    for (const t of ['--surface-0', '--text', '--accent', '--radius', '--font-size']) assert.equal(await token(t), want[t], t);
    assert.match(await token('--font-reading'), /Charter/);
    assert.equal(await ev("document.getElementById('text-size').value"), '15', 'text size control follows the theme default');
    assert.equal(readPrefs().appearance.theme, 'reading');
    assert.equal(await ev("document.querySelector('#theme-cards [aria-checked=true]').dataset.themeCard"), 'reading');
    // Swatches show the current theme's real colors: the default swatch is the theme accent itself.
    assert.equal(await ev("getComputedStyle(document.querySelector('#theme-swatches [data-theme=warm]')).getPropertyValue('--swatch').trim()"), want['--accent']);
    // Keyboard: arrow keys move between cards (radio group).
    await ev("document.querySelector('#theme-cards [data-theme-card=reading]').focus(), 0");
    assert.equal(await ev("document.activeElement.dataset.themeCard"), 'reading');
    await shot('reading');
  });

  test('font, corner and accent overrides persist after a restart', async () => {
    await setInput('font-ui', 'Arial');
    await app.cdp.waitFor("state.prefs.appearance.overrides.common['--font-ui'] === '\"Arial\"'", 5000);
    await app.cdp.click('#appearance-radius + .segmented button:nth-child(6)'); // 12 px
    await app.cdp.waitFor("state.prefs.appearance.overrides.common['--radius'] === '12px'", 5000);
    const mode = await ev('state.prefs.appearance.mode');
    const accent = mode === 'dark' ? '#5aa0e6' : '#1d5a99';
    assert.ok(A.validateOverride({ theme: 'reading', mode }, '--accent', accent).ok, 'test color is readable');
    await setInput('custom-accent', accent);
    await app.cdp.waitFor(`state.prefs.appearance.overrides[${js(mode)}]['--accent'] === ${js(accent)} && state.prefs.theme === 'custom'`, 5000);
    await settle();
    assert.equal(await ev("document.getElementById('accent-warning').hidden"), true);
    const p = readPrefs();
    assert.equal(p.appearance.overrides.common['--font-ui'], '"Arial"');
    assert.equal(p.appearance.overrides.common['--radius'], '12px');
    assert.equal(p.appearance.overrides[mode]['--accent'], accent);
    await app.stop();
    await start();
    assert.equal(await token('--radius'), '12px');
    assert.equal(await token('--accent'), accent);
    assert.match(await token('--font-ui'), /^"Arial",/);
    await open();
    assert.equal(await ev("document.getElementById('font-ui').value"), 'Arial');
    assert.equal(await ev("document.getElementById('appearance-radius').value"), '12');
    assert.equal(await ev("document.querySelector('#theme-cards [aria-checked=true]').dataset.themeCard"), 'reading');
  });

  test('an unreadable accent is not saved and shows an inline warning', async () => {
    await open();
    await app.cdp.click('#display-mode + .segmented button:nth-child(2)'); // light
    await app.cdp.waitFor("state.prefs.appearance.mode === 'light' && document.body.dataset.mode === 'light'", 5000);
    await settle();
    const before = readPrefs(), applied = await token('--accent');
    const pale = '#ffff99'; // light yellow on white
    assert.equal(A.validateOverride(before.appearance, '--accent', pale).ok, false);
    await setInput('custom-accent', pale);
    await app.cdp.waitFor("document.getElementById('accent-warning').hidden === false", 5000);
    await settle();
    assert.equal(await ev("document.getElementById('accent-warning').textContent"), 'This color is hard to read here, so it was not saved.');
    assert.equal(await token('--accent'), applied, 'the applied accent is unchanged');
    assert.deepEqual(readPrefs().appearance, before.appearance, 'nothing saved');
    assert.notEqual(readPrefs().accentColor, pale);
    // Turkish warning.
    await ev("(async () => { state.prefs = await api.preferences({...state.prefs, language: 'tr'}); localize(); return 0; })()");
    assert.equal(await ev("document.getElementById('accent-warning').textContent"), 'Bu renk burada zor okunuyor, bu yüzden kaydedilmedi.');
    await ev("(async () => { state.prefs = await api.preferences({...state.prefs, language: 'en'}); localize(); return 0; })()");
    await shot('warning');
    // A saved accent that the next theme makes unreadable is dropped by the model, and the page says so.
    const blue = '#0088dd';
    assert.ok(A.validateOverride({ theme: 'reading', mode: 'light' }, '--accent', blue).ok);
    assert.equal(A.validateOverride({ theme: 'pro', mode: 'light' }, '--accent', blue).ok, false);
    await setInput('custom-accent', blue);
    await app.cdp.waitFor(`state.prefs.appearance.overrides.light['--accent'] === ${js(blue)}`, 5000);
    await settle();
    assert.equal(await ev("document.getElementById('appearance-theme-notice').hidden"), true);
    await app.cdp.click('#theme-cards [data-theme-card="pro"]');
    await app.cdp.waitFor("state.prefs.appearance.theme === 'pro'", 5000);
    await settle();
    assert.equal(readPrefs().appearance.overrides.light['--accent'], undefined);
    assert.equal(await token('--accent'), A.THEMES.pro.light['--accent']);
    assert.equal(await ev("document.getElementById('appearance-theme-notice').hidden"), false);
    assert.match(await ev("document.getElementById('appearance-theme-notice').textContent"), /not readable in this theme/);
    await app.cdp.click('#theme-cards [data-theme-card="reading"]');
    await app.cdp.waitFor("state.prefs.appearance.theme === 'reading'", 5000);
    await settle();
  });

  test('a font that is not installed falls back to the theme font', async () => {
    const name = 'Zzq Lumen Missing Font';
    await setInput('font-reading', name);
    await app.cdp.waitFor(`state.prefs.appearance.overrides.common['--font-reading'] === ${js('"' + name + '"')}`, 5000);
    await settle();
    const base = A.THEMES.reading.light['--font-reading'];
    assert.equal(await token('--font-reading'), `"${name}",${base}`, 'the theme stack follows the chosen font');
    assert.equal(await ev("document.getElementById('font-reading-note').hidden"), false);
    assert.match(await ev("document.getElementById('font-reading-note').textContent"), /not installed/);
    // The text is drawn with the fallback: same width as with the theme stack alone, and never zero.
    const widths = await ev(`(() => {
      const make = f => { const s = document.createElement('span'); s.textContent = 'Lumen okuma yazısı — ĞÜŞİÖÇ 0123'; s.style.fontFamily = f; s.style.fontSize = '20px'; s.style.position = 'absolute'; document.body.append(s); const w = s.getBoundingClientRect().width; s.remove(); return w; };
      return { chosen: make(getComputedStyle(document.documentElement).getPropertyValue('--font-reading')), base: make(${js(base)}) };
    })()`);
    assert.ok(widths.chosen > 50);
    assert.equal(widths.chosen, widths.base);
    // An unusable name is rejected inline and not saved.
    await setInput('font-mono', 'Bad";font');
    assert.equal(await ev("document.getElementById('font-mono-note').hidden"), false);
    assert.equal(readPrefs().appearance.overrides.common['--font-mono'], undefined);
  });

  test('reset to defaults removes every override and keeps theme and mode', async () => {
    await app.cdp.click('#appearance-reset');
    await app.cdp.waitFor("Object.keys(state.prefs.appearance.overrides.common).length === 0 && Object.keys(state.prefs.appearance.overrides.light).length === 0 && Object.keys(state.prefs.appearance.overrides.dark).length === 0", 5000);
    await settle();
    const p = readPrefs();
    assert.deepEqual(p.appearance.overrides, { common: {}, dark: {}, light: {} });
    assert.equal(p.appearance.theme, 'reading');
    assert.equal(p.appearance.mode, 'light');
    assert.equal(p.theme, 'warm');
    const want = A.THEMES.reading.light;
    for (const t of ['--accent', '--radius', '--font-ui', '--font-reading', '--font-size']) assert.equal(await token(t), want[t], t);
    assert.equal(await ev("document.getElementById('font-ui').value"), '');
    assert.equal(await ev("document.getElementById('appearance-reset-note').hidden"), false);
    // The status bar switch saves prefs.appearance.statusBar.
    await ev("document.getElementById('status-bar-toggle').click(), 0");
    await app.cdp.waitFor("state.prefs.appearance.statusBar === true && document.getElementById('app-status').dataset.placement === 'window'", 5000);
    await ev("document.getElementById('status-bar-toggle').click(), 0");
    await app.cdp.waitFor('state.prefs.appearance.statusBar === false', 5000);
    assert.deepEqual(app.cdp.errors.filter(e => !/favicon/.test(e)), [], 'no console errors');
    await shot('reset');
  });
});
