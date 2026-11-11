// "Compact context memory" with three choices (Off / 8-bit / Tighter = K 8-bit + V 4-bit), in the real app with a real model:
// the choice is saved and survives a restart, Turkish labels, and a real message starts llama-server with -ctk q8_0 -ctv q4_0.
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/kvcache.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launch, workRoot } from '../harness/launch.mjs';
import { pickModel, prepareData } from './data.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `kvcache-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data');
const model = pickModel();
let app;
const ev = e => app.cdp.evaluate(e);
// Command lines of the llama-server processes started from this test's data folder (never the user's own).
const servers = () => spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" | Where-Object { $_.ExecutablePath -like '${dataDir.replace(/'/g, "''")}*' } | ForEach-Object { $_.CommandLine }`], { encoding: 'utf8' }).stdout.trim();

describe(`tighter context memory (${shell})`, { skip: model ? false : 'no installed model' }, () => {
  before(async () => {
    prepareData(dataDir, model);
    app = await launch({ shell, dataDir });
    await app.cdp.waitFor('state.ready === true', 30000);
  });
  after(async () => { await app?.stop(); });

  test('three choices; Tighter is saved and survives a restart', async () => {
    await ev("openSettings('runtime'); 0");
    await app.cdp.waitFor("!!document.getElementById('kv-cache') && document.getElementById('kv-cache').offsetParent !== null", 10000);
    assert.deepEqual(await ev("[...document.getElementById('kv-cache').options].map(o => [o.value, o.textContent])"), [['f16', 'Off (16-bit)'], ['q8_0', '8-bit'], ['k8v4', 'Tighter (8 + 4-bit)']]);
    await ev("const s = document.getElementById('kv-cache'); s.value = 'k8v4'; s.dispatchEvent(new Event('change')); 0");
    await app.cdp.waitFor("api.preferences().then(p => p.kvCache === 'k8v4')", 10000);
    await app.stop();
    app = await launch({ shell, dataDir, sync: false });
    await app.cdp.waitFor('state.ready === true', 30000);
    await ev("openSettings('runtime'); 0");
    await app.cdp.waitFor("document.getElementById('kv-cache')?.value === 'k8v4'", 10000);
    await ev("state.prefs.language = 'tr'; localize(); 0");
    assert.deepEqual(await ev("[...document.getElementById('kv-cache').options].map(o => o.textContent)"), ['Kapalı (16 bit)', '8 bit', 'Daha sıkı (8 + 4 bit)']);
    await ev("state.prefs.language = 'en'; localize(); setPage('chat'); 0");
  });

  test('a real message runs the engine with -ctk q8_0 -ctv q4_0 and gets a sensible reply', async () => {
    await app.cdp.type('#prompt', 'In two sentences, what is a hash map?');
    await app.cdp.click('#send');
    await app.cdp.waitFor("document.querySelectorAll('.message.assistant').length > 0 && state.busy === false", 300000);
    const line = servers();
    console.log('# server:', line.replace(/.*llama-server\.exe"?/i, '').slice(0, 200));
    assert.match(line, /-ctk q8_0 -ctv q4_0/);
    const reply = await ev("[...document.querySelectorAll('.message.assistant')].at(-1).querySelector('.message-body').textContent");
    console.log('# reply:', reply.replace(/\s+/g, ' ').slice(0, 160));
    assert.match(reply, /key|value|hash/i, 'a readable answer, not garbage');
  });
});
