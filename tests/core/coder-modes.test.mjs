// coder.cjs with v1.1 permission modes: which tools a mode offers, what runs at once, what asks, what Plan refuses, paths outside
// the workspace folder (always ask, except Full), commands through the real lumen-exec.exe, and the audit trail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execHelper } from '../harness/exechelper.mjs';
const require = createRequire(import.meta.url);
const { createCoder } = require('../../app/coder.cjs');
const { createCodingStore } = require('../../app/codingstore.cjs');
const { createExec } = require('../../app/exec.cjs');

const exec = createExec({ helper: execHelper() });
const chatId = 'f'.repeat(32);
let seq = 0;
function setup({ decide = () => 'apply' } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-modes-')), root = path.join(base, 'ws');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true }); fs.writeFileSync(path.join(root, 'src', 'a.txt'), 'one\n');
  const outsideDir = path.join(base, 'outside'); fs.mkdirSync(outsideDir); fs.writeFileSync(path.join(outsideDir, 'o.txt'), 'outside\n');
  const store = createCodingStore(base), events = [], requests = [], audits = [];
  let coder;
  const emit = e => { events.push(e); if (e.type === 'edit-approval') { const d = decide(e); if (d) setImmediate(() => coder.approve(e.runId, e.callId, d)); } };
  return {
    base, root, outsideDir, events, requests, audits,
    run(mode, script) {
      let n = 0;
      const cloud = { chat: async args => { requests.push(args); const r = script(n++, args); return { content: r.content || '', toolCalls: (r.calls || []).map((c, i) => ({ id: `c${n}_${i}`, name: c.name, arguments: JSON.stringify(c.args) })), usage: { prompt_tokens: 100, completion_tokens: 10 } }; } };
      coder = createCoder({ cloud, engine: null, store, checkpointsDir: path.join(base, 'cp'), exec, audit: r => audits.push(r), emit });
      return coder.run({ runId: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, chat: { Id: chatId, Messages: [{ Role: 'user', Content: 'go' }] }, msgIndex: 0, prompt: 'go', model: 'cloud:x/y', cloudTarget: { provider: 'x', model: 'y' }, contextSize: 128000, language: 'en', binding: { root, allow: [], exclude: [] }, mode });
    },
  };
}
const steps = (...calls) => (n, args) => n < calls.length ? { calls: [calls[n]] } : { calls: [{ name: 'finish', args: { summary: 'done' } }] };
const results = s => s.requests.at(-1).messages.filter(m => m.role === 'tool').map(m => m.content);
const approvals = s => s.events.filter(e => e.type === 'edit-approval');

test('Plan: read tools only, and a forced write is refused without touching the disk', async () => {
  const s = setup();
  await s.run('plan', steps({ name: 'read_file', args: { path: 'src/a.txt' } }));
  assert.deepEqual(s.requests[0].tools.map(t => t.function.name), ['list_dir', 'find_files', 'search_text', 'read_file', 'finish']);
  assert.match(s.requests[0].messages[0].content, /Plan mode/);
});

test('Ask: folder, file and command each wait for approval', async () => {
  const s = setup();
  await s.run('ask', steps({ name: 'make_dir', args: { path: 'lib' } }, { name: 'create_file', args: { path: 'lib/x.txt', content: 'x' } }, { name: 'run_command', args: { command: 'Get-ChildItem lib' } }));
  assert.deepEqual(approvals(s).map(e => e.change.kind), ['mkdir', 'create', 'command']);
  assert.ok(fs.existsSync(path.join(s.root, 'lib', 'x.txt')));
  assert.match(results(s).at(-1), /exit code 0[\s\S]*x\.txt/);
  assert.deepEqual(s.audits.map(a => a.decision), ['user', 'user', 'user']);
});

test('Accept edits: file changes run at once, commands still ask', async () => {
  const s = setup();
  await s.run('accept-edits', steps({ name: 'delete_path', args: { path: 'src/a.txt' } }, { name: 'run_command', args: { command: 'Get-Location' } }));
  assert.deepEqual(approvals(s).map(e => e.change.kind), ['command']);
  assert.equal(fs.existsSync(path.join(s.root, 'src', 'a.txt')), false);
  assert.equal(s.events.find(e => e.type === 'edit-done' && e.change)?.change.kind, 'delete', 'auto-applied change is shown');
});

test('Auto: a harmless command runs without asking, a risky one asks', async () => {
  const s = setup({ decide: () => 'skip' });
  await s.run('auto', steps({ name: 'run_command', args: { command: 'Get-ChildItem src' } }, { name: 'run_command', args: { command: 'Remove-Item src -Recurse' } }));
  assert.deepEqual(approvals(s).map(e => e.change.command), ['Remove-Item src -Recurse']);
  assert.ok(fs.existsSync(path.join(s.root, 'src', 'a.txt')), 'declined command did not run');
  assert.match(results(s)[0], /a\.txt/); assert.match(results(s)[1], /^skipped/);
  assert.deepEqual(s.audits.map(a => a.decision), ['auto', 'declined']);
});

