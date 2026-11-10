// v1.1 workspaces and permission modes in the real app, with a scripted cloud model (mock provider) and the real lumen-exec.exe:
// sidebar groups, new workspace (folder under a test Documents), mode chip and menu, approval cards for folders and commands,
// Auto running a harmless command without asking, the outside-folder warning, moving a chat, deleting a workspace, Turkish.
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/workspaces.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, workRoot } from '../harness/launch.mjs';
import { execHelper } from '../harness/exechelper.mjs';
import { prepareData } from './data.mjs';
import { cloudServer } from './mocks.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `workspaces-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data'), docs = path.join(runDir, 'Belgeler'), outside = path.join(runDir, 'outside');
const js = v => JSON.stringify(v);
let app, cloud;
const ev = e => app.cdp.evaluate(e);
const finish = summary => ({ toolCalls: [{ name: 'finish', args: { summary } }] });
const LAST = "[...document.querySelectorAll('.message.assistant')].at(-1)";
async function send(text) {
  const before = await ev("document.querySelectorAll('.message.assistant').length");
  await app.cdp.type('#prompt', text); await app.cdp.click('#send');
  return before;
}
const settled = before => app.cdp.waitFor(`document.querySelectorAll('.message.assistant').length > ${before} && state.busy === false`, 60000);
const card = () => app.cdp.waitFor("!!document.querySelector('.edit-card .edit-apply')", 30000);
const clickApply = () => ev("document.querySelector('.edit-card .edit-apply').click(); 0");

