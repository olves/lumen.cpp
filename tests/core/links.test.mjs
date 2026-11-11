// v1.2: links in a message (bare domains too) and the research agent reading a named page first, before any planning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { urlsIn, needsTools, createAgent } = createRequire(import.meta.url)('../../app/agent.cjs');

test('bare domains count as links, with Turkish suffixes and punctuation', () => {
  assert.deepEqual(urlsIn("re-library.org'u araştır"), ['https://re-library.org']);
  assert.deepEqual(urlsIn('Look at docs.python.org, please.'), ['https://docs.python.org']);
  assert.deepEqual(urlsIn('Is (example.com.tr) safe?'), ['https://example.com.tr']);
  assert.deepEqual(urlsIn('github.com/olves/lumen.cpp'), ['https://github.com']);
  assert.deepEqual(urlsIn('https://a.example.com/x and a.example.com'), ['https://a.example.com/x']);
  assert.ok(needsTools('re-library.org nedir'));
});

test('not links: file names, versions, e-mail, code, paths', () => {
  for (const text of ['open readme.md', 'run main.py', 'edit setup.sh and lib.rs', 'node.js is fast', 'v1.2.0 is out', 'write to can@example.com',
    'in `docs.example.com` code', '```\nfetch("api.example.com")\n```', 'C:/Users/x/report.de', 'the value 3.14']) assert.deepEqual(urlsIn(text), [], text);
  assert.deepEqual(urlsIn('www.example.de and spiegel.de'), ['https://www.example.de', 'https://spiegel.de'], 'country domains are links');
});

test('a named page is read first, without the planner, and the answer is written from it', async () => {
  const calls = [], events = [];
  const engine = { complete: async args => { calls.push(args); return { content: 'Re-Library is a book site [S1].', promptTokens: 10, completionTokens: 5 }; } };
  const web = {
    checkUrl: () => true, providerLabel: () => 'DuckDuckGo',
    readPage: async url => ({ url, title: 'Re-Library', site: 're-library.org', text: 'Re-Library is a free library of rewritten classics.', description: '', published: null, method: 'reader', truncated: false, chars: 50 }),
    search: async () => { throw Error('should not search'); },
  };
  const settings = { get: async () => ({ agent: { enabled: false, maxSubtasks: 1, maxToolCalls: 4, taskSeconds: 60 }, search: { enabled: true, provider: 'duckduckgo', language: 'auto' }, browser: { render: false } }) };
  const agent = createAgent({ engine, web, settings, emit: e => events.push(e) });
  const r = await agent.run({ runId: '00000000-0000-4000-8000-000000000001', chat: { Id: 'a'.repeat(32), Messages: [{ Role: 'user', Content: "re-library.org'u araştır" }] }, prompt: "re-library.org'u araştır", model: 'm', contextSize: 8192, language: 'tr', mode: 'auto', systemPrompt: '' });
  assert.equal(calls.length, 1, 'only the answer call; no planner, no tool steps');
  assert.match(calls[0].messages.at(-1).content, /Re-Library is a free library/);
  assert.equal(r.sources?.[0]?.url ?? events.find(e => e.type === 'task')?.task.ops[0].url, 'https://re-library.org');
  assert.ok(!events.some(e => e.type === 'phase' && e.phase === 'planning'));
});
