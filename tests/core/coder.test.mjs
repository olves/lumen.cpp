// coder.cjs: the coding agent loop, driven by a scripted fake model (cloud tool calls or local JSON steps) over a real temp
// project folder. Approvals are answered from the event stream like the renderer does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createCoder } = require('../../app/coder.cjs');
const { createCodingStore } = require('../../app/codingstore.cjs');

const chatId = 'e'.repeat(32);
let seq = 0;
function setup({ files = { 'src/app.js': 'function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n' }, decide = () => 'apply', settings } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-coder-')), root = path.join(base, 'proj');
  for (const [n, b] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, n)), { recursive: true }); fs.writeFileSync(path.join(root, n), b); }
  const store = createCodingStore(base); if (settings) store.saveSettings(settings);
  const events = [], requests = [];
  let coder;
  const emit = e => { events.push(e); if (e.type === 'edit-approval') { const d = decide(e); if (d) setImmediate(() => coder.approve(e.runId, e.callId, d)); } };
  return { base, root, store, events, requests, read: n => fs.readFileSync(path.join(root, n), 'utf8'),
    make(script, { local = false } = {}) {
      let n = 0;
      const cloud = { chat: async args => { requests.push(args); const r = script(n++, args); return { content: r.content || '', toolCalls: (r.calls || []).map((c, i) => ({ id: c.id || `call_${n}_${i}`, name: c.name, arguments: typeof c.args === 'string' ? c.args : JSON.stringify(c.args) })), usage: r.usage || { prompt_tokens: 1000, completion_tokens: 20, prompt_cache_hit_tokens: n > 1 ? 900 : 0, prompt_cache_miss_tokens: n > 1 ? 100 : 1000 }, finish: 'stop' }; } };
      const engine = { complete: async args => { requests.push(args); const r = script(n++, args); return { content: r.content ?? JSON.stringify({ action: r.calls[0].name, ...r.calls[0].args }), promptTokens: 800, completionTokens: 30 }; } };
      coder = createCoder({ cloud, engine, store, checkpointsDir: path.join(base, 'cp'), emit });
      return coder;
    },
    options(extra = {}) { return { runId: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, chat: { Id: chatId, Messages: [{ Role: 'user', Content: 'fix add' }] }, msgIndex: 0, prompt: 'fix add', model: 'cloud:deepseek/deepseek-flash', cloudTarget: { provider: 'deepseek', model: 'deepseek-flash' }, contextSize: 128000, language: 'en', binding: { root, allow: [], exclude: [] }, allowEdits: true, ...extra }; },
  };
}
const fixCall = { name: 'edit_file', args: { path: 'src/app.js', edits: [{ old: 'return a - b;', new: 'return a + b;' }] } };

test('read-only run answers from finish', async () => {
  const s = setup();
  const coder = s.make(n => n === 0 ? { calls: [{ name: 'read_file', args: { path: 'src/app.js' } }] } : { calls: [{ name: 'finish', args: { summary: 'add subtracts; it should add.' } }] });
  const r = await coder.run(s.options({ allowEdits: false }));
  assert.equal(r.content, 'add subtracts; it should add.');
  assert.deepEqual(s.requests[0].tools.map(t => t.function.name), ['list_dir', 'find_files', 'search_text', 'read_file', 'finish']);
  assert.match(s.requests[1].messages.at(-1).content, /return a - b;/, 'tool result went back to the model');
  assert.equal(r.totals.steps, 2);
});

test('plain text reply ends the task as its answer', async () => {
  const s = setup();
  const r = await s.make(() => ({ content: 'Nothing to change.' })).run(s.options());
  assert.equal(r.content, 'Nothing to change.');
});

test('edit waits for approval and applies', async () => {
  const s = setup();
  const r = await s.make(n => n === 0 ? { calls: [fixCall] } : { calls: [{ name: 'finish', args: { summary: 'Fixed add in src/app.js.' } }] }).run(s.options());
  const approval = s.events.find(e => e.type === 'edit-approval');
  assert.equal(approval.change.path, 'src/app.js');
  assert.deepEqual([approval.change.added, approval.change.removed], [1, 1]);
  assert.match(s.read('src/app.js'), /return a \+ b;/);
  assert.deepEqual(r.files, ['src/app.js']);
  assert.equal(s.events.find(e => e.type === 'edit-done').decision, 'applied');
  assert.match(s.requests[1].messages.at(-1).content, /^applied/);
});

test('skip tells the model the user declined', async () => {
  const s = setup({ decide: () => 'skip' });
  const r = await s.make(n => n === 0 ? { calls: [fixCall] } : { calls: [{ name: 'finish', args: { summary: 'ok' } }] }).run(s.options());
  assert.match(s.read('src/app.js'), /return a - b;/);
  assert.match(s.requests[1].messages.at(-1).content, /declined/);
  assert.deepEqual(r.files, []);
});

test('apply-all stops asking for the rest of the task', async () => {
  const s = setup({ files: { 'a.txt': 'one\n', 'b.txt': 'two\n' }, decide: () => 'apply-all' });
  await s.make(n => n === 0 ? { calls: [{ name: 'edit_file', args: { path: 'a.txt', edits: [{ old: 'one', new: '1' }] } }] }
    : n === 1 ? { calls: [{ name: 'edit_file', args: { path: 'b.txt', edits: [{ old: 'two', new: '2' }] } }] } : { calls: [{ name: 'finish', args: { summary: 'done' } }] }).run(s.options());
  assert.equal(s.events.filter(e => e.type === 'edit-approval').length, 1);
  assert.deepEqual([s.read('a.txt'), s.read('b.txt')], ['1\n', '2\n']);
});

