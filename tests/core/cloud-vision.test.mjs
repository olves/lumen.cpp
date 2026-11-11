// v1.2 cloud vision: photos go as image_url parts; a provider that refuses them gets the request without images; which models see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createCloud } = require('../../app/cloud.cjs');
const { sees } = require('../../app/cloudvision.cjs');

const connections = { baseOf: () => 'https://api.example.test/v1', cloudKey: async () => 'sk-test', providerLabel: p => p };
const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
const reply = text => json({ choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }] });
const photo = { mime: 'image/png', data: 'iVBORw0KGgo=' };

test('a message with a photo becomes text + image_url parts; others stay plain', async () => {
  const bodies = [];
  const cloud = createCloud({ connections, fetchImpl: async (u, init) => { bodies.push(JSON.parse(init.body)); return reply('a cat'); } });
  const r = await cloud.chat({ provider: 'openai', model: 'gpt-4o', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'what is this?', images: [photo] }] });
  assert.equal(r.content, 'a cat'); assert.equal(r.imagesDropped, false);
  const m = bodies[0].messages;
  assert.equal(m[0].content, 's');
  assert.deepEqual(m[1].content, [{ type: 'text', text: 'what is this?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }]);
  assert.ok(!('images' in m[1]), 'the neutral images field never goes out');
});

test('a provider that refuses images: optional fields first, then without images, and the caller is told', async () => {
  const bodies = [];
  const cloud = createCloud({ connections, fetchImpl: async (u, init) => { const b = JSON.parse(init.body); bodies.push(b); return Array.isArray(b.messages.at(-1).content) ? new Response('{"error":{"message":"image input not supported"}}', { status: 400 }) : reply('text only'); } });
  const r = await cloud.chat({ provider: 'custom', model: 'some-model', messages: [{ role: 'user', content: 'look', images: [photo] }], temperature: 0.5 });
  assert.equal(bodies.length, 3);
  assert.equal(typeof bodies[2].messages[0].content, 'string');
  assert.equal(r.content, 'text only'); assert.equal(r.imagesDropped, true);
});

test('without images a 400 still fails after the minimal retry (no third try)', async () => {
  let calls = 0;
  const cloud = createCloud({ connections, fetchImpl: async () => { calls++; return new Response('{"error":{"message":"bad"}}', { status: 400 }); } });
  await assert.rejects(cloud.chat({ provider: 'custom', model: 'm', messages: [{ role: 'user', content: 'x' }] }));
  assert.equal(calls, 2);
});

test('which cloud models see photos', () => {
  for (const n of ['cloud:openai/gpt-4o-mini', 'cloud:openai/gpt-5', 'cloud:gemini/gemini-2.5-flash', 'cloud:deepseek/deepseek-flash', 'cloud:openrouter/anthropic/claude-sonnet-4', 'cloud:openrouter/qwen/qwen2.5-vl-72b-instruct']) assert.equal(sees(n), 'yes', n);
  for (const n of ['cloud:deepseek/deepseek-v4-pro', 'cloud:openai/gpt-3.5-turbo', 'cloud:openai/text-embedding-3-small', 'qwen2.5-7b']) assert.equal(sees(n), 'no', n);
  assert.equal(sees('cloud:custom/my-model'), 'maybe');
});
