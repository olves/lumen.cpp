// Coding agent UI with a scripted cloud model (mock provider) over a real temp project folder: one-time consent, read-only
// runs, change cards (Apply / Skip / Apply all), task summary with Undo, stopping while a change waits, Regenerate hidden,
// Turkish strings. The mock streams tool calls like a real provider; files on disk are checked directly.
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/coding.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, workRoot } from '../harness/launch.mjs';
import { prepareData } from './data.mjs';
import { cloudServer } from './mocks.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `coding-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data'), projectDir = path.join(runDir, 'demo-project');
const js = v => JSON.stringify(v);
let app, cloud;
const ev = e => app.cdp.evaluate(e);
const file = n => fs.readFileSync(path.join(projectDir, n), 'utf8');
const LAST = "[...document.querySelectorAll('.message.assistant')].at(-1)";
const finish = summary => ({ toolCalls: [{ name: 'finish', args: { summary } }] });
const lastToolText = body => String([...body.messages].reverse().find(m => m.role === 'tool')?.content || '');

async function send(text) {
  const before = await ev("document.querySelectorAll('.message.assistant').length");
  await app.cdp.type('#prompt', text);
  await app.cdp.click('#send');
  return before;
}
const settled = before => app.cdp.waitFor(`document.querySelectorAll('.message.assistant').length > ${before} && state.busy === false`, 60000);
const card = () => app.cdp.waitFor("!!document.querySelector('.edit-card .edit-apply')", 30000);

