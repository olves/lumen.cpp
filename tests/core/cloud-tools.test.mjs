// cloud.cjs chat with native tool calls: request fields and how streamed tool_calls are joined. A fake fetch stands in for
// the provider; nothing leaves the machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createCloud } = createRequire(import.meta.url)('../../app/cloud.cjs');

const connections = { baseOf: () => 'https://api.example.test/v1', cloudKey: async () => 'sk-test', providerLabel: p => p };
function fakeFetch(respond) {
  const bodies = [];
  const impl = async (url, init) => { bodies.push(JSON.parse(init.body)); return respond(JSON.parse(init.body)); };
  return { impl, bodies };
}
const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
const sse = chunks => new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(x)}\n\n`)); c.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const tools = [{ type: 'function', function: { name: 'read_file', description: 'r', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }];

test('non-stream response returns tool_calls', async () => {
  const f = fakeFetch(() => json({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.js"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 3 } }));
  const cloud = createCloud({ connections, fetchImpl: f.impl });
  const r = await cloud.chat({ provider: 'deepseek', model: 'deepseek-flash', messages: [{ role: 'user', content: 'x' }], tools });
  assert.deepEqual(r.toolCalls, [{ id: 'c1', name: 'read_file', arguments: '{"path":"a.js"}' }]);
  assert.equal(r.finish, 'tool_calls');
  assert.deepEqual(f.bodies[0].tools, tools);
  assert.equal(f.bodies[0].tool_choice, 'auto');
});

test('stream joins split tool_call arguments by index', async () => {
  const f = fakeFetch(() => sse([
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'read_file', arguments: '' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 1, id: 'c2', type: 'function', function: { name: 'read_file', arguments: '{"pa' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a.js"}' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: 'th":"b.js"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 50, completion_tokens: 9, prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 10 } },
  ]));
  const cloud = createCloud({ connections, fetchImpl: f.impl });
  const r = await cloud.chat({ provider: 'deepseek', model: 'deepseek-flash', messages: [{ role: 'user', content: 'x' }], tools });
  assert.deepEqual(r.toolCalls, [{ id: 'c1', name: 'read_file', arguments: '{"path":"a.js"}' }, { id: 'c2', name: 'read_file', arguments: '{"path":"b.js"}' }]);
  assert.equal(r.usage.prompt_cache_hit_tokens, 40, 'usage with cache counts is passed through');
});

test('no tools: no tool fields are sent and toolCalls is empty', async () => {
  const f = fakeFetch(() => json({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] }));
  const r = await createCloud({ connections, fetchImpl: f.impl }).chat({ provider: 'openai', model: 'gpt-x', messages: [{ role: 'user', content: 'x' }] });
  assert.deepEqual(r.toolCalls, []);
  assert.equal('tools' in f.bodies[0], false);
  assert.equal('tool_choice' in f.bodies[0], false);
});

test('reasoning_effort is sent whenever the caller gives one (any provider) and never otherwise', async () => {
  const f = fakeFetch(() => json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
  const cloud = createCloud({ connections, fetchImpl: f.impl });
  await cloud.chat({ provider: 'deepseek', model: 'deepseek-flash', messages: [], reasoningEffort: 'low' });
  await cloud.chat({ provider: 'openai', model: 'gpt-x', messages: [], reasoningEffort: 'low' });
  await cloud.chat({ provider: 'openai', model: 'gpt-x', messages: [] });
  assert.equal(f.bodies[0].reasoning_effort, 'low');
  assert.equal(f.bodies[1].reasoning_effort, 'low');
  assert.equal('reasoning_effort' in f.bodies[2], false);
});

test('a 400 retry keeps the tools', async () => {
  let n = 0;
  const f = fakeFetch(() => (n++ === 0 ? new Response('{"error":{"message":"bad field"}}', { status: 400 }) : json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })));
  await createCloud({ connections, fetchImpl: f.impl }).chat({ provider: 'deepseek', model: 'deepseek-flash', messages: [], tools });
  assert.equal(f.bodies.length, 2);
  assert.deepEqual(f.bodies[1].tools, tools);
});

test('review #16: arguments sent as an object are kept as JSON text', async () => {
  const f = fakeFetch(() => json({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: { path: 'a.js' } } }] }, finish_reason: 'tool_calls' }] }));
  const r = await createCloud({ connections, fetchImpl: f.impl }).chat({ provider: 'custom', model: 'm', messages: [], tools });
  assert.deepEqual(JSON.parse(r.toolCalls[0].arguments), { path: 'a.js' });
});

test('Anthropic requests carry anthropic-version and x-api-key (user report: "anthropic-version: header is required")', async () => {
  const seen = [];
  const impl = async (url, init) => { seen.push({ url, headers: init.headers }); return json({ data: [{ id: 'claude-sonnet-x', type: 'model' }] }); };
  const models = await createCloud({ connections, fetchImpl: impl }).listModels('anthropic');
  assert.deepEqual(models, ['claude-sonnet-x']);
  assert.equal(seen[0].headers['anthropic-version'], '2023-06-01');
  assert.equal(seen[0].headers['x-api-key'], 'sk-test');
});

test('DeepSeek is a built-in provider', () => {
  const { PROVIDERS } = createRequire(import.meta.url)('../../app/connections.cjs');
  assert.equal(PROVIDERS.deepseek?.base, 'https://api.deepseek.com');
  assert.equal(PROVIDERS.deepseek.label, 'DeepSeek');
});
