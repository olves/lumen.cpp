// codecontext.cjs: the coding agent's transcript, how it becomes a request (native tool calls or JSON steps) and compaction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const ctx = createRequire(import.meta.url)('../../app/codecontext.cjs');

const read = (step, id, file) => [
  { role: 'assistant', step, calls: [{ id, name: 'read_file', args: { path: file, start_line: 1, end_line: 80 } }] },
  { role: 'tool', step, id, name: 'read_file', args: { path: file, start_line: 1, end_line: 80 }, result: `read_file ${file} lines 1-80 of 200:\n` + 'x\n'.repeat(80) },
];

test('system text and tools are byte-identical across calls', () => {
  const a = [ctx.systemText({ projectName: 'demo', allowEdits: true, language: 'en' }), JSON.stringify(ctx.toolDefinitions(true, { createBytes: 204800 }))];
  const b = [ctx.systemText({ projectName: 'demo', allowEdits: true, language: 'en' }), JSON.stringify(ctx.toolDefinitions(true, { createBytes: 204800 }))];
  assert.deepEqual(a, b);
  assert.doesNotMatch(a[0], /\d{1,2}:\d{2}|20\d\d/, 'no clock or date in the system text');
});

test('edit tools appear only when edits are allowed', () => {
  const names = on => ctx.toolDefinitions(on, { createBytes: 204800 }).map(t => t.function.name);
  assert.deepEqual(names(false), ['list_dir', 'find_files', 'search_text', 'read_file', 'finish']);
  assert.deepEqual(names(true), ['list_dir', 'find_files', 'search_text', 'read_file', 'edit_file', 'create_file', 'finish']);
  assert.match(JSON.stringify(ctx.toolDefinitions(true, { createBytes: 12288 })), /12 KB/);
});

test('toChatMessages pairs tool_call ids with results', () => {
  const entries = [{ role: 'user', msg: 0, text: 'Fix the bug' }, ...read(1, 'c1', 'a.js')];
  const m = ctx.toChatMessages('SYS', entries);
  assert.deepEqual(m.map(x => x.role), ['system', 'user', 'assistant', 'tool']);
  assert.equal(m[2].tool_calls[0].id, 'c1');
  assert.equal(m[2].tool_calls[0].function.name, 'read_file');
  assert.deepEqual(JSON.parse(m[2].tool_calls[0].function.arguments), { path: 'a.js', start_line: 1, end_line: 80 });
  assert.equal(m[3].tool_call_id, 'c1');
});

test('two calls in one turn stay in one assistant message', () => {
  const entries = [{ role: 'user', msg: 0, text: 'x' },
    { role: 'assistant', step: 1, calls: [{ id: 'a', name: 'list_dir', args: { path: '.' } }, { id: 'b', name: 'find_files', args: { pattern: '*.js' } }] },
    { role: 'tool', step: 1, id: 'a', name: 'list_dir', args: { path: '.' }, result: 'r1' }, { role: 'tool', step: 1, id: 'b', name: 'find_files', args: { pattern: '*.js' }, result: 'r2' }];
  const m = ctx.toChatMessages('S', entries);
  assert.deepEqual(m.map(x => x.role), ['system', 'user', 'assistant', 'tool', 'tool']);
  assert.equal(m[2].tool_calls.length, 2);
});

test('toJsonStepMessages matches the existing step format', () => {
  const entries = [{ role: 'user', msg: 0, text: 'Fix it' }, ...read(1, 'c1', 'a.js'), { role: 'tool', step: 2, id: 'c2', name: 'read_file', args: {}, error: true, result: 'not found' }, { role: 'note', text: 'user undid task 1' }];
  const m = ctx.toJsonStepMessages('SYS', entries);
  assert.deepEqual(m[0], { role: 'system', content: 'SYS' });
  assert.deepEqual(JSON.parse(m[2].content), { action: 'read_file', path: 'a.js', start_line: 1, end_line: 80 });
  assert.equal(m[2].role, 'assistant');
  assert.match(m[3].content, /^TOOL RESULT — read_file a\.js/);
  assert.match(m[4].content, /^TOOL ERROR — not found/);
  assert.equal(m[5].content, 'NOTE: user undid task 1');
});

test('compact keeps the last 8 steps verbatim and stubs older reads', () => {
  const entries = [{ role: 'user', msg: 0, text: 'goal' }];
  for (let s = 1; s <= 12; s++) entries.push(...read(s, 'c' + s, `f${s}.js`));
  const out = ctx.compact(entries, { keepSteps: 8 });
  const tools = out.filter(e => e.role === 'tool');
  assert.match(tools[0].result, /^read_file f1\.js 1-80 — elided, read again if needed$/);
  assert.match(tools[3].result, /elided/);
  for (const t of tools.slice(4)) assert.match(t.result, /^read_file f\d+\.js lines 1-80 of 200:\n/, 'last 8 steps untouched');
  assert.ok(JSON.stringify(out).length < JSON.stringify(entries).length);
});

test('compact shortens old edit contents and keeps their outcome', () => {
  const entries = [{ role: 'user', msg: 0, text: 'goal' },
    { role: 'assistant', step: 1, calls: [{ id: 'e', name: 'create_file', args: { path: 'big.js', content: 'y'.repeat(5000) } }] },
    { role: 'tool', step: 1, id: 'e', name: 'create_file', args: { path: 'big.js' }, result: 'applied: created big.js (120 lines)' }];
  for (let s = 2; s <= 10; s++) entries.push(...read(s, 'c' + s, 'a.js'));
  const out = ctx.compact(entries, { keepSteps: 8 });
  assert.equal(out[1].calls[0].args.content, '[elided]');
  assert.equal(out[2].result, 'applied: created big.js (120 lines)');
});

test('compact never changes user entries or notes', () => {
  const entries = [{ role: 'user', msg: 0, text: 'goal '.repeat(500) }, { role: 'note', text: 'n' }];
  for (let s = 1; s <= 10; s++) entries.push(...read(s, 'c' + s, 'a.js'));
  const out = ctx.compact(entries, { keepSteps: 2 });
  assert.equal(out[0].text, entries[0].text); assert.deepEqual(out[1], entries[1]);
});

test('cutAt keeps entries of the first N messages only', () => {
  const entries = [{ role: 'user', msg: 0, text: 'a' }, { role: 'assistant', msg: 0, step: 1, calls: [] }, { role: 'user', msg: 2, text: 'b' }, { role: 'tool', msg: 2, step: 2, id: 'x', result: 'r' }];
  assert.deepEqual(ctx.cutAt(entries, 2).map(e => e.text || e.role), ['a', 'assistant']);
});

test('estimateTokens counts characters / 3 like the agent', () => {
  assert.equal(ctx.estimateTokens([{ role: 'user', content: 'x'.repeat(300) }]), 104);
  assert.equal(ctx.estimateTokens([{ role: 'assistant', content: null, tool_calls: [{ function: { arguments: 'y'.repeat(30) } }] }]) > 10, true);
});