describe(`coding agent (${shell})`, () => {
  before(async () => {
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'app.js'), 'function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n');
    fs.writeFileSync(path.join(projectDir, 'util.js'), 'export const x = 1;\n');
    cloud = await cloudServer();
    prepareData(dataDir, null);
    app = await launch({ shell, dataDir, env: { LUMEN_TEST_FILES: JSON.stringify([projectDir]) } });
    await app.cdp.waitFor('state.ready === true', 30000);
    await ev(`window.lumen.connections('cloud', {enabled: true, consented: true})`);
    await ev(`window.lumen.connections('provider', {provider: 'custom', base: ${js(cloud.base)}, label: 'Mock cloud', key: ${js(cloud.key)}, models: [${js(cloud.model)}]})`);
    await ev(`window.lumen.request('models').then(m => { state.models = m; state.chat.Model = ${js('cloud:custom/' + cloud.model)}; renderPickers(); return 0; })`);
    await ev('attachProject().then(() => 0)');
    await app.cdp.waitFor('!!state.chat.Project', 10000);
  });
  after(async () => { await app?.stop(); cloud?.close(); });

  test('first cloud run asks for project-file consent once; edits are off and the run is read-only', async () => {
    cloud.setScript((body, n) => n === 1 ? { toolCalls: [{ name: 'read_file', args: { path: 'app.js' } }] } : finish('add() subtracts instead of adding.'));
    const before = await send('What is wrong in app.js?');
    await app.cdp.waitFor("!!document.querySelector('.coding-consent .coding-consent-allow')", 10000);
    assert.match(await ev("document.querySelector('.coding-consent').textContent"), /Mock cloud/);
    await ev("document.querySelector('.coding-consent .coding-consent-allow').click(); 0");
    await settled(before);
    assert.equal(await ev(`${LAST}.querySelector('.message-body').textContent.trim()`), 'add() subtracts instead of adding.');
    const sent = cloud.requests.filter(r => r.path === '/v1/chat/completions').at(-2).body;
    assert.deepEqual(sent.tools.map(t => t.function.name), ['list_dir', 'find_files', 'search_text', 'read_file', 'finish']);
    assert.equal(await ev("(api.projects('coding', {chatId: state.chat.Id})).then(r => r.allowEdits)"), false);
    // A second run does not ask again.
    cloud.setScript(() => finish('Still fine.'));
    const again = await send('Anything else?');
    await settled(again);
    assert.equal(await ev("!!document.querySelector('.coding-consent')"), false);
  });

  test('the switch turns edits on; a change card shows the diff and Apply writes the file', async () => {
    await ev('openProjectDialog().then(() => 0)');
    await app.cdp.waitFor("!!document.getElementById('allow-edits')", 5000);
    assert.equal(await ev("document.getElementById('allow-edits').checked"), false);
    await ev("document.getElementById('allow-edits').click(); 0");
    await app.cdp.waitFor("api.projects('coding', {chatId: state.chat.Id}).then(r => r.allowEdits)", 5000);
    await ev("document.getElementById('project-dialog').close(); 0");
    assert.match(await ev("document.querySelector('.project-chip').textContent"), /edits on/);
    cloud.setScript((body, n) => n === 1 ? { toolCalls: [{ name: 'edit_file', args: { path: 'app.js', edits: [{ old: 'return a - b;', new: 'return a + b;' }] } }] } : finish(`Fixed app.js. (${lastToolText(body).split('\n')[0]})`));
    const before = await send('Fix add.');
    await card();
    const view = await ev("(() => { const c = document.querySelector('.edit-card'); return { head: c.querySelector('.edit-path').textContent, counts: c.querySelector('.edit-counts').textContent, del: [...c.querySelectorAll('.edit-diff del')].map(n => n.textContent), ins: [...c.querySelectorAll('.edit-diff ins')].map(n => n.textContent) }; })()");
    assert.deepEqual(view, { head: 'app.js', counts: '+1 −1', del: ['  return a - b;'], ins: ['  return a + b;'] });
    assert.match(file('app.js'), /a - b/, 'nothing written before Apply');
    await ev("document.querySelector('.edit-card .edit-apply').click(); 0");
    await settled(before);
    assert.match(file('app.js'), /return a \+ b;/);
    assert.match(await ev(`${LAST}.querySelector('.message-body').textContent`), /Fixed app\.js\. \(applied: edited app\.js/);
    assert.equal(await ev("document.querySelectorAll('.edit-card').length"), 0, 'card removed when done');
  });

  test('Skip leaves the file and the model is told', async () => {
    cloud.setScript((body, n) => n === 1 ? { toolCalls: [{ name: 'edit_file', args: { path: 'util.js', edits: [{ old: 'x = 1', new: 'x = 2' }] } }] } : finish(/declined/.test(lastToolText(body)) ? 'Left util.js as it is.' : 'unexpected'));
    const before = await send('Change x.');
    await card();
    await ev("document.querySelector('.edit-card .edit-skip').click(); 0");
    await settled(before);
    assert.equal(file('util.js'), 'export const x = 1;\n');
    assert.equal(await ev(`${LAST}.querySelector('.message-body').textContent.trim()`), 'Left util.js as it is.');
  });

  test('Apply all applies the next change without a card; the summary lists files and the cost line', async () => {
    cloud.setScript((body, n) => n === 1 ? { toolCalls: [{ name: 'edit_file', args: { path: 'util.js', edits: [{ old: 'x = 1', new: 'x = 3' }] } }] }
      : n === 2 ? { toolCalls: [{ name: 'create_file', args: { path: 'lib/new.js', content: 'export const y = 2;\n' } }] } : finish('Changed util.js and added lib/new.js.'));
    const before = await send('Two changes.');
    await card();
    await ev("document.querySelector('.edit-card .edit-apply-all').click(); 0");
    // The second change (create_file) must not show a card: count cards that appear until the run ends.
    await ev("window.__lateCards = 0; window.__cardWatch = new MutationObserver(() => { if (document.querySelector('.edit-card')) window.__lateCards++; }); window.__cardWatch.observe(document.getElementById('messages'), { childList: true, subtree: true }); 0");
    await settled(before);
    assert.equal(await ev("window.__cardWatch.disconnect(), window.__lateCards"), 0, 'no card for the second change');
    assert.equal(file('util.js'), 'export const x = 3;\n');
    assert.equal(file('lib/new.js'), 'export const y = 2;\n');
    const summary = await ev(`(() => { const s = ${LAST}.querySelector('.coding-summary'); return { files: [...s.querySelectorAll('.coding-files li')].map(n => n.textContent), cost: s.querySelector('.coding-cost').textContent, undo: !!s.querySelector('.coding-undo') }; })()`);
    assert.deepEqual(summary.files.sort(), ['lib/new.js', 'util.js']);
    assert.match(summary.cost, /Input [\d.,]+K? \(\d+% cached\) · Output [\d.,]+K?/);
    assert.equal(summary.undo, true);
  });

  test('Undo is only on the latest task and restores its files', async () => {
    assert.equal(await ev("document.querySelectorAll('.coding-undo').length"), 1);
    await ev(`${LAST}.querySelector('.coding-undo').click(); 0`);
    await app.cdp.waitFor("document.querySelectorAll('.coding-undo').length === 0", 10000);
    assert.equal(file('util.js'), 'export const x = 1;\n');
    assert.equal(fs.existsSync(path.join(projectDir, 'lib/new.js')), false);
    assert.match(file('app.js'), /a \+ b/, 'an earlier task stays');
    assert.match(await ev(`${LAST}.querySelector('.coding-summary').textContent`), /Undone/);
  });

  test('Regenerate is hidden on a coding reply', async () => {
    assert.equal(await ev(`[...${LAST}.querySelectorAll('.message-actions button')].some(b => /Regenerate/.test(b.textContent))`), false);
  });

  test('stop while an edit waits writes nothing', async () => {
    cloud.setScript((body, n) => n === 1 ? { toolCalls: [{ name: 'edit_file', args: { path: 'util.js', edits: [{ old: 'x = 1', new: 'x = 9' }] } }] } : finish('should not get here'));
    const before = await send('Change x again.');
    await card();
    await ev("document.getElementById('send').click(); 0");
    await settled(before);
    assert.equal(file('util.js'), 'export const x = 1;\n');
    assert.equal(await ev("document.querySelectorAll('.edit-card').length"), 0);
    assert.equal(await ev('state.chat.Messages.at(-1).Interrupted'), true);
  });

  test('status shows steps, tokens, cache rate and context while a task runs and keeps them after', async () => {
    cloud.setScript((body, n) => n < 3 ? { toolCalls: [{ name: 'list_dir', args: { path: '.', depth: n } }], delayMs: 400 } : finish('Listed.'));
    const before = await send('List the project.');
    await app.cdp.waitFor("!document.getElementById('status-coding-steps').hidden && /step/.test(document.getElementById('status-coding-steps').textContent)", 20000);
    await settled(before);
    const s = await ev("({ steps: document.getElementById('status-coding-steps').textContent, tokens: document.getElementById('status-coding-tokens').textContent, ring: document.getElementById('status-coding-context').getAttribute('aria-valuenow'), hidden: document.getElementById('status-coding-tokens').hidden })");
    assert.match(s.steps, /^\d+ msgs? · 3 steps$/);
    assert.match(s.tokens, /^[\d.,]+K tokens · \d+% cached$/);
    assert.ok(Number(s.ring) >= 0 && Number(s.ring) <= 100);
    assert.equal(s.hidden, false, 'kept after the task');
  });

  test('context ring drops after compaction', async () => {
    await ev("LumenStatus.coding({ type: 'coding-status', runId: 'x', steps: 9, turns: 2, input: 90000, cached: 80000, output: 900, cacheRate: 0.88, contextUsed: 96000, contextSize: 128000 }); 0");
    assert.equal(await ev("document.getElementById('status-coding-context').getAttribute('aria-valuenow')"), '75');
    await ev("LumenStatus.coding({ type: 'coding-status', runId: 'x', steps: 10, turns: 2, input: 100000, cached: 85000, output: 950, cacheRate: 0.85, contextUsed: 30000, contextSize: 128000, compacted: true }); 0");
    assert.equal(await ev("document.getElementById('status-coding-context').getAttribute('aria-valuenow')"), '23');
  });

  test('budget stop shows a note with Continue', async () => {
    await ev("api.projects('coding-settings', { chatId: state.chat.Id, patch: { taskTokens: 2500 } }).then(() => 0)");
    cloud.setScript(() => ({ toolCalls: [{ name: 'list_dir', args: { path: '.' } }] }));
    const before = await send('Keep listing.');
    await settled(before);
    assert.equal(await ev(`!!${LAST}.querySelector('.coding-budget .coding-continue')`), true);
    await ev("api.projects('coding-settings', { chatId: state.chat.Id, patch: { taskTokens: 3000000 } }).then(() => 0)");
    cloud.setScript(() => finish('Continued.'));
    const n = await ev("document.querySelectorAll('.message.assistant').length");
    await ev(`${LAST}.querySelector('.coding-continue').click(); 0`);
    await settled(n);
    assert.equal(await ev("state.chat.Messages.filter(m => m.Role === 'user').at(-1).Content"), 'Continue.');
    assert.equal(await ev(`${LAST}.querySelector('.message-body').textContent.trim()`), 'Continued.');
  });

  test('coding settings save and reload limits and prices; a known price shows the amount', async () => {
    await ev('openProjectDialog().then(() => 0)');
    await app.cdp.waitFor("!!document.getElementById('coding-money')", 5000);
    await ev(`(() => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')); };
      set('coding-money', '0.5'); set('coding-tokens', '200000'); set('coding-steps', '30');
      const row = document.querySelector('.coding-price-row[data-model="custom/mock-chat"]');
      row.querySelector('.price-input').value = '1'; row.querySelector('.price-cached').value = '0.1'; row.querySelector('.price-output').value = '2';
      document.getElementById('coding-save').click(); return 0; })()`);
    await app.cdp.waitFor("api.projects('coding', {chatId: state.chat.Id}).then(r => r.settings.taskMoney === 0.5)", 5000);
    const s = await ev("api.projects('coding', {chatId: state.chat.Id}).then(r => r.settings)");
    assert.deepEqual([s.taskMoney, s.taskTokens, s.maxSteps, s.prices['custom/mock-chat'].output], [0.5, 200000, 30, 2]);
    await ev("document.getElementById('project-dialog').close(); 0");
    cloud.setScript(() => finish('Priced.'));
    const before = await send('One more.');
    await settled(before);
    assert.match(await ev(`${LAST}.querySelector('.coding-cost').textContent`), /≈ [\d.,]+ ¢$/);
  });

  test('Turkish strings on the change card and summary', async () => {
    await ev("(async () => { state.prefs = await api.preferences({ ...state.prefs, language: 'tr' }); localize(); return 0; })()");
    cloud.setScript((body, n) => n === 1 ? { toolCalls: [{ name: 'edit_file', args: { path: 'util.js', edits: [{ old: 'x = 1', new: 'x = 5' }] } }] } : finish('Tamam.'));
    const before = await send('x değiştir');
    await card();
    assert.deepEqual(await ev("['.edit-apply', '.edit-skip', '.edit-apply-all'].map(s => document.querySelector('.edit-card ' + s).textContent)"), ['Uygula', 'Atla', 'Bu görevde hepsini uygula']);
    await ev("document.querySelector('.edit-card .edit-apply').click(); 0");
    await settled(before);
    assert.match(await ev(`${LAST}.querySelector('.coding-cost').textContent`), /Girdi .* önbellek\) · Çıktı/);
    assert.match(await ev(`${LAST}.querySelector('.coding-undo').textContent`), /geri al/i);
    await ev("(async () => { state.prefs = await api.preferences({ ...state.prefs, language: 'en' }); localize(); return 0; })()");
  });
});
