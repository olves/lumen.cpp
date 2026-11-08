// linediff.cjs: the line diff shown on the coding agent's change cards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { diffLines } = createRequire(import.meta.url)('../../app/linediff.cjs');

const lines = n => Array.from({ length: n }, (_, i) => `line ${i + 1}`);

test('identical texts give no hunks', () => {
  assert.deepEqual(diffLines('a\nb\n', 'a\nb\n'), { added: 0, removed: 0, hunks: [] });
});

test('one changed line gives -1/+1 with 3 context lines each side', () => {
  const before = lines(20), after = [...before]; after[9] = 'changed';
  const d = diffLines(before.join('\n'), after.join('\n'));
  assert.equal(d.added, 1); assert.equal(d.removed, 1);
  assert.equal(d.hunks.length, 1);
  const h = d.hunks[0];
  assert.equal(h.oldStart, 7); assert.equal(h.newStart, 7);
  assert.deepEqual(h.lines.map(l => l.t).join(''), '   -+   ');
  assert.deepEqual(h.lines[3], { t: '-', s: 'line 10' });
  assert.deepEqual(h.lines[4], { t: '+', s: 'changed' });
});

test('two far-apart changes give two hunks', () => {
  const before = lines(60), after = [...before]; after[4] = 'x'; after[50] = 'y';
  const d = diffLines(before.join('\n'), after.join('\n'));
  assert.equal(d.hunks.length, 2);
  assert.deepEqual([d.added, d.removed], [2, 2]);
});

test('insertions and deletions count separately', () => {
  const d = diffLines('a\nb\nc', 'a\nnew1\nnew2\nc');
  assert.deepEqual([d.added, d.removed], [2, 1]);
});

test('CRLF input compares by line content', () => {
  assert.deepEqual(diffLines('a\r\nb\r\n', 'a\nb\n'), { added: 0, removed: 0, hunks: [] });
});

test('creating a file is all additions', () => {
  const d = diffLines('', 'one\ntwo');
  assert.deepEqual([d.added, d.removed, d.hunks[0].newStart], [2, 0, 1]);
});

test('10,000-line file with one change finishes under 200 ms', () => {
  const before = lines(10000), after = [...before]; after[5000] = 'changed';
  const t = performance.now();
  const d = diffLines(before.join('\n'), after.join('\n'));
  assert.ok(performance.now() - t < 200);
  assert.deepEqual([d.added, d.removed], [1, 1]);
});
