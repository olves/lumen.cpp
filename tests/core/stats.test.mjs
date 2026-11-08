// stats.cjs: per-reply numbers (tokens, seconds, first token, tokens/s, cut at the response length) and their sidecar file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createStatsStore } = require('../../app/stats.cjs');
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-stats-'));
const id = 'a'.repeat(32), other = 'b'.repeat(32);

test('measure: speed counts from the first token, not from the request', () => {
  const s = createStatsStore(dir());
  // Request at 0, first token at 2 s (loading), 101 tokens until 4 s -> 100 tokens in 2 s.
  assert.deepEqual(s.measure({ started: 1000, first: 3000, last: 5000, tokens: 101, limit: 512 }),
    { tokens: 101, seconds: 2, firstTokenSeconds: 2, perSecond: 50, cut: false });
});

test('measure: cut when the count reaches the limit, or when the provider says so', () => {
  const s = createStatsStore(dir());
  assert.equal(s.measure({ started: 0, first: 1, last: 2001, tokens: 512, limit: 512 }).cut, true);
  assert.equal(s.measure({ started: 0, first: 1, last: 2001, tokens: 300, cut: true }).cut, true);
  assert.equal(s.measure({ started: 0, first: 1, last: 2001, tokens: 512, limit: 512, cut: false }).cut, false, 'provider finish wins');
});

test('measure: too short to time gives no speed; missing numbers stay null', () => {
  const s = createStatsStore(dir());
  assert.equal(s.measure({ started: 0, first: 10, last: 30, tokens: 3, limit: 512 }).perSecond, null);
  assert.deepEqual(s.measure({}), { tokens: null, seconds: null, firstTokenSeconds: null, perSecond: null, cut: false });
});

test('record, decorate, branch, remove, forget; the file survives a new store', () => {
  const d = dir(), s = createStatsStore(d);
  s.record(id, 1, { tokens: 40, seconds: 1.234, firstTokenSeconds: 0.5, perSecond: 31.6, cut: false });
  s.record(id, 3, { tokens: 512, seconds: 10, perSecond: 51.1, cut: true, extra: 'dropped' });
  const chat = { Id: id, Messages: [{ Role: 'user' }, { Role: 'assistant' }, { Role: 'user' }, { Role: 'assistant' }] };
  const fresh = createStatsStore(d).decorate(chat);
  assert.deepEqual(fresh.Messages[1].Stats, { tokens: 40, seconds: 1.2, firstTokenSeconds: 0.5, perSecond: 31.6, cut: false });
  assert.equal(fresh.Messages[3].Stats.cut, true);
  assert.equal('extra' in fresh.Messages[3].Stats, false);
  assert.equal(fresh.Messages[0].Stats, undefined, 'user messages get none');
  s.branch(id, other, 2);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(d, 'conversation-stats.json'), 'utf8'))[other]), ['1']);
  s.remove(id, 3);
  assert.equal(s.decorate(chat).Messages[3].Stats, undefined);
  s.forget(id);
  assert.equal(s.decorate(chat), chat);
});

test('invalid input is rejected', () => {
  const s = createStatsStore(dir());
  assert.throws(() => s.record('nope', 1, { tokens: 1 }), /Invalid stats record/);
  assert.throws(() => s.record(id, -1, { tokens: 1 }), /Invalid stats record/);
  assert.equal(s.record(id, 1, { tokens: 0 }), null, 'nothing measured, nothing stored');
});
