// Assistants in the composer: "Manage assistants…" opens Settings → Assistants, and an assistant can be removed from a
// conversation that already has messages (it used to stay stuck on the chat).
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/assistants.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, workRoot } from '../harness/launch.mjs';
import { prepareData } from './data.mjs';
import { cloudServer } from './mocks.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `assistants-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const js = v => JSON.stringify(v);
let app, cloud;
const ev = e => app.cdp.evaluate(e);
const menuItems = () => ev("[...document.querySelectorAll('#assistant-menu .assistant-item strong')].map(s => s.textContent)");

describe(`assistants (${shell})`, () => {
  before(async () => {
    cloud = await cloudServer({ model: 'mock-chat', reply: 'ok' });
    prepareData(path.join(runDir, 'data'), null);
    app = await launch({ shell, dataDir: path.join(runDir, 'data') });
    await app.cdp.waitFor('state.ready === true', 30000);
    await ev(`window.lumen.connections('cloud', {enabled: true, consented: true})`);
    await ev(`window.lumen.connections('provider', {provider: 'custom', base: ${js(cloud.base)}, label: 'Mock', key: ${js(cloud.key)}, models: ['mock-chat']})`);
    await ev(`window.lumen.request('models').then(m => { state.models = m; const s = document.getElementById('model-picker'); renderPickers(); s.value = 'cloud:custom/mock-chat'; s.dispatchEvent(new Event('change')); return 0; })`);
    await app.cdp.waitFor("document.getElementById('model-picker').value === 'cloud:custom/mock-chat' && state.chat?.Model === 'cloud:custom/mock-chat'", 5000);
    await ev(`api.assistants('save', {assistant: {name: 'Coder', description: 'careful edits', instructions: 'Be careful.', model: '', run: {}, skillIds: [], tools: []}}).then(() => 0)`);
  });
  after(async () => { await app?.stop(); cloud?.close(); });

  test('"Manage assistants…" opens Settings → Assistants', async () => {
    await app.cdp.click('#assistant-toggle');
    await app.cdp.waitFor("!document.getElementById('assistant-menu').hidden", 5000);
    await app.cdp.click('#assistant-menu .assistant-manage');
    await app.cdp.waitFor("state.page === 'settings' && state.setting === 'assistants' && !document.getElementById('assistants-panel').hidden && !!document.getElementById('assistant-name')", 5000);
    await ev("setPage('chat'); 0");
  });

  test('an assistant can be removed from a conversation that has messages', async () => {
    await app.cdp.click('#assistant-toggle');
    await app.cdp.waitFor("[...document.querySelectorAll('#assistant-menu .assistant-item strong')].some(s => s.textContent === 'Coder')", 5000);
    await ev("[...document.querySelectorAll('#assistant-menu .assistant-item')].find(b => b.textContent.includes('Coder')).click(); 0");
    await app.cdp.waitFor("state.chat.Assistant?.name === 'Coder' && !!document.querySelector('.assistant-chip')", 5000);
    await app.cdp.type('#prompt', 'merhaba');
    await app.cdp.click('#send');
    await app.cdp.waitFor("document.querySelectorAll('.message.assistant').length > 0 && state.busy === false", 30000);
    await app.cdp.click('#assistant-toggle');
    await app.cdp.waitFor("!document.getElementById('assistant-menu').hidden", 5000);
    assert.ok((await menuItems()).includes('No assistant'), 'the menu offers No assistant on a chat with messages');
    const id = await ev('state.chat.Id'), count = await ev('state.chat.Messages.length');
    await ev("[...document.querySelectorAll('#assistant-menu .assistant-item')].find(b => b.textContent.includes('No assistant')).click(); 0");
    await app.cdp.waitFor("!state.chat.Assistant && !document.querySelector('.assistant-chip')", 5000);
    assert.equal(await ev('state.chat.Id'), id, 'the same conversation, not a new one');
    assert.equal(await ev('state.chat.Messages.length'), count, 'messages are kept');
    // Saved: the next reply no longer gets the assistant's instructions.
    const before = cloud.requests.filter(r => r.path === '/v1/chat/completions').length;
    await app.cdp.type('#prompt', 'tekrar');
    await app.cdp.click('#send');
    await app.cdp.waitFor(`document.querySelectorAll('.message.assistant').length > ${count / 2} && state.busy === false`, 30000);
    const sent = cloud.requests.filter(r => r.path === '/v1/chat/completions').slice(before);
    assert.doesNotMatch(JSON.stringify(sent[0].body.messages), /Be careful\./);
  });
});
