// Status surface (Task 5) over CDP: the single element moves between the line under the composer and the bottom of the
// window with prefs.appearance.statusBar; local and cloud contents; clickable items; no polling.
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/statusbar.test.mjs
// Test data and screenshots go to <work>/ui-tests/<run>; the user's %LOCALAPPDATA%\lumen.cpp is only read.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, workRoot, repoRoot } from '../harness/launch.mjs';
import { prepareData } from './data.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `statusbar-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data');
let app;
const ev = expression => app.cdp.evaluate(expression);
const shot = name => app?.cdp.screenshot(path.join(runDir, name + '.png')).catch(() => {});

describe(`status bar (${shell})`, () => {
  before(async () => {
    prepareData(dataDir, null);
    app = await launch({ shell, dataDir });
    await app.cdp.waitFor('state.ready === true', 30000);
    await app.cdp.waitFor('typeof toolsConfig !== "undefined" && toolsConfig !== null', 15000);
    // The last <script> can run a moment after the async bootstrap sets state.ready, especially in WebView2.
    await app.cdp.waitFor("!!document.getElementById('app-status')", 5000);
    await app.cdp.waitFor("!document.getElementById('splash')", 10000).catch(() => {}); // screenshots show the workspace, not the splash
  });
  after(async () => { await app?.stop(); });

  test('one status surface shows local model, context, VRAM, engine and web', async () => {
    assert.equal(await ev("document.querySelectorAll('#app-status').length"), 1, 'one status element');
    assert.equal(await ev("document.getElementById('app-status').dataset.placement"), 'composer');
    assert.equal(await ev("document.getElementById('app-status').hidden"), false);
    assert.equal(await ev("document.body.classList.contains('statusbar-window')"), false);
    assert.equal(await ev("document.getElementById('app-status').parentElement.classList.contains('composer-region')"), true);
    assert.equal(await ev("!!document.querySelector('.composer-foot .context-wrap')?.hidden"), true, 'old context popover is replaced');

    // The same event shape the engine sends when a local reply finishes.
    await ev("LumenStatus.event({type:'context',data:{Prompt:120,Generated:40,Capacity:4096,ModelCapacity:32768,OmittedMessages:0,Counted:false}});0");
    const local = await ev(`(() => {
      const g = id => document.getElementById(id);
      return { model: g('status-model-value').textContent, context: g('status-context-value').textContent,
        vram: g('status-vram-value').textContent, engine: g('status-engine-value').textContent,
        web: g('status-web-value').textContent, vramHidden: g('status-vram').hidden,
        engineHidden: g('status-engine').hidden, webHidden: g('status-web').hidden,
        text: g('app-status').textContent };
    })()`);
    assert.ok(local.model.length > 0, 'model name');
    assert.match(local.context, /4[,.]096\s*\/\s*32[,.]768/, 'active window / model window');
    assert.match(local.vram, /GB/, 'VRAM');
    assert.ok(local.engine.length > 0, 'engine');
    assert.match(local.web, /Web (off|on)/, 'web state');
    assert.equal(local.vramHidden, false);
    assert.equal(local.engineHidden, false);
    assert.equal(local.webHidden, false);
    assert.equal(await ev("document.querySelector('.local-label').hidden"), false, 'local privacy badge is shown for a local model');
    assert.ok(!/Yerel|Local/i.test(local.text), 'no local wording');
    await shot('local-composer');

    // A model selection event repaints immediately (no polling).
    const other = await ev("state.models.find(m => !m.Cloud && m.Name !== state.chat.Model)?.Name || ''");
    if (other) {
      const expected = await ev(`displayName(${JSON.stringify(other)})`);
      await ev(`(() => { const s = document.getElementById('model-picker'); s.value = ${JSON.stringify(other)}; s.dispatchEvent(new Event('change')); return 0; })()`);
      assert.equal(await ev("document.getElementById('status-model-value').textContent"), expected);
    }

    // No timer is created by the status module: the source has none, and a burst of updates creates none at runtime.
    const source = fs.readFileSync(path.join(repoRoot, 'app', 'statusbar.js'), 'utf8');
    assert.ok(!/setInterval|setTimeout|requestAnimationFrame/.test(source), 'statusbar.js has no polling/timers');
    await ev("window.__statusIntervals = 0; const si = window.setInterval; window.setInterval = (...a) => { window.__statusIntervals++; return si(...a); }; 0");
    await ev("LumenStatus.event({type:'context',data:{Prompt:1,Generated:1,Capacity:8192,ModelCapacity:32768,OmittedMessages:0,Counted:false}});LumenStatus.refresh();0");
    assert.equal(await ev('window.__statusIntervals'), 0);
  });

  test('prefs.appearance.statusBar moves the same element to the window bottom and back', async () => {
    await ev("(async () => { state.prefs = await api.preferences({ appearance: { statusBar: true } }); applyAppearance(); return 0; })()");
    await app.cdp.waitFor("document.getElementById('app-status').dataset.placement === 'window'", 5000);
    const windowMode = await ev(`(() => {
      const s = document.getElementById('app-status'), r = s.getBoundingClientRect();
      const c = document.querySelector('.composer').getBoundingClientRect(), shell = document.querySelector('.shell').getBoundingClientRect();
      return { parentBody: s.parentElement === document.body, bodyClass: document.body.classList.contains('statusbar-window'),
        top: Math.round(r.top), bottom: Math.round(r.bottom), inner: innerHeight,
        composerBottom: Math.round(c.bottom), shellBottom: Math.round(shell.bottom),
        labelDisplay: getComputedStyle(s.querySelector('.status-label')).display,
        phase: s.querySelector('.status-phase')?.textContent,
        count: document.querySelectorAll('#app-status').length, composerHas: !!document.querySelector('.composer-region > #app-status') };
    })()`);
    assert.equal(windowMode.parentBody, true);
    assert.equal(windowMode.bodyClass, true);
    assert.equal(windowMode.bottom, windowMode.inner, 'bar sits on the window bottom');
    assert.ok(windowMode.top >= windowMode.shellBottom - 1, 'shell ends above the bar');
    assert.ok(windowMode.composerBottom <= windowMode.top + 1, 'bar does not cover the composer');
    assert.notEqual(windowMode.labelDisplay, 'none', 'labels are visible in the window bar');
    assert.equal(windowMode.phase, 'Ready', 'state word is visible in the window bar');
    assert.equal(windowMode.count, 1, 'never two status surfaces');
    assert.equal(windowMode.composerHas, false);
    await shot('local-window');

    await ev("(async () => { state.prefs = await api.preferences({ appearance: { statusBar: false } }); applyAppearance(); return 0; })()");
    await app.cdp.waitFor("document.getElementById('app-status').dataset.placement === 'composer'", 5000);
    assert.equal(await ev("document.body.classList.contains('statusbar-window')"), false);
    assert.equal(await ev("!!document.querySelector('.composer-region > #app-status')"), true);
    assert.equal(await ev("document.querySelectorAll('#app-status').length"), 1);
  });

  test('model and context items use the existing menus and settings', async () => {
    await ev("setPage('chat'); 0");
    await app.cdp.click('#status-model');
    await app.cdp.waitFor("document.getElementById('model-menu').hidden === false", 5000);
    await ev('closeComposerMenus(); 0');
    await app.cdp.click('#status-context');
    await app.cdp.waitFor("state.page === 'settings' && state.setting === 'agent'", 5000);
    assert.equal(await ev("document.activeElement?.closest('.setting-row')?.querySelector('#context-size') === document.getElementById('context-size')"), true, 'context control is focused');
    await ev("setPage('chat'); 0");
  });

  test('web item toggles the existing search setting', async () => {
    await ev("setPage('chat'); 0");
    await ev("updateTools({ search: { enabled: true } }).then(() => 0)");
    await app.cdp.waitFor("document.getElementById('status-web-value').textContent === t('statusWebOn')", 5000);
    await app.cdp.click('#status-web');
    await app.cdp.waitFor('toolsConfig.search.enabled === false', 5000);
    assert.equal(await ev("document.getElementById('status-web-value').textContent"), await ev("t('statusWebOff')"));
    // Turning it back on goes through the existing consent card, not a new permission path.
    await app.cdp.click('#status-web');
    await app.cdp.waitFor("document.getElementById('web-consent').hidden === false", 5000);
    await ev("document.getElementById('web-consent-cancel').click(); 0");
  });

  test('cloud model: provider and provider tokens, no local context or wording', async () => {
    const name = 'cloud:mock/test-model';
    await ev(`(() => {
      const name = ${JSON.stringify(name)};
      if (!state.models.some(m => m.Name === name)) state.models.push({ Name: name, Display: 'test-model · Mock Cloud', Detail: 'Mock Cloud · test-model · cloud',
        Repo: 'cloud/mock', File: 'test-model', Sha: '', Bytes: 0, Installed: true, Cloud: { provider: 'mock', label: 'Mock Cloud', model: 'test-model' } });
      state.chat.Model = name; renderPickers(); return 0;
    })()`);
    await ev("LumenStatus.event({type:'context',data:{Prompt:11,Generated:7,Capacity:0,ModelCapacity:0,OmittedMessages:0,Counted:true,Cloud:'Mock Cloud'}});0");
    const cloud = await ev(`(() => {
      const g = id => document.getElementById(id);
      return { model: g('status-model-value').textContent, context: g('status-context-value').textContent,
        vramHidden: g('status-vram').hidden, engineHidden: g('status-engine').hidden, webHidden: g('status-web').hidden,
        text: g('app-status').textContent };
    })()`);
    assert.match(cloud.model, /Cloud · Mock Cloud/);
    assert.equal(cloud.context, '18 tokens');
    assert.equal(cloud.vramHidden, true, 'no local VRAM for a cloud model');
    assert.equal(cloud.engineHidden, true, 'no local engine for a cloud model');
    assert.equal(cloud.webHidden, true, 'no local web toggle for a cloud model');
    assert.equal(await ev("document.querySelector('.local-label').hidden"), true, 'header privacy badge is hidden for a cloud model');
    assert.ok(!/Yerel|Local/i.test(cloud.text), 'cloud status has no local wording');
    assert.ok(!/4[,.]096|32[,.]768/.test(cloud.text), 'no local context window for a cloud model');
    await shot('cloud');
  });

  test('status texts follow the language; Turkish placeholder', async () => {
    await ev("(async () => { state.prefs = await api.preferences({ ...state.prefs, language: 'tr' }); localize(); return 0; })()");
    await app.cdp.waitFor("state.prefs.language === 'tr'", 5000);
    assert.equal(await ev("document.getElementById('status-model-value').textContent"), 'Bulut · Mock Cloud');
    assert.equal(await ev("document.getElementById('status-context-value').textContent"), '18 token');
    assert.equal(await ev("document.querySelector('#status-context .status-label').textContent"), 'Bağlam');
    assert.equal(await ev("document.querySelector('#prompt').placeholder"), 'Ne istersen sor; her şey bu cihazda kalsın.');
    assert.ok(!/Yerel/.test(await ev("document.getElementById('app-status').textContent")));
    assert.deepEqual(app.cdp.errors, [], 'no console errors: ' + app.cdp.errors.join(' | '));
  });

  test('the status surface fits 800x600 in both placements', async () => {
    await ev("state.chat.Model = state.models.find(m => !m.Cloud)?.Name || state.chat.Model; renderPickers(); 0");
    await ev("(async () => { state.prefs = await api.preferences({ appearance: { statusBar: false } }); applyAppearance(); return 0; })()");
    await app.cdp.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
    await app.cdp.waitFor('window.innerWidth === 800', 5000);
    const compact = await ev(`(() => {
      const s = document.getElementById('app-status').getBoundingClientRect(), c = document.querySelector('.composer').getBoundingClientRect();
      return { scroll: document.documentElement.scrollWidth, composerBottom: Math.round(c.bottom), statusTop: Math.round(s.top) };
    })()`);
    assert.ok(compact.scroll <= 800, `composer line overflows: ${JSON.stringify(compact)}`);
    assert.ok(compact.composerBottom <= compact.statusTop + 1, 'status line sits under the composer');
    await ev("(async () => { state.prefs = await api.preferences({ appearance: { statusBar: true } }); applyAppearance(); return 0; })()");
    await app.cdp.waitFor("document.getElementById('app-status').dataset.placement === 'window'", 5000);
    const bar = await ev(`(() => {
      const s = document.getElementById('app-status').getBoundingClientRect(), shell = document.querySelector('.shell').getBoundingClientRect();
      return { scroll: document.documentElement.scrollWidth, width: Math.round(s.width), bottom: Math.round(s.bottom),
        height: innerHeight, shellBottom: Math.round(shell.bottom), top: Math.round(s.top) };
    })()`);
    assert.ok(bar.scroll <= 800, `window bar overflows: ${JSON.stringify(bar)}`);
    assert.equal(bar.width, 800);
    assert.equal(bar.bottom, bar.height);
    assert.ok(bar.top >= bar.shellBottom - 1, 'window bar does not cover the shell');
    await app.cdp.send('Emulation.clearDeviceMetricsOverride');
    await app.cdp.waitFor('window.innerWidth > 800', 5000);
    assert.deepEqual(app.cdp.errors, [], 'no console errors: ' + app.cdp.errors.join(' | '));
  });
});
