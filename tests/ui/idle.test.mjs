// "Free memory when idle" and the status bar speed with a real model: after a reply the core unloads the model once the idle
// time passes (LUMEN_TEST_IDLE_MS shortens the minutes; --ui-check only), the llama-server process goes away, the next message
// loads it again. Needs an installed chat model (data.mjs pickModel); skipped otherwise.
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/idle.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, workRoot } from '../harness/launch.mjs';
import { pickModel, prepareData } from './data.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `idle-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data');
const model = pickModel();
const NO_MODEL = model ? false : 'no installed model';
const IDLE_MS = 4000;
let app;
const ev = expression => app.cdp.evaluate(expression);

// llama-server processes that serve a model from this test's data folder (the user's own app is never counted).
function servers() {
  const ps = "Get-CimInstance Win32_Process -Filter \"Name like 'llama-server%'\" | Select-Object -ExpandProperty CommandLine | ConvertTo-Json -Compress";
  const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim();
  const lines = out ? [].concat(JSON.parse(out)) : [];
  return lines.filter(line => String(line).toLowerCase().includes(dataDir.toLowerCase())).length;
}
const waitUntil = async (check, ms, what) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 250)); } throw Error('timed out: ' + what); };

async function send(text) {
  const before = await ev("document.querySelectorAll('.message.assistant').length");
  await app.cdp.type('#prompt', text);
  await app.cdp.click('#send');
  await app.cdp.waitFor(`document.querySelectorAll('.message.assistant').length > ${before}`, 120000);
  await app.cdp.waitFor('state.busy === false', 180000);
}

describe(`idle unload (${shell})`, { skip: NO_MODEL }, () => {
  before(async () => {
    prepareData(dataDir, model);
    const prefsPath = path.join(dataDir, 'desktop-preferences.json');
    fs.writeFileSync(prefsPath, JSON.stringify({ ...JSON.parse(fs.readFileSync(prefsPath, 'utf8')), idleUnload: 5, responseTokens: 512 }));
    app = await launch({ shell, dataDir, env: { LUMEN_TEST_IDLE_MS: String(IDLE_MS) } });
    await app.cdp.waitFor('state.ready === true', 30000);
    await ev("window.__unloaded = 0; api.onEvent(e => { if (e.type === 'unloaded') window.__unloaded++; }); 0");
  });
  after(async () => { await app?.stop(); });

  test('a reply shows tokens per second in the status line', async () => {
    await send('Write three short sentences about the sea.');
    assert.equal(await ev("document.getElementById('status-speed').hidden"), false, 'speed item visible after a reply');
    const text = await ev("document.getElementById('status-speed-value').textContent");
    assert.match(text, /^[\d.,]+ tok\/s$/);
    assert.ok(parseFloat(text.replace(',', '.')) > 0, text);
    assert.equal(servers(), 1, 'model is loaded after the reply');
  });

  test('the model is unloaded after the idle time and loads again on the next message', async () => {
    assert.equal(await ev("document.getElementById('idle-unload').value"), '5', 'setting shows the saved choice');
    await waitUntil(async () => (await ev('window.__unloaded')) === 1, IDLE_MS + 20000, 'unloaded event');
    await waitUntil(() => servers() === 0, 15000, 'llama-server exits');
    await send('Say hi.');
    assert.equal(servers(), 1, 'next message loads the model again');
    assert.ok((await ev("[...document.querySelectorAll('.message.assistant')].at(-1).querySelector('.message-body').textContent")).length > 0);
  });

  test('"Never" keeps the model loaded', async () => {
    await ev("(async () => { state.prefs = await api.preferences({ ...state.prefs, idleUnload: 0 }); return 0; })()");
    const before = await ev('window.__unloaded');
    await send('Say ok.');
    await new Promise(r => setTimeout(r, IDLE_MS + 3000));
    assert.equal(await ev('window.__unloaded'), before);
    assert.equal(servers(), 1);
  });
});
