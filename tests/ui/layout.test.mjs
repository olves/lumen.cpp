// Visual and accessibility matrix: theme (native/reading/pro) x Light/Dark x English/Turkish over the chat (with a conversation
// that stresses the layout: a wide table, a long code line, a long unbroken URL) and every Settings section, then 800x600 and
// the default window at 150% Windows scaling. Per cell: the right theme/mode/language is applied, the page does not overflow
// sideways, token contrast pairs pass (>=4.5:1 text, >=3:1 UI), every visible control is focusable, keyboard focus reaches the
// main controls with a visible ring, and there are no console errors. Screenshots for every theme x mode go to
// <work>/ui-shots/final for a human to look at (they are not compared automatically).
// Skipped on purpose: Settings -> Explore (it loads Hugging Face over the network).
// The Turkish composer placeholder is translated (translations.composerPlaceholder; smoke.test.mjs checks the exact text).
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
const dataDir = path.join(runDir, 'data'), shots = path.join(workRoot, 'ui-shots', 'final');
const slug = text => String(text).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
const shotName = (label, kind) => path.join(shots, `${shell}-${slug(label)}-${kind}.png`);
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

// Contrast of the tokens actually applied to :root (not just the theme table): text pairs >=4.5:1, UI/focus >=3:1.
const CONTRAST = `(() => {
  const A = globalThis.LumenAppearance, cs = getComputedStyle(document.documentElement), value = name => cs.getPropertyValue(name).trim();
  const bad = [];
  for (const p of A.PAIRS) {
    const fg = value(p.fg), bg = value(p.bg), ratio = A.contrast(fg, bg);
    if (!(ratio >= p.min)) bad.push({ fg: p.fg, bg: p.bg, fgValue: fg, bgValue: bg, ratio: Math.round(ratio * 100) / 100, min: p.min });
  }
  return bad;
})()`;
// Every visible, enabled, tabbable control accepts keyboard focus (script focus; the ring is checked with real Tab presses below).
const FOCUSABLE = `(() => {
  const failed = []; let tested = 0;
  for (const e of document.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')) {
    // checkVisibility() also excludes the content of a closed <details> (Chromium still reports a rect for it).
    const visible = e.checkVisibility ? e.checkVisibility({ checkVisibilityCSS: true }) : e.getClientRects().length > 0;
    if (!visible || e.disabled || e.tabIndex < 0 || e.closest('[inert]') || e.closest('[hidden]')) continue;
    tested++;
    e.focus({ preventScroll: true });
    if (document.activeElement !== e) failed.push(e.id || e.tagName + '.' + String(e.className).split(' ')[0]);
  }
  document.activeElement?.blur();
  return { tested, failed };
})()`;

const settingsVisible = () => app.cdp.waitFor("getComputedStyle(document.getElementById('settings-page')).opacity === '1'", 5000);

async function checkCell(label, theme, mode, lang) {
  const o = await ev(OVERFLOW);
  assert.ok(o.scroll <= o.w && o.body <= o.w, `${label}: horizontal overflow ${JSON.stringify(o)}`);
  assert.deepEqual(o.bad, [], `${label}: elements outside the window`);
  assert.equal(await ev('document.body.dataset.theme'), theme, label);
  assert.equal(await ev('document.documentElement.dataset.theme'), theme, label);
  assert.equal(await ev('document.body.dataset.mode'), mode, label);
  assert.equal(await ev('document.documentElement.lang'), lang, label);
  const contrast = await ev(CONTRAST);
  assert.deepEqual(contrast, [], `${label}: token contrast`);
  const focus = await ev(FOCUSABLE);
  assert.ok(focus.tested >= 10, `${label}: only ${focus.tested} visible controls tested`);
  assert.deepEqual(focus.failed, [], `${label}: controls that do not take focus`);
}

