// v1.2 lasting memory in the real app (mock cloud model to see what the model receives): "Remember: …" offers a card, nothing is
// stored without it; Settings → Memory edits and removes; cloud models get the facts only with the share switch; Turkish.
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/memory.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, workRoot } from '../harness/launch.mjs';
import { prepareData } from './data.mjs';
import { cloudServer } from './mocks.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `memory-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const js = v => JSON.stringify(v);
let app, cloud;
const ev = e => app.cdp.evaluate(e);
const lastSystem = () => String(cloud.requests.filter(r => r.path === '/v1/chat/completions').at(-1)?.body.messages.find(m => m.role === 'system')?.content || '');
async function send(text) {
  const before = await ev("document.querySelectorAll('.message.assistant').length");
  await app.cdp.type('#prompt', text); await app.cdp.click('#send');
  await app.cdp.waitFor(`document.querySelectorAll('.message.assistant').length > ${before} && state.busy === false`, 60000);
}

describe(`lasting memory (${shell})`, () => {
  before(async () => {
    cloud = await cloudServer({ model: 'mock-chat' });
    prepareData(path.join(runDir, 'data'), null);
    app = await launch({ shell, dataDir: path.join(runDir, 'data') });
    await app.cdp.waitFor('state.ready === true', 30000);
    await ev(`window.lumen.connections('cloud', {enabled: true, consented: true})`);
    await ev(`window.lumen.connections('provider', {provider: 'custom', base: ${js(cloud.base)}, label: 'Mock', key: ${js(cloud.key)}, models: ['mock-chat']})`);
    await ev(`window.lumen.request('models').then(m => { state.models = m; const s = document.getElementById('model-picker'); renderPickers(); s.value = 'cloud:custom/mock-chat'; s.dispatchEvent(new Event('change')); return 0; })`);
  });
  after(async () => { await app?.stop(); cloud?.close(); });

  test('"Remember: …" sends the message and offers a card; "Not now" stores nothing', async () => {
    await send('Remember: my cat is called Pamuk.');
    await app.cdp.waitFor("!!document.querySelector('.memory-card .memory-yes')", 5000);
    assert.equal(await ev("document.querySelector('.memory-card .memory-fact').textContent"), 'my cat is called Pamuk');
    await ev("document.querySelector('.memory-card .memory-no').click(); 0");
    assert.deepEqual(await ev("window.lumen.memory('list', {})"), []);
  });

  test('"Remember" stores it; cloud models do not get it until the share switch is on', async () => {
    await send('Remember that I prefer short answers.');
    await app.cdp.waitFor("!!document.querySelector('.memory-card .memory-yes')", 5000);
    await ev("document.querySelector('.memory-card .memory-yes').click(); 0");
    await app.cdp.waitFor("window.lumen.memory('list', {}).then(l => l.length === 1)", 5000);
    await send('Hi.');
    assert.doesNotMatch(lastSystem(), /prefer short answers/, 'not shared with the cloud by default');
    await ev("api.preferences({...state.prefs, memoryCloud: true}).then(p => { state.prefs = p; return 0; })");
    await send('Hi again.');
    assert.match(lastSystem(), /asked Lumen to remember[^]*- I prefer short answers/);
  });

  test('Settings → Memory: edit, add, remove; Turkish', async () => {
    await ev("openSettings('memory'); 0");
    await app.cdp.waitFor("document.querySelectorAll('#memory-panel .memory-row[data-id]').length === 1", 5000);
    assert.equal(await ev("document.getElementById('memory-cloud').checked"), true);
    await ev("(() => { const i = document.querySelector('#memory-panel .memory-row[data-id] input'); i.value = 'I prefer very short answers'; i.dispatchEvent(new Event('input')); i.parentElement.querySelector('button:not([hidden])').click(); return 0; })()");
    await app.cdp.waitFor("window.lumen.memory('list', {}).then(l => l[0]?.text === 'I prefer very short answers')", 5000);
    await app.cdp.type('#memory-new', 'Kahveyi şekersiz içerim');
    await ev("document.querySelector('#memory-panel .memory-new button').click(); 0");
    await app.cdp.waitFor("document.querySelectorAll('#memory-panel .memory-row[data-id]').length === 2", 5000);
    await ev("document.querySelector('#memory-panel .memory-row[data-id] .danger').click(); 0");
    await app.cdp.waitFor("window.lumen.memory('list', {}).then(l => l.length === 1 && l[0].text === 'Kahveyi şekersiz içerim')", 5000);
    await ev("state.prefs.language = 'tr'; localize(); openSettings('memory'); 0");
    await app.cdp.waitFor("document.querySelector('#memory-panel h1')?.textContent === 'Hafıza'", 5000);
    await ev("state.prefs.language = 'en'; localize(); setPage('chat'); 0");
  });

  test('sensitive data to a cloud model: a card first; Edit sends nothing, Send anyway sends it', async () => {
    const calls = () => cloud.requests.filter(r => r.path === '/v1/chat/completions').length, before = calls();
    await app.cdp.type('#prompt', 'Pay with 4111 1111 1111 1111 please'); await app.cdp.click('#send');
    await app.cdp.waitFor("!!document.querySelector('.sensitive-card .sens-send')", 5000);
    assert.match(await ev("document.querySelector('.sensitive-card').textContent"), /It goes to Mock: card number 4111…1111/);
    await ev("document.querySelector('.sensitive-card .sens-edit').click(); 0");
    assert.equal(calls(), before); assert.match(await ev("$('prompt').value"), /4111/);
    await app.cdp.click('#send');
    await app.cdp.waitFor("!!document.querySelector('.sensitive-card .sens-send')", 5000);
    await ev("document.querySelector('.sensitive-card .sens-send').click(); 0");
    await app.cdp.waitFor("state.busy === false && state.chat.Messages.at(-1)?.Role === 'assistant'", 30000);
    assert.equal(calls(), before + 1);
  });

  test('a Turkish request with the phrase at the end', async () => {
    await send('Salı günleri toplantım var, bunu hatırla.');
    await app.cdp.waitFor("document.querySelector('.memory-card .memory-fact')?.textContent === 'Salı günleri toplantım var'", 5000);
    await ev("document.querySelector('.memory-card').remove(); 0");
  });
});
