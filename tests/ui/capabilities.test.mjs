// v1.2: the model is told it is Lumen and what it can do (capabilities.cjs). In the real app: what a cloud provider receives
// with web off and on, the "Introduce Lumen" switch, the instructions preview, and a real local model asked about the internet.
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/capabilities.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, workRoot } from '../harness/launch.mjs';
import { pickModel, prepareData } from './data.mjs';
import { cloudServer } from './mocks.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `capabilities-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data');
const model = pickModel();
const js = v => JSON.stringify(v);
let app, cloud;
const ev = e => app.cdp.evaluate(e);
async function send(text) {
  const before = await ev("document.querySelectorAll('.message.assistant').length");
  await app.cdp.type('#prompt', text); await app.cdp.click('#send');
  await app.cdp.waitFor(`document.querySelectorAll('.message.assistant').length > ${before} && state.busy === false`, 300000);
  return ev("[...document.querySelectorAll('.message.assistant')].at(-1).querySelector('.message-body').textContent");
}
const lastSystem = () => String(cloud.requests.filter(r => r.path === '/v1/chat/completions').at(-1).body.messages.find(m => m.role === 'system')?.content || '');

describe(`Lumen tells the model what it can do (${shell})`, () => {
  before(async () => {
    cloud = await cloudServer();
    prepareData(dataDir, model);
    app = await launch({ shell, dataDir });
    await app.cdp.waitFor('state.ready === true', 30000);
    await ev(`window.lumen.connections('cloud', {enabled: true, consented: true})`);
    await ev(`window.lumen.connections('provider', {provider: 'custom', base: ${js(cloud.base)}, label: 'Mock cloud', key: ${js(cloud.key)}, models: [${js(cloud.model)}]})`);
    await ev("window.lumen.tools('update', {search: {enabled: true}}).then(() => 0)");
    await ev(`window.lumen.request('models').then(m => { state.models = m; state.chat.Model = ${js('cloud:custom/' + cloud.model)}; $('model-picker').value = state.chat.Model; renderPickers(); return 0; })`);
  });
  after(async () => { await app?.stop(); cloud?.close(); });

  test('new chats start with "You are Lumen"', async () => {
    assert.match(await ev('state.chat.SystemPrompt'), /^You are Lumen, a helpful assistant\./);
  });

  test('cloud model, web research off: the provider is told web is off and where to turn it on', async () => {
    await send('Can you research re-library.org?');
    const sys = lastSystem();
    assert.match(sys, /You are Lumen \(lumen\.cpp\)/);
    assert.match(sys, /from Mock cloud \(cloud\)/);
    assert.match(sys, /Off right now[^\n]*web search[^\n]*Settings → Cloud models → Web research/);
  });

  test('cloud web research on: listed as available', async () => {
    await ev("window.lumen.connections('cloud', {webResearch: true}).then(() => 0)");
    // A plain question that needs no web goes to chat; the notice still says what is available.
    await send('Hello, who are you?');
    assert.match(lastSystem(), /you can:[^\n]*search the web and read web pages/);
    await ev("window.lumen.connections('cloud', {webResearch: false}).then(() => 0)");
  });

  test('the switch removes the notice; the preview shows it when on', async () => {
    await ev("openSettings('agent'); 0");
    await app.cdp.waitFor("!!document.getElementById('introduce-lumen')", 5000);
    assert.equal(await ev("document.getElementById('introduce-lumen').checked"), true);
    await ev("document.getElementById('preview-instructions').click(); 0");
    await app.cdp.waitFor("/You are Lumen \\(lumen\\.cpp\\)/.test(document.getElementById('instructions-preview').textContent)", 5000);
    await ev("const b = document.getElementById('introduce-lumen'); b.checked = false; b.dispatchEvent(new Event('change')); 0");
    await app.cdp.waitFor("api.preferences().then(p => p.introduceLumen === false)", 5000);
    await ev("setPage('chat'); 0");
    await send('Hi again.');
    assert.doesNotMatch(lastSystem(), /lumen\.cpp/);
    await ev("api.preferences({...state.prefs, introduceLumen: true}).then(p => { state.prefs = p; return 0; })");
  });

  test('a real local model asked about the internet does not deny it', { skip: model ? false : 'no installed model' }, async () => {
    await ev(`(() => { const m = state.models.find(x => !x.Cloud && x.Installed && !x.Image); state.chat = fresh(m.Name); $('model-picker').value = m.Name; upsert(state.chat); renderPickers(); renderMessages(); return 0; })()`);
    await ev("window.lumen.tools('update', {search: {enabled: true}, agent: {auto: false}}).then(() => 0)");
    const reply = await send('Can you access the internet from here? Answer in one or two sentences.');
    console.log('# reply:', reply.replace(/\s+/g, ' ').slice(0, 220));
    assert.doesNotMatch(reply, /(don't|do not|cannot|can't) (have )?(access|browse)[^.]*internet|no (internet|web) access/i);
  });
});
