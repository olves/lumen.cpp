// connections.cjs: several custom (OpenAI-compatible) providers next to the built-in ones. The first stays "custom" so saved
// chats keep their model names; added ones are custom2 … custom9, each with its own address, key and models.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createConnections } = require('../../app/connections.cjs');
const { effortOf } = require('../../app/effort.cjs');

const secrets = { available: async () => true, encrypt: async s => 'enc:' + s, decrypt: async s => s.replace(/^enc:/, '') };
const make = () => createConnections(fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-conn-')), secrets);

test('a second custom provider is added beside the first, each with its own address, key and models', async () => {
  const c = make();
  await c.setCloud({ enabled: true, consented: true });
  await c.setCloudProvider('custom', { label: 'Experiential Labs', base: 'https://api.experientiallabs.ai/v1', key: 'k1', models: ['deepseek-v4.1-flash'] });
  const id = await c.addCustomProvider();
  assert.equal(id, 'custom2');
  await c.setCloudProvider(id, { label: 'My server', base: 'http://127.0.0.1:8080/v1', key: 'k2', models: ['qwen3-8b'] });
  const p = c.summary().cloud.providers;
  assert.equal(p.custom.label, 'Experiential Labs');
  assert.equal(p.custom2.label, 'My server');
  assert.equal(p.custom2.base, 'http://127.0.0.1:8080/v1');
  assert.equal(p.custom2.custom, true, 'the view marks custom providers');
  assert.equal(await c.cloudKey('custom'), 'k1');
  assert.equal(await c.cloudKey('custom2'), 'k2');
  assert.deepEqual(c.cloudModels().map(m => m.name).sort(), ['cloud:custom/deepseek-v4.1-flash', 'cloud:custom2/qwen3-8b']);
  assert.deepEqual(c.parseCloud('cloud:custom2/qwen3-8b'), { provider: 'custom2', model: 'qwen3-8b' });
  assert.equal(c.providerLabel('custom2'), 'My server');
  assert.equal(c.baseOf('custom2'), 'http://127.0.0.1:8080/v1');
});

test('removing an added custom provider deletes its key and models; the first custom slot cannot be removed', async () => {
  const c = make();
  await c.setCloud({ enabled: true });
  const id = await c.addCustomProvider();
  await c.setCloudProvider(id, { base: 'https://a.example/v1', key: 'k', models: ['m'] });
  await c.removeCustomProvider(id);
  assert.equal(c.summary().cloud.providers[id], undefined);
  assert.equal(await c.cloudKey(id), '');
  assert.throws(() => c.removeCustomProvider('custom'), /cannot be removed/);
  assert.throws(() => c.removeCustomProvider('openai'), /cannot be removed/);
});

test('at most nine custom providers; unknown ids are refused', async () => {
  const c = make();
  for (let i = 2; i <= 9; i++) assert.equal(await c.addCustomProvider(), 'custom' + i);
  await assert.rejects(c.addCustomProvider(), /up to 9/);
  await assert.rejects(c.setCloudProvider('custom10', { base: 'https://x.example/v1' }), /Unknown provider/);
  assert.equal(c.parseCloud('cloud:custom10/m'), null);
});

test('reasoning effort works for models on an added custom provider', () => {
  assert.deepEqual(effortOf('cloud:custom2/deepseek-v4.1-flash').levels, ['low', 'high', 'max']);
});

test('web research with cloud models is off by default and is saved when turned on', async () => {
  const c = make();
  assert.equal(c.summary().cloud.webResearch, false);
  await c.setCloud({ enabled: true, webResearch: true });
  assert.equal(c.summary().cloud.webResearch, true);
  await c.setCloud({ webResearch: false });
  assert.equal(c.summary().cloud.webResearch, false);
});