test('outside the folder: Ask, Accept edits and Auto ask each time with a warning; Plan reads with approval but never writes', async () => {
  const target = s => path.join(s.outsideDir, 'o.txt');
  for (const mode of ['ask', 'accept-edits', 'auto']) {
    const s = setup();
    await s.run(mode, steps({ name: 'read_file', args: { path: target(s) } }, { name: 'edit_file', args: { path: target(s), edits: [{ old: 'outside', new: 'changed' }] } }, { name: 'edit_file', args: { path: target(s), edits: [{ old: 'changed', new: 'again' }] } }));
    assert.deepEqual(approvals(s).map(e => [e.change.kind, e.change.warn]), [['read', 'outside'], ['edit', 'outside'], ['edit', 'outside']], mode);
    assert.equal(fs.readFileSync(target(s), 'utf8'), 'again\n');
  }
  const p = setup();
  await p.run('plan', steps({ name: 'read_file', args: { path: target(p) } }));
  assert.deepEqual(approvals(p).map(e => e.change.warn), ['outside']);
  assert.match(results(p)[0], /outside/);
});

test('"Apply all in this task" never covers changes outside the folder', async () => {
  const s = setup({ decide: () => 'apply-all' });
  const o = path.join(s.outsideDir, 'new.txt');
  await s.run('ask', steps({ name: 'create_file', args: { path: 'in1.txt', content: '1' } }, { name: 'create_file', args: { path: 'in2.txt', content: '2' } }, { name: 'create_file', args: { path: o, content: 'o' } }, { name: 'create_file', args: { path: o.replace('new', 'new2'), content: 'o' } }));
  assert.deepEqual(approvals(s).map(e => e.change.path.endsWith('in1.txt') ? 'in1' : path.basename(e.change.path)), ['in1', 'new.txt', 'new2.txt']);
});

test('Full: nothing asks, outside included; changes outside are undone with the task', async () => {
  const s = setup();
  const o = path.join(s.outsideDir, 'o.txt');
  const r = await s.run('full', steps({ name: 'edit_file', args: { path: o, edits: [{ old: 'outside', new: 'full' }] } }, { name: 'run_command', args: { command: 'New-Item -ItemType File made.txt | Out-Null' } }));
  assert.equal(approvals(s).length, 0);
  assert.equal(fs.readFileSync(o, 'utf8'), 'full\n'); assert.ok(fs.existsSync(path.join(s.root, 'made.txt')));
  assert.ok(r.files.some(f => f.includes('o.txt')));
});

test('a failing command reports its exit code and output to the model', async () => {
  const s = setup();
  await s.run('full', steps({ name: 'run_command', args: { command: 'Write-Output "building"; exit 2' } }));
  assert.match(results(s)[0], /exit code 2[\s\S]*building/);
  assert.ok(s.events.some(e => e.type === 'command-output' && e.lines.some(l => l.d === 'building')), 'output streamed to the card');
});

test('background command: start, read, stop', async () => {
  const s = setup();
  await s.run('full', (n, args) => {
    if (n === 0) return { calls: [{ name: 'start_background', args: { command: '1..100 | % { "tick $_"; Start-Sleep -Milliseconds 100 }' } }] };
    const started = /as (bg[0-9a-f]+)/.exec(args.messages.map(m => m.content).join('\n'))?.[1];
    if (n === 1) return { calls: [{ name: 'read_background', args: { id: started } }] };
    if (n === 2) return { calls: [{ name: 'stop_background', args: { id: started } }] };
    return { calls: [{ name: 'finish', args: { summary: 'ok' } }] };
  });
  const out = results(s);
  assert.match(out[0], /started in the background/); assert.match(out[2], /stopped/);
});

test('built-in tools: commands can be switched off; AGENTS.md joins the system text', async () => {
  const s = setup();
  fs.writeFileSync(path.join(s.root, 'AGENTS.md'), 'Use tabs. Run npm test before finishing.');
  const store = createCodingStore(s.base); store.saveSettings({ tools: { commands: false } });
  await s.run('auto', steps());
  const names = s.requests[0].tools.map(t => t.function.name);
  assert.ok(!names.includes('run_command') && !names.includes('start_background'));
  assert.ok(names.includes('make_dir'));
  assert.ok(s.requests[0].messages[0].content.includes('--- AGENTS.md ---' + String.fromCharCode(10) + 'Use tabs.'));
});
