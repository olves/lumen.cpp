// Settings → Cloud models: "Add custom provider" adds a second OpenAI-compatible provider beside the first; its models show in
// the model menu and chat through their own address; "Remove provider" (clicked twice) removes the added one.
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/customproviders.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, workRoot } from '../harness/launch.mjs';
import { prepareData } from './data.mjs';
import { cloudServer } from './mocks.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `customproviders-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const js = v => JSON.stringify(v);
let app, first, second;
const ev = e => app.cdp.evaluate(e);
const cards = () => ev("[...document.querySelectorAll('#cloud-panel .connect-card .connect-card-head strong')].map(s => s.textContent)");

describe(`custom providers (${shell})`, () => {
  before(async () => {
    first = await cloudServer({ model: 'model-a', reply: 'from A' });
    second = await cloudServer({ model: 'model-b', reply: 'from B' });
    prepareData(path.join(runDir, 'data'), null);
    app = await launch({ shell, dataDir: path.join(runDir, 'data') });
    await app.cdp.waitFor('state.ready === true', 30000);
    await ev(`window.lumen.connections('cloud', {enabled: true, consented: true})`);
    await ev(`window.lumen.connections('provider', {provider: 'custom', base: ${js(first.base)}, label: 'First', key: ${js(first.key)}, models: ['model-a']})`);
    await ev("openSettings('cloud'); 0");
    await app.cdp.waitFor("[...document.querySelectorAll('#cloud-panel .connect-card strong')].some(s => s.textContent === 'First')", 10000);
  });
  after(async () => { await app?.stop(); first?.close(); second?.close(); });

  test('"Add custom provider" adds a second card that keeps its own address, key and models', async () => {
    await app.cdp.click('#cloud-add-custom');
    await app.cdp.waitFor("document.querySelectorAll('#cloud-panel .connect-card[data-provider=\"custom2\"]').length === 1", 5000);
    const card = "#cloud-panel .connect-card[data-provider=\"custom2\"]";
    await ev(`(() => { const c = document.querySelector(${js(card)}); const [label, base] = c.querySelectorAll('.connect-inline input'); label.value = 'Second'; base.value = ${js(second.base)}; c.querySelector('.connect-inline button').click(); return 0; })()`);
    await app.cdp.waitFor(`document.querySelector(${js(card + ' .connect-card-head strong')})?.textContent === 'Second'`, 5000);
    await ev(`window.lumen.connections('provider', {provider: 'custom2', key: ${js(second.key)}, models: ['model-b']}).then(() => refreshCloudModels()).then(() => 0)`);
    const names = await cards();
    assert.ok(names.includes('First') && names.includes('Second'), JSON.stringify(names));
    await app.cdp.waitFor("state.models.some(m => m.Name === 'cloud:custom/model-a') && state.models.some(m => m.Name === 'cloud:custom2/model-b')", 5000);
  });

  test('a model on the added provider chats through its own address', async () => {
    await ev("setPage('chat'); 0");
    await ev("(() => { const s = document.getElementById('model-picker'); s.value = 'cloud:custom2/model-b'; s.dispatchEvent(new Event('change')); return 0; })()");
    await app.cdp.waitFor("state.chat?.Model === 'cloud:custom2/model-b'", 5000);
    const a = first.requests.length;
    await app.cdp.type('#prompt', 'merhaba');
    await app.cdp.click('#send');
    await app.cdp.waitFor("document.querySelectorAll('.message.assistant').length > 0 && state.busy === false", 30000);
    assert.match(await ev("[...document.querySelectorAll('.message.assistant')].at(-1).textContent"), /from B/);
    assert.equal(first.requests.length, a, 'nothing went to the first provider');
  });

  test('"Remove provider" asks for a second click, then removes only the added provider', async () => {
    await ev("openSettings('cloud'); 0");
    const remove = '#cloud-panel .connect-card[data-provider="custom2"] .connect-remove';
    await app.cdp.waitFor(`!!document.querySelector(${js(remove)})`, 5000);
    assert.equal(await ev("!!document.querySelector('#cloud-panel .connect-card[data-provider=\"custom\"] .connect-remove')"), false, 'the first custom slot has no Remove');
    await app.cdp.click(remove);
    assert.equal(await ev("!!document.querySelector('#cloud-panel .connect-card[data-provider=\"custom2\"]')"), true, 'one click only asks');
    await app.cdp.click(remove);
    await app.cdp.waitFor("!document.querySelector('#cloud-panel .connect-card[data-provider=\"custom2\"]')", 5000);
    await app.cdp.waitFor("!state.models.some(m => m.Name.startsWith('cloud:custom2/')) && state.models.some(m => m.Name === 'cloud:custom/model-a')", 5000);
  });
});
