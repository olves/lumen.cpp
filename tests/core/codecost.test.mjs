// codecost.cjs (usage, cost, budget) and codingstore.cjs (per-chat coding state and settings).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const cost = require('../../app/codecost.cjs');
const { createCodingStore } = require('../../app/codingstore.cjs');
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-cc-'));
const id = 'c'.repeat(32), other = 'd'.repeat(32);

test('normalizes DeepSeek, OpenAI and local usage', () => {
  assert.deepEqual(cost.normalizeUsage({ prompt_tokens: 2005, completion_tokens: 74, prompt_cache_hit_tokens: 1792, prompt_cache_miss_tokens: 213 }), { input: 2005, cached: 1792, output: 74 });
  assert.deepEqual(cost.normalizeUsage({ prompt_tokens: 1000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 600 } }), { input: 1000, cached: 600, output: 10 });
  assert.deepEqual(cost.normalizeUsage({ prompt: 900, generated: 40 }), { input: 900, cached: 0, output: 40 });
  assert.deepEqual(cost.normalizeUsage(null), { input: 0, cached: 0, output: 0 });
});

test('totals add up and the cache rate is hits over input', () => {
  let t = cost.addUsage(null, { prompt_tokens: 2005, completion_tokens: 80, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 2005 });
  t = cost.addUsage(t, { prompt_tokens: 2005, completion_tokens: 74, prompt_cache_hit_tokens: 1792, prompt_cache_miss_tokens: 213 });
  assert.deepEqual(t, { input: 4010, cached: 1792, output: 154, steps: 2 });
  assert.equal(Math.round(cost.cacheRate(t) * 1000) / 1000, 0.447);
  assert.equal(cost.cacheRate({ input: 0, cached: 0, output: 0 }), null);
});

test('cost uses the cached price for hits', () => {
  const prices = { 'deepseek/deepseek-flash': { input: 1, cachedInput: 0.1, output: 2, currency: 'USD' } };
  const c = cost.costOf('deepseek/deepseek-flash', { input: 1_000_000, cached: 500_000, output: 100_000 }, prices);
  assert.deepEqual(c, { amount: 0.5 + 0.05 + 0.2, currency: 'USD' });
});

test('unknown model gives null cost', () => {
  assert.equal(cost.costOf('openai/gpt-x', { input: 10, cached: 0, output: 1 }, {}), null);
});

test('token limit applies without a price; money limit only with one', () => {
  const settings = { taskTokens: 1000, taskMoney: 0.2 };
  assert.equal(cost.overBudget({ input: 900, cached: 0, output: 101 }, null, settings), 'tokens');
  assert.equal(cost.overBudget({ input: 10, cached: 0, output: 1 }, null, settings), null);
  assert.equal(cost.overBudget({ input: 10, cached: 0, output: 1 }, { amount: 0.25, currency: 'USD' }, settings), 'money');
  assert.equal(cost.overBudget({ input: 10, cached: 0, output: 1 }, { amount: 0.1, currency: 'USD' }, settings), null);
});

test('store: defaults, settings save, allow edits per chat', () => {
  const d = dir(), s = createCodingStore(d);
  assert.deepEqual(s.settings(), { prices: {}, taskMoney: 0.2, taskTokens: 3000000, maxSteps: 40, deepThinking: false, consented: [] });
  s.saveSettings({ taskMoney: 0.5, maxSteps: 999, prices: { 'deepseek/deepseek-flash': { input: 1, cachedInput: 0.1, output: 2, currency: 'USD' } } });
  const again = createCodingStore(d).settings();
  assert.equal(again.taskMoney, 0.5);
  assert.equal(again.maxSteps, 100, 'steps are capped');
  assert.equal(again.prices['deepseek/deepseek-flash'].output, 2);
  assert.equal(s.get(id).allowEdits, false);
  s.setAllowEdits(id, true);
  assert.equal(createCodingStore(d).get(id).allowEdits, true);
});

test('store: invalid settings are refused', () => {
  const s = createCodingStore(dir());
  assert.throws(() => s.saveSettings({ taskMoney: -1 }), /Invalid/);
  assert.throws(() => s.saveSettings({ prices: { x: { input: 'a' } } }), /Invalid/);
});

test('store: entries, tasks, undo mark, branch keeps entries up to the message', () => {
  const s = createCodingStore(dir());
  s.appendEntries(id, [{ role: 'user', msg: 0, text: 'a' }, { role: 'user', msg: 2, text: 'b' }]);
  s.addTask(id, { taskId: 't1', msg: 1, files: ['a.js'], totals: { input: 1, cached: 0, output: 1 }, cost: null });
  s.addTask(id, { taskId: 't2', msg: 3, files: ['b.js'], totals: { input: 1, cached: 0, output: 1 }, cost: null });
  s.markUndone(id, 't2');
  assert.equal(s.get(id).tasks.find(t => t.taskId === 't2').undone, true);
  s.branch(id, other, 2);
  assert.deepEqual(s.get(other).entries.map(e => e.text), ['a']);
  assert.deepEqual(s.get(other).tasks.map(t => t.taskId), ['t1']);
  s.replaceEntries(id, []); assert.deepEqual(s.get(id).entries, []);
  s.forget(id); assert.deepEqual(s.get(id).tasks, []);
});
