// Reasoning effort in the run settings panel: a DeepSeek model (here a mock named deepseek-flash on a custom provider) shows
// Model default / Low / High / Max, the composer button names the level, and the chosen level is sent as reasoning_effort.
// A local model shows the row disabled with a note.
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/effort.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, workRoot } from '../harness/launch.mjs';
import { prepareData } from './data.mjs';
import { cloudServer } from './mocks.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `effort-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const js = v => JSON.stringify(v);
let app, cloud;
const ev = e => app.cdp.evaluate(e);
const buttons = () => ev("[...document.querySelectorAll('#run-effort button')].filter(b => !b.hidden).map(b => b.textContent)");
const label = () => ev("document.querySelector('#run-toggle .run-toggle-text').textContent");

describe(`reasoning effort (${shell})`, () => {
  before(async () => {
    cloud = await cloudServer({ model: 'deepseek-flash', reply: 'ok' });
    prepareData(path.join(runDir, 'data'), null);
    app = await launch({ shell, dataDir: path.join(runDir, 'data') });
    await app.cdp.waitFor('state.ready === true', 30000);
    await ev(`window.lumen.connections('cloud', {enabled: true, consented: true})`);
    await ev(`window.lumen.connections('provider', {provider: 'custom', base: ${js(cloud.base)}, label: 'Mock', key: ${js(cloud.key)}, models: ['deepseek-flash']})`);
    await ev(`window.lumen.request('models').then(m => { state.models = m; const s = document.getElementById('model-picker'); renderPickers(); s.value = 'cloud:custom/deepseek-flash'; s.dispatchEvent(new Event('change')); return 0; })`);
    await app.cdp.waitFor("document.getElementById('model-picker').value === 'cloud:custom/deepseek-flash'", 5000);
  });
  after(async () => { await app?.stop(); cloud?.close(); });

  test('a DeepSeek model offers Model default, Low, High and Max; the button shows the level', async () => {
    await app.cdp.click('#run-toggle');
    await app.cdp.waitFor("!document.getElementById('run-panel').hidden && [...document.querySelectorAll('#run-effort button')].some(b => !b.hidden && b.textContent === 'Max')", 10000);
    assert.deepEqual(await buttons(), ['Model default', 'Low', 'High', 'Max']);
    assert.equal(await ev("document.getElementById('run-effort-note').hidden"), true);
    assert.match(await label(), / · High$/, 'the model default (high) is named');
    await ev("[...document.querySelectorAll('#run-effort button')].find(b => b.textContent === 'Max').click(); 0");
    await app.cdp.waitFor("/ · Max$/.test(document.querySelector('#run-toggle .run-toggle-text').textContent)", 5000);
    assert.equal(await ev("document.querySelector('#run-effort button[aria-checked=\"true\"]').textContent"), 'Max');
  });

  test('the chosen level is sent with the request', async () => {
    await ev('closeRunPanel(); 0');
    const before = cloud.requests.filter(r => r.path === '/v1/chat/completions').length;
    await app.cdp.type('#prompt', 'merhaba');
    await app.cdp.click('#send');
    await app.cdp.waitFor("document.querySelectorAll('.message.assistant').length > 0 && state.busy === false", 30000);
    const sent = cloud.requests.filter(r => r.path === '/v1/chat/completions').slice(before);
    assert.equal(sent[0].body.reasoning_effort, 'max');
  });

  test('a local model shows the row disabled with a note; Turkish names', async () => {
    const local = await ev("state.models.find(m => !m.Cloud)?.Name");
    await ev(`(() => { const s = document.getElementById('model-picker'); s.value = ${js(local)}; s.dispatchEvent(new Event('change')); return 0; })()`);
    await app.cdp.click('#run-toggle');
    await app.cdp.waitFor("!document.getElementById('run-panel').hidden && !document.getElementById('run-effort-note').hidden", 10000);
    assert.deepEqual(await buttons(), ['Model default']);
    assert.equal(await ev("document.querySelector('#run-effort button').disabled"), true);
    assert.doesNotMatch(await label(), / · (Low|High|Max)$/);
    await ev(`(async () => { const s = document.getElementById('model-picker'); s.value = 'cloud:custom/deepseek-flash'; s.dispatchEvent(new Event('change')); state.prefs = await api.preferences({ ...state.prefs, language: 'tr' }); localize(); return 0; })()`);
    await app.cdp.waitFor("[...document.querySelectorAll('#run-effort button')].some(b => !b.hidden && b.textContent === 'En yüksek')", 10000);
    assert.deepEqual(await buttons(), ['Model varsayılanı', 'Düşük', 'Yüksek', 'En yüksek']);
    await ev("(async () => { state.prefs = await api.preferences({ ...state.prefs, language: 'en' }); localize(); return 0; })()");
  });
});
