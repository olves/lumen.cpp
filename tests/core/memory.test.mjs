// memory.cjs: the lasting memory store and recognizing "remember …" requests (EN/TR).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { createMemory, rememberRequest, MAX } = createRequire(import.meta.url)('../../app/memory.cjs');
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-mem-'));

test('add, list, update, remove; survives a reload; duplicates are not added twice', () => {
  const d = dir(), m = createMemory(d);
  const a = m.add('  I prefer short answers. '), b = m.add('Adım Can.');
  assert.equal(a.text, 'I prefer short answers.');
  assert.equal(m.add('i prefer SHORT answers.').duplicate, true);
  m.update(b.id, 'Adım Can, İstanbul’da yaşıyorum.');
  assert.deepEqual(createMemory(d).list().map(x => x.text), ['I prefer short answers.', 'Adım Can, İstanbul’da yaşıyorum.']);
  assert.equal(m.remove(a.id), true);
  assert.deepEqual(createMemory(d).list().map(x => x.text), ['Adım Can, İstanbul’da yaşıyorum.']);
});

test('limits: empty, too long, full', () => {
  const m = createMemory(dir());
  assert.throws(() => m.add('  '), e => e.code === 'empty');
  assert.throws(() => m.add('x'.repeat(301)), e => e.code === 'long');
  for (let i = 0; i < MAX; i++) m.add('fact ' + i);
  assert.throws(() => m.add('one more'), e => e.code === 'full');
});

test('the prompt text lists the facts, oldest first, and is empty without facts', () => {
  const m = createMemory(dir());
  assert.equal(m.promptText(), '');
  m.add('Uses Windows 11.'); m.add('Writes code in JavaScript.');
  assert.match(m.promptText(), /remember these about them[^\n]*\n- Uses Windows 11\.\n- Writes code in JavaScript\.$/);
});

test('remember requests in English and Turkish, and messages that are not', () => {
  assert.equal(rememberRequest('Remember: my dog is called Pamuk.'), 'my dog is called Pamuk');
  assert.equal(rememberRequest('remember that I work nights'), 'I work nights');
  assert.equal(rememberRequest('Bunu hatırla: vegan besleniyorum'), 'vegan besleniyorum');
  assert.equal(rememberRequest('Hatırla, toplantılar salı günleri.'), 'toplantılar salı günleri');
  assert.equal(rememberRequest('Kahveyi şekersiz içerim, bunu hatırla.'), 'Kahveyi şekersiz içerim');
  for (const t of ['Do you remember the plot of Dune?', 'Hatırlıyor musun?', 'I cannot remember the word', 'remember']) assert.equal(rememberRequest(t), null, t);
});
