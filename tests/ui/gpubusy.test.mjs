// GPU busy warning (v1.0.9): after a local reply the status bar asks the core which other programs keep the GPU busy; the
// speed item is marked and the program is named once. LUMEN_TEST_GPU_BUSY replaces the Windows counter read (test mode only).
// The reply is simulated with the engine events the core sends (chunk, chunk, context Final), so no model is needed.
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/gpubusy.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, workRoot } from '../harness/launch.mjs';
import { prepareData } from './data.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `gpubusy-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data');
let app;
const ev = expression => app.cdp.evaluate(expression);
// A local (or cloud) reply as the status bar sees it, with a fake clock so the speed is defined.
const reply = (cloud = false) => ev(`(() => {
  let now = 0; LumenStatus.setClock(() => now);
  state.operation = 'send';
  handleEngineEvent({ type: 'chunk', data: 'a' }); now = 500; handleEngineEvent({ type: 'chunk', data: 'b' }); now = 1000; handleEngineEvent({ type: 'chunk', data: 'c' });
  handleEngineEvent({ type: 'context', data: { Prompt: 10, Generated: 20, Final: true, ${cloud ? "Cloud: 'OpenAI', Counted: true" : ''} } });
  state.operation = null; return 0; })()`);

describe(`GPU busy warning (${shell})`, () => {
  before(async () => {
    prepareData(dataDir, null);
    app = await launch({ shell, dataDir, env: { LUMEN_TEST_GPU_BUSY: JSON.stringify([{ name: 'wallpaper64', title: 'Wallpaper Engine', percent: 92 }]) } });
    await app.cdp.waitFor('state.ready === true', 30000);
    await ev("setPage('chat'); document.getElementById('toast').hidden = true; statusState.engine = 'CUDA 13.4'; 0");
  });
  after(async () => { await app?.stop(); });

  test('the core answers with the busy program', async () => {
    const r = await ev("api.modelsInfo('gpu-busy')");
    assert.deepEqual(r.busy, [{ name: 'wallpaper64', title: 'Wallpaper Engine', percent: 92 }]);
  });

  test('a local reply marks the speed item and names the program once', async () => {
    await reply();
    await app.cdp.waitFor("document.getElementById('status-speed').classList.contains('status-gpu-busy')", 5000);
    const title = await ev("document.getElementById('status-speed').title");
    assert.match(title, /Wallpaper Engine is using 92% of the graphics card/);
    assert.match(await ev("document.getElementById('status-speed').textContent"), /⚠/);
    assert.equal(await ev("document.getElementById('toast').hidden"), false);
    assert.match(await ev("document.getElementById('toast').textContent"), /Wallpaper Engine/);
    await ev("document.getElementById('toast').hidden = true; 0");
    await reply();
    await new Promise(r => setTimeout(r, 300));
    assert.equal(await ev("document.getElementById('toast').hidden"), true, 'the toast is not repeated');
  });

  test('Turkish text', async () => {
    await ev("state.prefs.language = 'tr'; localize(); paintStatus(); 0");
    assert.match(await ev("document.getElementById('status-speed').title"), /Wallpaper Engine ekran kartının %92 kadarını kullanıyor/);
    await ev("state.prefs.language = 'en'; localize(); 0");
  });

  test('a cloud reply or the CPU engine does not ask', async () => {
    await ev("statusState.gpuBusy = []; window.__asked = 0; const f = api.modelsInfo; api.modelsInfo = (...a) => { if (a[0] === 'gpu-busy') window.__asked++; return f(...a); }; 0");
    await reply(true);
    await ev("statusState.engine = 'CPU'; 0");
    await reply();
    await new Promise(r => setTimeout(r, 300));
    assert.equal(await ev('window.__asked'), 0);
  });
});