async function pressTab() {
  await app.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  await app.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  return ev(`(() => { const e = document.activeElement; if (!e) return null; const cs = getComputedStyle(e);
    return { id: e.id || '', text: (e.textContent || '').trim().slice(0, 24), tag: e.tagName, match: e.matches(':focus-visible'),
      outline: cs.outlineStyle, width: parseFloat(cs.outlineWidth) || 0, dpr: devicePixelRatio, shadow: cs.boxShadow }; })()`);
}
// Real Tab presses show :focus-visible. Keyboard order must reach the main chat controls, and every button it lands on must
// draw the 2 px focus ring (text fields intentionally use their own border instead).
async function checkKeyboard(label) {
  await ev("document.getElementById('new-chat').focus({ preventScroll: true }); 0");
  const seen = [];
  // The conversation carries hidden-until-hover Copy/Branch/Regenerate buttons, so leave room for them before the composer.
  for (let i = 0; i < 34; i++) seen.push(await pressTab());
  const ids = new Set(seen.map(item => item?.id));
  for (const id of ['prompt', 'add-button', 'model-trigger', 'send', 'status-model', 'status-context', 'status-web']) assert.ok(ids.has(id), `${label}: Tab reaches #${id}; saw ${[...ids].filter(Boolean).join(',')}`);
  for (const item of seen) if (item && ['BUTTON', 'A'].includes(item.tag)) {
    assert.equal(item.match, true, `${label}: ${item.id || item.text} is not :focus-visible after Tab`);
    // Chromium snaps outlines to whole device pixels: 2 px at 125 % display scale is 2 device px = 1.6 CSS px.
    const outlineRing = item.outline !== 'none' && item.width >= Math.floor(2 * item.dpr) / item.dpr - 0.01;
    const shadowRing = item.shadow && item.shadow !== 'none'; // code-copy and similar use a 2 px box-shadow ring
    assert.ok(outlineRing || shadowRing, `${label}: ${item.id || item.text} has no visible focus ring (${item.outline} ${item.width}px, shadow ${item.shadow})`);
  }
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
          await app.cdp.screenshot(shotName(label, 'chat'));
          await checkKeyboard(label + ' chat');
          // Text is in the chosen language: the sidebar's new-chat button differs between languages.
          const nav = await ev("document.querySelector('#new-chat').textContent.trim()");
          assert.ok(nav.length > 0);
          globalThis.__navText = globalThis.__navText || {};
          globalThis.__navText[lang] = nav;
          // Settings sections
          await ev("openSettings('general', false); 0");
          await settingsVisible();
          for (const s of sections) {
            await ev(`openSettings(${JSON.stringify(s)}, false); 0`);
            await app.cdp.waitFor("!document.querySelector('#settings-page').hidden", 5000);
            await checkCell(`${label} settings/${s}`, layout, mode, lang);
          }
          await app.cdp.screenshot(shotName(label, 'settings'));
          assert.deepEqual(app.cdp.errors, [], label + ' console errors');
        });
      }

  test('Turkish text differs from English text', async () => {
    assert.notEqual(globalThis.__navText.en, globalThis.__navText.tr, JSON.stringify(globalThis.__navText));
  });

  test('Settings navigation is keyboard reachable with a visible ring', async () => {
    await setSelect('language', 'en');
    await ev("openSettings('appearance', false); 0");
    await app.cdp.waitFor("!document.querySelector('#settings-page').hidden", 5000);
    await settingsVisible();
    await ev("document.getElementById('back-to-chat').focus({ preventScroll: true }); 0");
    const seen = [];
    for (let i = 0; i < 4; i++) seen.push(await pressTab());
    assert.ok(seen.some(item => item?.text === 'Appearance'), `settings nav not reached: ${JSON.stringify(seen)}`);
    for (const item of seen) if (item?.tag === 'BUTTON') {
      assert.equal(item.match, true, `settings: ${item.text} is not :focus-visible after Tab`);
      assert.ok((item.outline !== 'none' && item.width >= Math.floor(2 * item.dpr) / item.dpr - 0.01) || (item.shadow && item.shadow !== 'none'), `settings: ${item.text} has no visible focus ring`);
    }
  });

  // A real Tab keypress (CDP Input) onto a message link and a code-block Copy button: each must get :focus-visible and a visible
  // ring (outline or a box-shadow). A temporary tabindex anchor right before the target makes the Tab land on it.
  test('keyboard focus ring on a message link and a code Copy button', async () => {
    await ev("setPage('chat'); 0");
    await app.cdp.waitFor("document.querySelector('.message.assistant .md a') && document.querySelector('.message.assistant .code-copy')", 5000);
    for (const sel of ['.message.assistant .md a', '.message.assistant .code-copy']) {
      await ev(`(() => { const t = document.querySelector(${JSON.stringify(sel)}); t.scrollIntoView({ block: 'center' }); const a = document.createElement('span'); a.id = 'tab-anchor'; a.tabIndex = 0; t.before(a); a.focus(); return 0; })()`);
      for (const type of ['keyDown', 'keyUp']) await app.cdp.send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
      const r = await ev(`(() => { const t = document.querySelector(${JSON.stringify(sel)}); const cs = getComputedStyle(t); const res = { active: document.activeElement === t, visible: t.matches(':focus-visible'), outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0, shadow: cs.boxShadow !== 'none' }; document.getElementById('tab-anchor').remove(); return res; })()`);
      assert.ok(r.active && r.visible, `${sel}: Tab focus ${JSON.stringify(r)}`);
      assert.ok(r.outline || r.shadow, `${sel}: no focus ring ${JSON.stringify(r)}`);
    }
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
      await app.cdp.screenshot(shotName(label, 'chat'));
      await ev("openSettings('general', false); 0");
      await settingsVisible();
      for (const s of ['general', 'appearance', 'library', 'runtime']) {
        await ev(`openSettings(${JSON.stringify(s)}, false); 0`);
        await checkCell(`${label} settings/${s}`, layout, mode, lang);
      }
      assert.equal(await ev('innerHeight'), 600);
    }
    await app.cdp.send('Emulation.clearDeviceMetricsOverride');
    assert.deepEqual(app.cdp.errors, []);
  });

  test('150% Windows scaling: the default window in all themes, modes and languages', { timeout: 180000 }, async () => {
    // 1240x860 at 150% is 827x573 CSS pixels; devicePixelRatio 1.5 also exercises high-DPI text and borders.
    await app.cdp.send('Emulation.setDeviceMetricsOverride', { width: 827, height: 573, deviceScaleFactor: 1.5, mobile: false });
    await app.cdp.waitFor('window.innerWidth === 827 && Math.abs(window.devicePixelRatio - 1.5) < 0.001', 5000);
    for (const lang of ['en', 'tr']) for (const layout of ['native', 'reading', 'pro']) for (const mode of ['dark', 'light']) {
      const label = `150% ${layout}/${mode}/${lang}`;
      await setSelect('language', lang); await setSelect('interface-design', layout); await setSelect('display-mode', mode);
      await app.cdp.waitFor(`document.body.dataset.theme === '${layout}' && document.body.dataset.mode === '${mode}' && state.prefs.language === '${lang}'`, 5000);
      await ev("setPage('chat'); 0");
      await checkCell(label + ' chat', layout, mode, lang);
      await ev("openSettings('general', false); 0");
      await settingsVisible();
      for (const s of ['general', 'appearance', 'library', 'runtime']) {
        await ev(`openSettings(${JSON.stringify(s)}, false); 0`);
        await checkCell(`${label} settings/${s}`, layout, mode, lang);
      }
      const height = await ev('innerHeight'); assert.ok(Math.abs(height - 573) <= 1, `innerHeight ${height}`); // 574 when the display itself is at 125 %
    }
    await app.cdp.send('Emulation.clearDeviceMetricsOverride');
    await app.cdp.waitFor('window.innerWidth > 800', 5000);
    assert.deepEqual(app.cdp.errors, []);
  });
});