test('invalid tool call gets a correction, the third identical failure stops', async () => {
  const s = setup();
  const bad = { calls: [{ name: 'read_file', args: '{"path": broken' }] };
  const r = await s.make(() => bad).run(s.options());
  assert.equal(s.requests.length, 3);
  assert.match(s.requests[1].messages.at(-1).content, /ERROR/);
  assert.match(r.content, /stopped/i);
});

test('request start is identical between steps (cache)', async () => {
  const s = setup();
  await s.make(n => n < 3 ? { calls: [{ name: 'read_file', args: { path: 'src/app.js', start_line: n + 1, end_line: n + 2 } }] } : { calls: [{ name: 'finish', args: { summary: 'x' } }] }).run(s.options());
  const first = JSON.stringify(s.requests[0].messages), tools = JSON.stringify(s.requests[0].tools);
  for (const r of s.requests.slice(1)) {
    assert.ok(JSON.stringify(r.messages).startsWith(first.slice(0, -1)), 'earlier messages are a prefix of later ones');
    assert.equal(JSON.stringify(r.tools), tools);
  }
});

test('compaction triggers at 75 % and keeps the last 8 steps', async () => {
  const big = Array.from({ length: 280 }, (_, i) => `line ${i} ` + 'x'.repeat(60)).join('\n');
  const s = setup({ files: { 'big.js': big } });
  await s.make(n => n < 14 ? { calls: [{ name: 'read_file', args: { path: 'big.js', start_line: 1 + n, end_line: 280 } }] } : { calls: [{ name: 'finish', args: { summary: 'x' } }] }).run(s.options({ contextSize: 40000 }));
  const last = s.requests.at(-1).messages;
  assert.ok(last.some(m => /elided/.test(m.content || '')), 'older reads were stubbed');
  assert.ok(Math.ceil(JSON.stringify(last).length / 3) < 40000, 'stays inside the window');
  assert.ok(s.events.some(e => e.type === 'coding-status' && e.compacted));
});

test('token budget stops the run with budgetStop tokens', async () => {
  const s = setup({ settings: { taskTokens: 2500 } });
  const r = await s.make(() => ({ calls: [{ name: 'list_dir', args: { path: '.' } }] })).run(s.options());
  assert.equal(r.budgetStop, 'tokens');
  assert.ok(s.requests.length <= 3);
});

test('local model gets JSON steps and no carried transcript', async () => {
  const s = setup();
  const coder = s.make(n => n === 0 ? { calls: [{ name: 'read_file', args: { path: 'src/app.js' } }] } : { calls: [{ name: 'finish', args: { summary: 'first' } }] }, { local: true });
  await coder.run(s.options({ cloudTarget: null, model: 'Qwen2.5 Coder 7B', contextSize: 16384 }));
  const firstRun = s.requests.length;
  assert.ok(s.requests[0].schema, 'grammar schema for local steps');
  assert.equal(s.requests[0].maxTokens <= 4096, true);
  assert.deepEqual(JSON.parse(s.requests[1].messages.at(-2).content), { action: 'read_file', path: 'src/app.js' });
  const coder2 = s.make(() => ({ calls: [{ name: 'finish', args: { summary: 'second' } }] }), { local: true });
  await coder2.run(s.options({ cloudTarget: null, model: 'Qwen2.5 Coder 7B', contextSize: 16384, prompt: 'again', msgIndex: 2 }));
  const text = JSON.stringify(s.requests[firstRun].messages);
  assert.doesNotMatch(text, /TOOL RESULT/, 'no earlier tool results');
  assert.match(text, /first/, 'the previous summary is carried');
});

test('cancel while an approval waits writes nothing', async () => {
  const s = setup({ decide: () => null });
  const coder = s.make(n => n === 0 ? { calls: [fixCall] } : { calls: [{ name: 'finish', args: { summary: 'x' } }] });
  const options = s.options();
  const running = coder.run(options);
  while (!s.events.some(e => e.type === 'edit-approval')) await new Promise(r => setTimeout(r, 5));
  coder.cancel(options.runId);
  const r = await running;
  assert.equal(r.cancelled, true);
  assert.match(s.read('src/app.js'), /return a - b;/);
  assert.equal(s.events.find(e => e.type === 'edit-done').decision, 'skipped');
});

test('edit outside the root becomes a tool error, not a write', async () => {
  const s = setup();
  await s.make(n => n === 0 ? { calls: [{ name: 'create_file', args: { path: '../evil.txt', content: 'x' } }] } : { calls: [{ name: 'finish', args: { summary: 'x' } }] }).run(s.options());
  assert.equal(fs.existsSync(path.join(s.base, 'evil.txt')), false);
  assert.match(s.requests[1].messages.at(-1).content, /^ERROR: .*outside/);
  assert.equal(s.events.filter(e => e.type === 'edit-approval').length, 0);
});

test('undo restores the latest task and notes it in the transcript', async () => {
  const s = setup();
  const coder = s.make(n => n === 0 ? { calls: [fixCall] } : { calls: [{ name: 'finish', args: { summary: 'Fixed.' } }] });
  const r = await coder.run(s.options());
  const u = await coder.undo(chatId, r.taskId, { root: s.root, allow: [] });
  assert.deepEqual(u.restored, ['src/app.js']);
  assert.match(s.read('src/app.js'), /return a - b;/);
  assert.equal(s.store.get(chatId).tasks.at(-1).undone, true);
  assert.match(s.store.get(chatId).entries.at(-1).text, /undid/);
  await assert.rejects(coder.undo(chatId, 'not-the-latest', { root: s.root, allow: [] }), /latest/);
});
