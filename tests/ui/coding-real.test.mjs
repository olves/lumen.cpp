// The coding agent with a real local model: a small rename in a temp project, approved through the change card. Model quality
// decides the outcome, so a failure here reports what the model did. Skipped without an installed chat model.
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/coding-real.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, workRoot } from '../harness/launch.mjs';
import { pickModel, prepareData } from './data.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `coding-real-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data'), projectDir = path.join(runDir, 'greet-project');
const model = pickModel();
let app;
const ev = e => app.cdp.evaluate(e);

describe(`coding agent with a local model (${shell})`, { skip: model ? false : 'no installed model' }, () => {
  before(async () => {
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'greet.js'), "function hello(name) {\n  return 'Hello ' + name;\n}\n\nmodule.exports = { hello };\n");
    prepareData(dataDir, model);
    app = await launch({ shell, dataDir, env: { LUMEN_TEST_FILES: JSON.stringify([projectDir]) } });
    await app.cdp.waitFor('state.ready === true', 30000);
    await ev('attachProject().then(() => 0)');
    await app.cdp.waitFor('!!state.chat.Project', 10000);
    await ev("api.projects('allow-edits', { chatId: state.chat.Id, on: true }).then(() => loadCoding()).then(() => 0)");
  });
  after(async () => { await app?.stop(); });

  test('renames a function after the user approves the change', async () => {
    // Approve every change card as it appears, like a user clicking Apply.
    await ev("window.__approver = setInterval(() => { const b = document.querySelector('.edit-card .edit-apply'); if (b && !b.disabled) b.click(); }, 300); 0");
    await app.cdp.type('#prompt', 'In greet.js rename the function hello to greet, including the export. Change the file with edit_file, then finish.');
    await app.cdp.click('#send');
    await app.cdp.waitFor("document.querySelectorAll('.message.assistant').length > 0 && state.busy === false", 900000);
    await ev('clearInterval(window.__approver); 0');
    const text = fs.readFileSync(path.join(projectDir, 'greet.js'), 'utf8');
    const reply = await ev("[...document.querySelectorAll('.message.assistant')].at(-1).textContent");
    console.log('# reply:', reply.replace(/\s+/g, ' ').slice(0, 300));
    console.log('# file:', JSON.stringify(text));
    assert.match(text, /function greet\(name\)/);
    assert.match(text, /module\.exports = \{ greet \}/);
    assert.doesNotMatch(text, /hello\(/);
  });
});

// v1.1 with a real local model: Auto mode in a new workspace — make a folder, write a file, run a read-only command (no card),
// and report back. What the model chose is printed; the disk is checked.
describe(`v1.1 workspace agent with a local model (${shell})`, { skip: model ? false : 'no installed model' }, () => {
  const data2 = path.join(runDir, 'data-v11'), docs = path.join(runDir, 'Belgeler');
  let app2;
  const ev2 = e => app2.cdp.evaluate(e);
  before(async () => {
    fs.mkdirSync(docs, { recursive: true });
    prepareData(data2, model);
    app2 = await launch({ shell, dataDir: data2, env: { LUMEN_TEST_DOCUMENTS: docs } });
    await app2.cdp.waitFor('state.ready === true', 30000);
    await ev2("window.lumen.workspaces('create', {name: 'Deneme'}).then(r => { wsState = {...r, loaded: true}; return window.lumen.workspaces('mode', {id: r.created.id, mode: 'auto'}).then(x => { wsState = {...x, loaded: true}; return newChatIn(x.list.find(w => w.name === 'Deneme')); }); }).then(() => 0)");
    await app2.cdp.waitFor("state.chat.Project?.workspaceFolder === true", 10000);
  });
  after(async () => { await app2?.stop(); });

  test('creates a folder and a file, runs a command, answers', async () => {
    await ev2("window.__approver = setInterval(() => { const b = document.querySelector('.edit-card .edit-apply'); if (b && !b.disabled) b.click(); }, 300); 0");
    await app2.cdp.type('#prompt', 'Create a folder named src. Then create the file src/hello.txt with the text merhaba. Then run the command Get-ChildItem src and tell me what it listed. Finish when done.');
    await app2.cdp.click('#send');
    await app2.cdp.waitFor("document.querySelectorAll('.message.assistant').length > 0 && state.busy === false", 900000);
    await ev2('clearInterval(window.__approver); 0');
    const root = path.join(docs, 'Lumen', 'Deneme');
    const reply = await ev2("[...document.querySelectorAll('.message.assistant')].at(-1).textContent");
    const audit = fs.readFileSync(path.join(data2, 'agent-audit.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    console.log('# reply:', reply.replace(/\s+/g, ' ').slice(0, 300));
    console.log('# audit:', audit.map(a => `${a.tool}:${a.decision}`).join(' '));
    assert.ok(fs.existsSync(path.join(root, 'src', 'hello.txt')), 'src/hello.txt exists');
    assert.match(fs.readFileSync(path.join(root, 'src', 'hello.txt'), 'utf8'), /merhaba/);
    assert.ok(audit.some(a => a.tool === 'run_command' && a.decision === 'auto'), 'a read-only command ran without asking in Auto');
  });
});
