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
