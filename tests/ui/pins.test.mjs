// Pinned conversations: the pin button keeps a chat above the recent list, survives a restart (prefs.pinned) and a deleted
// chat drops out. No model is needed; chats are saved through the engine's own 'save' request.
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/pins.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, workRoot } from '../harness/launch.mjs';
import { prepareData } from './data.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `pins-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data');
let app;
const ev = expression => app.cdp.evaluate(expression);
const shot = name => app?.cdp.screenshot(path.join(runDir, name + '.png')).catch(() => {});
const start = async () => { app = await launch({ shell, dataDir }); await app.cdp.waitFor('state.ready === true', 30000); };
const titles = () => ev("[...document.querySelectorAll('#history .history-item')].map(b => b.textContent)");
const labels = () => ev("[...document.querySelectorAll('#history .history-group-label')].map(n => n.textContent)");
const pinOf = title => `[...document.querySelectorAll('#history .history-row')].find(r => r.querySelector('.history-item').textContent === ${JSON.stringify(title)}).querySelector('.history-pin')`;

describe(`pinned conversations (${shell})`, () => {
  before(async () => {
    prepareData(dataDir, null);
    await start();
    // Three saved chats, newest last: the recent list shows Gamma, Beta, Alpha.
    await ev(`(async () => {
      for (const title of ['Alpha', 'Beta', 'Gamma']) {
        const chat = { Id: crypto.randomUUID().replace(/-/g, ''), Title: title, Model: state.chat.Model, SystemPrompt: '', Messages: [{ Role: 'user', Content: title }, { Role: 'assistant', Content: 'ok' }] };
        upsert(await api.request('save', { chat }));
        await new Promise(r => setTimeout(r, 30));
      }
      renderHistory(); return 0;
    })()`);
  });
  after(async () => { await app?.stop(); });

  test('pinning moves a chat to a Pinned group at the top', async () => {
    const before = await titles();
    assert.deepEqual(before.slice(0, 3), ['Gamma', 'Beta', 'Alpha']);
    assert.deepEqual(await labels(), [], 'no group labels without pins');
    await ev(`${pinOf('Alpha')}.click(); 0`);
    await app.cdp.waitFor("document.querySelectorAll('#history .history-row.pinned').length === 1", 5000);
    assert.deepEqual((await titles()).slice(0, 3), ['Alpha', 'Gamma', 'Beta']);
    assert.deepEqual(await labels(), ['Pinned', 'Recent']);
    await shot('pinned');
    assert.equal(await ev(`${pinOf('Alpha')}.getAttribute('aria-pressed')`), 'true');
    assert.equal(await ev(`${pinOf('Alpha')}.getAttribute('aria-label')`), 'Unpin conversation: Alpha');
    assert.equal(await ev("document.getElementById('history').previousElementSibling.hidden"), true, 'outer Recent label hidden while groups show');
  });

  test('pins survive a restart and follow the language', async () => {
    await ev(`${pinOf('Beta')}.click(); 0`);
    await app.cdp.waitFor("document.querySelectorAll('#history .history-row.pinned').length === 2", 5000);
    await app.stop();
    await start();
    assert.deepEqual((await titles()).slice(0, 3), ['Beta', 'Alpha', 'Gamma'], 'newest pin first');
    await ev("(async () => { state.prefs = await api.preferences({ ...state.prefs, language: 'tr' }); localize(); renderHistory(); return 0; })()");
    assert.deepEqual(await labels(), ['Sabitlenenler', 'Son sohbetler']);
    await ev("(async () => { state.prefs = await api.preferences({ ...state.prefs, language: 'en' }); localize(); renderHistory(); return 0; })()");
  });

  test('unpinning and invalid IDs', async () => {
    await ev(`${pinOf('Beta')}.click(); 0`);
    await app.cdp.waitFor("document.querySelectorAll('#history .history-row.pinned').length === 1", 5000);
    // The core keeps only 32-hex IDs, without duplicates.
    const saved = await ev("(async () => (await api.preferences({ ...state.prefs, pinned: ['bad', state.prefs.pinned[0], state.prefs.pinned[0], 42] })).pinned)()");
    assert.equal(saved.length, 1);
    assert.match(saved[0], /^[a-f0-9]{32}$/);
    await ev(`${pinOf('Alpha')}.click(); 0`);
    await app.cdp.waitFor("document.querySelectorAll('#history .history-row.pinned').length === 0", 5000);
    assert.deepEqual(await labels(), []);
    assert.equal(await ev("document.getElementById('history').previousElementSibling.hidden"), false);
  });

  test('pin buttons are disabled while busy', async () => {
    await ev("setBusy(true, 'send'); 0");
    assert.equal(await ev("[...document.querySelectorAll('.history-pin')].every(b => b.disabled)"), true);
    await ev("setBusy(false); 0");
  });
});
