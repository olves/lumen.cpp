// effort.cjs (which reasoning-effort levels a model offers) and the run setting that stores the user's choice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { effortOf } = require('../../app/effort.cjs');
const { createRunSettings } = require('../../app/runsettings.cjs');

test('DeepSeek offers low, high and max (its API lists these), by provider or by model name', () => {
  assert.deepEqual(effortOf('cloud:deepseek/deepseek-flash'), { levels: ['low', 'high', 'max'], def: 'high' });
  assert.deepEqual(effortOf('cloud:custom/deepseek-v4-pro').levels, ['low', 'high', 'max']);
  assert.deepEqual(effortOf('cloud:openrouter/deepseek/deepseek-v4-pro').levels, ['low', 'high', 'max']);
});

test('OpenAI reasoning models offer low, medium and high', () => {
  for (const m of ['cloud:openai/o3', 'cloud:openai/o4-mini', 'cloud:openai/gpt-5', 'cloud:openrouter/openai/gpt-5-mini']) assert.deepEqual(effortOf(m), { levels: ['low', 'medium', 'high'], def: 'medium' }, m);
});

test('models without effort levels: local models, Anthropic, non-reasoning OpenAI models', () => {
  for (const m of ['Qwen2.5 Coder 7B', 'cloud:anthropic/claude-sonnet-4', 'cloud:openai/gpt-4o', 'cloud:gemini/gemini-2.5-flash', '']) assert.deepEqual(effortOf(m), { levels: [], def: null }, m);
});

test('the run setting stores effort per chat and rejects unknown levels', () => {
  const r = createRunSettings(fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-eff-')));
  const id = 'a'.repeat(32);
  r.set(id, { effort: 'max' });
  assert.equal(r.effective(id, {}).effort, 'max');
  assert.throws(() => r.set(id, { effort: 'ultra' }), /Invalid effort/);
  r.set(id, { effort: null });
  assert.equal(r.effective(id, {}).effort, undefined, 'unset = the model default');
  assert.equal(r.effective(id, { sampling: { effort: 'low' } }).effort, 'low', '"Use for new chats" default');
});