describe(`workspaces and modes (${shell})`, () => {
  before(async () => {
    execHelper();
    fs.mkdirSync(docs, { recursive: true }); fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'secret-notes.txt'), 'outside text\n');
    cloud = await cloudServer();
    prepareData(dataDir, null);
    app = await launch({ shell, dataDir, env: { LUMEN_TEST_DOCUMENTS: docs } });
    await app.cdp.waitFor('state.ready === true', 30000);
    await ev(`window.lumen.connections('cloud', {enabled: true, consented: true})`);
    await ev(`window.lumen.connections('provider', {provider: 'custom', base: ${js(cloud.base)}, label: 'Mock cloud', key: ${js(cloud.key)}, models: [${js(cloud.model)}]})`);
    await ev(`window.lumen.projects('coding-consent', {chatId: state.chat.Id, provider: 'custom'})`);
    await ev(`window.lumen.request('models').then(m => { state.models = m; state.chat.Model = ${js('cloud:custom/' + cloud.model)}; renderPickers(); return 0; })`);
    await ev('window.confirm = () => true; 0');
  });
  after(async () => { await app?.stop(); cloud?.close(); });

  test('the sidebar shows the Default workspace and a New workspace button', async () => {
    await app.cdp.waitFor("!!document.querySelector('.ws-group[data-workspace=default]')", 10000);
    assert.equal(await ev("document.querySelector('.ws-group[data-workspace=default] .ws-name').textContent"), 'Default workspace');
    assert.ok(await ev("!!document.getElementById('new-workspace')"));
    assert.equal(await ev("document.querySelector('.ws-head .rail-label').textContent"), 'Workspaces');
  });

  test('creating a workspace makes Documents\\Lumen\\<name>, opens a chat there with the folder attached, mode Ask', async () => {
    await app.cdp.click('#new-workspace');
    await app.cdp.waitFor("document.getElementById('workspace-dialog').open", 5000);
    await app.cdp.type('#workspace-name', 'Site');
    await ev("document.querySelector('.ws-dialog .ws-create').click(); 0");
    await app.cdp.waitFor("state.chat.Project?.workspaceFolder === true && !!document.querySelector('.ws-group:not([data-workspace=default])')", 10000);
    assert.ok(fs.statSync(path.join(docs, 'Lumen', 'Site')).isDirectory());
    await app.cdp.waitFor("document.querySelector('.project-chip .mode-chip')?.textContent === 'Ask'", 5000);
    await ev(`state.chat.Model = ${js('cloud:custom/' + cloud.model)}; $('model-picker').value = state.chat.Model; 0`);
  });

  test('Ask: folder and command each show a card; the command output is logged with its exit code', async () => {
    cloud.setScript((body, n) => n === 1 ? { toolCalls: [{ name: 'make_dir', args: { path: 'src' } }] }
      : n === 2 ? { toolCalls: [{ name: 'run_command', args: { command: 'Write-Output "merhaba dünya"; Get-ChildItem -Name' } }] } : finish('Done.'));
    const before = await send('Make a src folder and list the files');
    await card();
    assert.match(await ev("document.querySelector('.edit-card strong').textContent"), /Create folder/);
    await clickApply();
    await app.cdp.waitFor("document.querySelector('.edit-card .edit-apply')?.textContent === 'Run'", 30000);
    assert.match(await ev("document.querySelector('.edit-card .cmd-text').textContent"), /merhaba dünya/);
    assert.ok(await ev("!document.querySelector('.edit-card .edit-apply-all')"), 'no "apply all" for commands');
    await clickApply();
    await settled(before);
    assert.ok(fs.statSync(path.join(docs, 'Lumen', 'Site', 'src')).isDirectory());
    // The live log belongs to the running reply; afterwards the reply's activity keeps the command and its exit code.
    const activity = await ev(`${LAST}.textContent`);
    assert.match(activity, /Ran Write-Output/); assert.match(activity, /exit 0/);
  });

  test('the mode menu switches to Auto; a harmless command runs without a card, a risky one asks', async () => {
    await ev("document.querySelector('.project-chip .mode-chip').click(); 0");
    await app.cdp.waitFor("!!document.querySelector('.ws-menu')", 5000);
    assert.equal(await ev("document.querySelectorAll('.ws-menu button').length"), 5);
    await ev("[...document.querySelectorAll('.ws-menu button')].find(b => b.textContent.startsWith('Auto')).click(); 0");
    await app.cdp.waitFor("document.querySelector('.project-chip .mode-chip')?.textContent === 'Auto'", 5000);
    cloud.setScript((body, n) => n === 1 ? { toolCalls: [{ name: 'run_command', args: { command: 'Get-ChildItem -Name' } }] }
      : n === 2 ? { toolCalls: [{ name: 'run_command', args: { command: 'Remove-Item src -Recurse' } }] } : finish('Checked.'));
    const before = await send('List and clean');
    await app.cdp.waitFor("document.querySelector('.edit-card .edit-apply')?.textContent === 'Run'", 30000);
    assert.match(await ev("document.querySelector('.edit-card .cmd-text').textContent"), /Remove-Item/);
    assert.match(await ev("document.querySelector('.cmd-log').textContent"), /ran without asking/);
    await ev("document.querySelector('.edit-card .edit-skip').click(); 0");
    await settled(before);
    assert.ok(fs.existsSync(path.join(docs, 'Lumen', 'Site', 'src')), 'skipped command did not run');
  });

  test('outside the folder the card warns, even in Auto', async () => {
    const target = path.join(outside, 'secret-notes.txt');
    cloud.setScript((body, n) => n === 1 ? { toolCalls: [{ name: 'read_file', args: { path: target } }] } : finish('Read it.'));
    const before = await send('Read the outside file');
    await card();
    assert.ok(await ev("document.querySelector('.edit-card').classList.contains('outside')"));
    assert.match(await ev("document.querySelector('.edit-card .outside-warn').textContent"), /Outside the workspace folder/);
    await clickApply();
    await settled(before);
  });

  test('Full access shows a red badge', async () => {
    await ev("document.querySelector('.project-chip .mode-chip').click(); 0");
    await app.cdp.waitFor("!!document.querySelector('.ws-menu')", 5000);
    await ev("[...document.querySelectorAll('.ws-menu button')].find(b => b.textContent.startsWith('Full access')).click(); 0");
    await app.cdp.waitFor("document.querySelector('.project-chip .mode-chip.danger')?.textContent === 'Full access'", 5000);
    const list = await ev("window.lumen.workspaces('list', {})");
    assert.equal(list.list.find(w => w.name === 'Site').mode, 'full');
  });

  test('Turkish: sidebar and mode chip', async () => {
    await ev("state.prefs.language = 'tr'; localize(); renderHistory(); renderToolChips(); 0");
    assert.equal(await ev("document.querySelector('.ws-head .rail-label').textContent"), 'Çalışma alanları');
    assert.equal(await ev("document.querySelector('.ws-group[data-workspace=default] .ws-name').textContent"), 'Varsayılan çalışma alanı');
    assert.equal(await ev("document.querySelector('.project-chip .mode-chip').textContent"), 'Tam erişim');
    await ev("state.prefs.language = 'en'; localize(); renderHistory(); renderToolChips(); 0");
  });

  test('deleting the workspace moves its chats to Default and keeps the folder', async () => {
    const id = await ev("window.lumen.workspaces('list', {}).then(r => r.list.find(w => w.name === 'Site').id)");
    await ev(`document.querySelector('.ws-group[data-workspace="${id}"] .ws-more').click(); 0`);
    await app.cdp.waitFor("!!document.querySelector('.ws-menu')", 5000);
    await ev("[...document.querySelectorAll('.ws-menu button')].find(b => b.textContent === 'Delete workspace').click(); 0");
    await app.cdp.waitFor(`!document.querySelector('.ws-group[data-workspace="${id}"]')`, 5000);
    assert.ok(fs.existsSync(path.join(docs, 'Lumen', 'Site', 'src')));
    assert.ok(await ev(`state.chats.some(c => c.Id === state.chat.Id)`));
    assert.ok(await ev("document.querySelector('.ws-group[data-workspace=default] .history-row') !== null"));
    assert.deepEqual(app.cdp.errors.filter(e => /exception|console.error/.test(e)), []);
  });
});
