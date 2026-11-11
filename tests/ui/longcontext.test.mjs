// 64K context in the real app with Qwen3-8B (trained window 40960): the Runtime choice, the engine started with YaRN scaling
// (--rope-scale 1.6 --yarn-orig-ctx 40960) and the "tighter" cache, and a ~48K-token conversation whose hidden passphrase the model
// finds. Uses the Vulkan engine bundled with Lumen. Skipped when Qwen3-8B is not installed; the model is only read (hard link).
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/longcontext.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launch, workRoot } from '../harness/launch.mjs';
import { prepareData } from './data.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `longcontext-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data');
const model = path.join(process.env.LOCALAPPDATA, 'lumen.cpp', 'models', 'd98cdcbd03e1-Qwen3-8B-Q4_K_M.gguf');
const repo = path.resolve(workRoot, '..', 'repo');
let app;
const ev = e => app.cdp.evaluate(e);
const js = v => JSON.stringify(v);
const servers = () => spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" | Where-Object { $_.ExecutablePath -like '${dataDir.replace(/'/g, "''")}*' } | ForEach-Object { $_.CommandLine }`], { encoding: 'utf8' }).stdout.trim();

describe(`64K context (${shell})`, { skip: fs.existsSync(model) ? false : 'Qwen3-8B not installed' }, () => {
  before(async () => {
    prepareData(dataDir, model);
    fs.writeFileSync(path.join(dataDir, 'engine-preferences.json'), JSON.stringify({ SetupDone: true, Backend: 'vulkan' }));
    app = await launch({ shell, dataDir });
    await app.cdp.waitFor('state.ready === true', 30000);
  });
  after(async () => { await app?.stop(); });

  test('65,536 is offered and saved together with the tighter cache', async () => {
    assert.ok(await ev("[...document.getElementById('context-size').options].some(o => o.value === '65536')"));
    await ev("api.preferences({...state.prefs, contextMode: 'manual', contextSize: 65536, kvCache: 'k8v4'}).then(p => { state.prefs = p; return 0; })");
    assert.equal(await ev("api.preferences().then(p => p.contextSize + '/' + p.contextMode + '/' + p.kvCache)"), '65536/manual/k8v4');
  });

  test('a ~48K-token conversation: YaRN on, the passphrase is found', async () => {
    // Two earlier turns carry the document (each message stays under the 100K-character limit); the passphrase sits in the second.
    const corpus = ['docs/USER-GUIDE.md', 'docs/MEASUREMENTS.md', 'app/coder.cjs', 'app/core.cjs', 'app/agent.cjs', 'app/codewrite.cjs'].map(f => fs.readFileSync(path.join(repo, f), 'utf8')).join('\n\n');
    const part = n => { let t = ''; while (t.length < 95000) t += corpus; return t.slice(n * 7000, n * 7000 + 95000); };
    const second = part(1), at = second.indexOf('\n', 40000);
    const withNeedle = second.slice(0, at) + '\nImportant note for later: the secret passphrase for the vault is BLUE-ORCHID-4471.\n' + second.slice(at);
    const messages = [
      { Role: 'user', Content: 'Here is part 1 of a document. Just say OK.\n\n' + part(0), Interrupted: false }, { Role: 'assistant', Content: 'OK.', Interrupted: false },
      { Role: 'user', Content: 'Here is part 2 of the document. Just say OK.\n\n' + withNeedle, Interrupted: false }, { Role: 'assistant', Content: 'OK.', Interrupted: false },
    ];
    await ev(`(async () => { const chat = {...state.chat, Title: 'Long document', Messages: ${js(messages)}}; upsert(await api.request('save', {chat})); renderMessages(); return 0; })()`);
    await app.cdp.type('#prompt', 'What is the secret passphrase for the vault? Answer with the passphrase only.');
    await app.cdp.click('#send');
    await app.cdp.waitFor("state.busy === false && state.chat.Messages.at(-1)?.Role === 'assistant' && state.chat.Messages.length === 6", 1200000);
    const line = servers();
    console.log('# server:', line.replace(/.*llama-server\.exe"?/i, '').replace(/-m "[^"]+"/, '-m …').slice(0, 220));
    assert.match(line, /-c 65536 --rope-scaling yarn --rope-scale 1\.6 --yarn-orig-ctx 40960/);
    assert.match(line, /-ctk q8_0 -ctv q4_0/);
    const reply = await ev('state.chat.Messages.at(-1).Content');
    const used = await ev("statusState?.context ? JSON.stringify({used: statusState.context.Used ?? statusState.context.Prompt, capacity: statusState.context.Capacity}) : ''");
    console.log('# reply:', reply.replace(/\s+/g, ' ').slice(0, 120), '# context:', used);
    assert.match(reply, /BLUE-ORCHID-4471/);
  });
});
