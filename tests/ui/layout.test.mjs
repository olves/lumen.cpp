// Visual matrix: theme (native/reading/pro) x Light/Dark x English/Turkish over the chat (with a conversation that stresses the layout: a wide
// table, a long code line, a long unbroken URL) and every Settings section, then 800x600. Per cell: the right layout/mode/language
// is applied, the page does not overflow the window sideways, text is translated, and there are no console errors. Screenshots go to
// <run>/shots for a human to look at (they are not compared automatically).
// Skipped on purpose: Settings -> Explore (it loads Hugging Face over the network).
// The Turkish composer placeholder that stays English is a known product bug and is kept as a todo in smoke.test.mjs.
//   $env:LUMEN_SHELL='tauri'; node --test tests/ui/layout.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { launch, workRoot } from '../harness/launch.mjs';
import { prepareData } from './data.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `layout-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data'), shots = path.join(runDir, 'shots');
const CHAT_ID = crypto.randomBytes(16).toString('hex');
const SKIP_SETTINGS = new Set(['explore']);
let app;
const ev = e => app.cdp.evaluate(e);

const TABLE = '| Model | Quant | Size | Speed | Notes |\n|---|---|---|---|---|\n' + Array.from({ length: 6 }, (_, i) => `| Sample model ${i} with a long name | Q4_K_M | ${i + 1}.2 GB | ${40 + i} tok/s | a rather long note that makes this cell wide ${'x'.repeat(30)} |`).join('\n');
const CODE = '```js\nconst veryLongLine = "' + 'abcdefghij'.repeat(30) + '";\nfunction f() { return veryLongLine.length; }\n```';
const REPLY = `Merhaba! Here is a **wide** answer — şğüıöç İI.\n\n${TABLE}\n\n${CODE}\n\nA link: https://example.com/${'very-long-path-segment/'.repeat(8)}end\n\n- one\n- two\n\n> a quote`;

function seed() {
  prepareData(dataDir, null);
  fs.mkdirSync(path.join(dataDir, 'chats'), { recursive: true });
  const chat = { Id: CHAT_ID, Title: 'Layout sample', Model: 'Test model', SystemPrompt: '', Updated: new Date().toISOString(),
    Messages: [{ Role: 'user', Content: 'Show me a wide answer', Interrupted: false }, { Role: 'assistant', Content: REPLY, Interrupted: false }] };
  fs.writeFileSync(path.join(dataDir, 'chats', CHAT_ID + '.json'), '﻿' + JSON.stringify(chat), 'utf8');
}
// One setting at a time: each change is saved asynchronously from the current preferences, so two changes made within the same few
// milliseconds (which a person cannot do) could overwrite each other. Waits until the page shows the new value.
const PREF = { language: 'language', 'interface-design': 'appearance.theme', 'display-mode': 'appearance.mode' };
const setSelect = async (id, value) => {
  await ev(`(() => { const s = document.getElementById(${JSON.stringify(id)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change')); return 0; })()`);
  await app.cdp.waitFor(`state.prefs.${PREF[id]} === ${JSON.stringify(value)}`, 5000);
  await new Promise(r => setTimeout(r, 150));
};
// Elements that stick out of the window to the right (or left) and are not inside a scrolling/clipping container.
const OVERFLOW = `(() => {
  const W = innerWidth, bad = [];
  const clipped = el => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true; } return false; };
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    if ((r.right > W + 1 || r.left < -1) && !clipped(el)) bad.push((el.id ? '#' + el.id : el.tagName.toLowerCase()) + '.' + String(el.className).split(' ')[0] + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
    if (bad.length > 5) break;
  }
  return { scroll: document.documentElement.scrollWidth, body: document.body.scrollWidth, w: W, bad };
})()`;

async function checkCell(label, theme, mode, lang) {
  const o = await ev(OVERFLOW);
  assert.ok(o.scroll <= o.w && o.body <= o.w, `${label}: horizontal overflow ${JSON.stringify(o)}`);
  assert.deepEqual(o.bad, [], `${label}: elements outside the window`);
  assert.equal(await ev('document.body.dataset.theme'), theme, label);
  assert.equal(await ev('document.documentElement.dataset.theme'), theme, label);
  assert.equal(await ev('document.body.dataset.mode'), mode, label);
  assert.equal(await ev('document.documentElement.lang'), lang, label);
}

describe(`layout matrix (${shell})`, () => {
  before(async () => {
    seed();
    fs.mkdirSync(shots, { recursive: true });
    app = await launch({ shell, dataDir });
    await app.cdp.waitFor('state.ready === true', 30000);
    await app.cdp.waitFor("[...document.querySelectorAll('#history .history-item')].some(b => b.title === 'Layout sample')", 15000);
    await ev("[...document.querySelectorAll('#history .history-item')].find(b => b.title === 'Layout sample').click(); 0");
    await app.cdp.waitFor(`state.chat?.Id === '${CHAT_ID}' && document.querySelectorAll('.message.assistant').length === 1`, 15000);
  });
  after(async () => { await app?.stop(); });

  const sections = [];
  test('collect the settings sections', async () => {
    const list = await ev("[...document.querySelectorAll('#settings-nav [data-setting]')].map(b => b.dataset.setting)");
    assert.ok(list.length >= 10, 'sections: ' + list.join(','));
    sections.push(...list.filter(s => !SKIP_SETTINGS.has(s)));
  });

  for (const lang of ['en', 'tr'])
    for (const layout of ['native', 'reading', 'pro'])
      for (const mode of ['dark', 'light']) {
        const label = `${layout}/${mode}/${lang}`;
        test(`${label}: chat and every settings section`, { timeout: 120000 }, async () => {
          await setSelect('language', lang);
          await app.cdp.waitFor(`state.prefs.language === '${lang}'`, 5000);
          await setSelect('interface-design', layout);
          await setSelect('display-mode', mode);
          await app.cdp.waitFor(`document.body.dataset.theme === '${layout}' && document.body.dataset.mode === '${mode}'`, 5000);
          // Chat
          await ev("setPage('chat'); 0");
          await app.cdp.waitFor("document.querySelectorAll('.message.assistant').length === 1", 5000);
          await checkCell(label + ' chat', layout, mode, lang);
          await app.cdp.screenshot(path.join(shots, `${label.replace(/\//g, '-')}-chat.png`));
          // Text is in the chosen language: the sidebar's new-chat button differs between languages.
          const nav = await ev("document.querySelector('#new-chat').textContent.trim()");
          assert.ok(nav.length > 0);
          globalThis.__navText = globalThis.__navText || {};
          globalThis.__navText[lang] = nav;
          // Settings sections
          await ev("document.querySelector('[data-page=\"settings\"]').click(); 0");
          for (const s of sections) {
            await ev(`openSettings(${JSON.stringify(s)}); 0`);
            await app.cdp.waitFor("!document.querySelector('#settings-page').hidden", 5000);
            await checkCell(`${label} settings/${s}`, layout, mode, lang);
          }
          await app.cdp.screenshot(path.join(shots, `${label.replace(/\//g, '-')}-settings.png`));
          assert.deepEqual(app.cdp.errors, [], label + ' console errors');
        });
      }

  test('Turkish text differs from English text', async () => {
    assert.notEqual(globalThis.__navText.en, globalThis.__navText.tr, JSON.stringify(globalThis.__navText));
  });

  test('800x600: chat and settings (three themes, dark and light, both languages)', { timeout: 180000 }, async () => {
    // Electron's DevTools endpoint has no Browser.setWindowBounds, so the 800x600 viewport is emulated.
    await app.cdp.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
    await app.cdp.waitFor('window.innerWidth === 800', 5000);
    for (const lang of ['en', 'tr']) for (const layout of ['native', 'reading', 'pro']) for (const mode of ['dark', 'light']) {
      const label = `800x600 ${layout}/${mode}/${lang}`;
      await setSelect('language', lang); await setSelect('interface-design', layout); await setSelect('display-mode', mode);
      await app.cdp.waitFor(`document.body.dataset.theme === '${layout}' && document.body.dataset.mode === '${mode}' && state.prefs.language === '${lang}'`, 5000);
      await ev("setPage('chat'); 0");
      await checkCell(label + ' chat', layout, mode, lang);
      await app.cdp.screenshot(path.join(shots, `${label.replace(/[ /]/g, '-')}-chat.png`));
      await ev("document.querySelector('[data-page=\"settings\"]').click(); 0");
      for (const s of ['general', 'appearance', 'library', 'runtime']) {
        await ev(`openSettings(${JSON.stringify(s)}); 0`);
        await checkCell(`${label} settings/${s}`, layout, mode, lang);
      }
      assert.equal(await ev('innerHeight'), 600);
    }
    await app.cdp.send('Emulation.clearDeviceMetricsOverride');
    assert.deepEqual(app.cdp.errors, []);
  });
});
