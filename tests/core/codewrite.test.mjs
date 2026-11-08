// codewrite.cjs: every write of the coding agent — previews, guarded atomic writes, checkpoints and undo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { createProjectWriter } = createRequire(import.meta.url)('../../app/codewrite.cjs');

function project(files = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-cw-'));
  const root = path.join(base, 'proj'), checkpointsDir = path.join(base, 'checkpoints');
  for (const [name, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), body); }
  fs.mkdirSync(root, { recursive: true });
  return { base, root, checkpointsDir, w: createProjectWriter({ root, checkpointsDir }), read: n => fs.readFileSync(path.join(root, n), 'utf8') };
}
const code = async (promise, expected) => { const e = await promise.then(() => null, err => err); assert.ok(e, 'expected an error'); assert.equal(e.code, expected, e.message); return e; };

test('edit_file replaces a unique match', async () => {
  const p = project({ 'src/a.js': 'const x = 1;\nconst y = 2;\n' });
  const change = await p.w.previewEdit('src/a.js', [{ old: 'const y = 2;', new: 'const y = 3;' }]);
  assert.equal(change.kind, 'edit'); assert.equal(change.path, 'src/a.js');
  assert.deepEqual([change.diff.added, change.diff.removed], [1, 1]);
  assert.equal(p.read('src/a.js'), 'const x = 1;\nconst y = 2;\n', 'preview writes nothing');
  await p.w.apply(change, 'task1');
  assert.equal(p.read('src/a.js'), 'const x = 1;\nconst y = 3;\n');
});

test('missing old gives not-found', async () => {
  const p = project({ 'a.txt': 'hello\n' });
  await code(p.w.previewEdit('a.txt', [{ old: 'bye', new: 'x' }]), 'not-found');
});

test('old found twice gives ambiguous with both line numbers', async () => {
  const p = project({ 'a.txt': 'x = 1\ny\nx = 1\n' });
  const e = await code(p.w.previewEdit('a.txt', [{ old: 'x = 1', new: 'x = 2' }]), 'ambiguous');
  assert.deepEqual(e.lines, [1, 3]);
});

test('edit_file matches across CRLF and keeps CRLF', async () => {
  const p = project({ 'a.txt': 'one\r\ntwo\r\nthree\r\n' });
  const change = await p.w.previewEdit('a.txt', [{ old: 'one\ntwo', new: 'one\n2\n2b' }]);
  await p.w.apply(change, 't');
  assert.equal(p.read('a.txt'), 'one\r\n2\r\n2b\r\nthree\r\n');
});

test('BOM is kept', async () => {
  const p = project({ 'a.txt': '﻿hello\n' });
  await p.w.apply(await p.w.previewEdit('a.txt', [{ old: 'hello', new: 'merhaba' }]), 't');
  assert.equal(p.read('a.txt'), '﻿merhaba\n');
});

test('path with .. or absolute path gives outside', async () => {
  const p = project({ 'a.txt': 'x' });
  fs.writeFileSync(path.join(p.base, 'secret.txt'), 'x');
  await code(p.w.previewEdit('../secret.txt', [{ old: 'x', new: 'y' }]), 'outside');
  await code(p.w.previewCreate(path.join(p.base, 'new.txt'), 'y'), 'outside');
});

test('junction to a folder outside gives outside', async () => {
  const p = project({ 'a.txt': 'x' });
  const outside = path.join(p.base, 'elsewhere'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'f.txt'), 'x');
  fs.symlinkSync(outside, path.join(p.root, 'link'), 'junction');
  await code(p.w.previewEdit('link/f.txt', [{ old: 'x', new: 'y' }]), 'outside');
  await code(p.w.previewCreate('link/new.txt', 'y'), 'outside');
});

test('.env and id_rsa give sensitive; .git and node_modules give excluded', async () => {
  const p = project({ '.env': 'A=1', 'id_rsa': 'k', '.git/config': 'x', 'node_modules/m/i.js': 'x' });
  await code(p.w.previewEdit('.env', [{ old: 'A=1', new: 'A=2' }]), 'sensitive');
  await code(p.w.previewCreate('keys/id_rsa', 'k'), 'sensitive');
  await code(p.w.previewEdit('.git/config', [{ old: 'x', new: 'y' }]), 'excluded');
  await code(p.w.previewCreate('node_modules/m/new.js', 'x'), 'excluded');
});

test('file with NUL byte gives binary; over 1 MB gives too-large', async () => {
  const p = project({ 'a.dat.txt': 'a\0b', 'big.txt': 'x'.repeat(1024 * 1024 + 1) });
  await code(p.w.previewEdit('a.dat.txt', [{ old: 'a', new: 'b' }]), 'binary');
  await code(p.w.previewEdit('big.txt', [{ old: 'x', new: 'y' }]), 'too-large');
});

test('create of an existing file gives exists; create makes folders', async () => {
  const p = project({ 'a.txt': 'x' });
  await code(p.w.previewCreate('a.txt', 'y'), 'exists');
  const change = await p.w.previewCreate('src/new/b.js', 'export const b = 1;\n');
  assert.equal(change.kind, 'create'); assert.equal(change.diff.added, 1);
  await p.w.apply(change, 't');
  assert.equal(p.read('src/new/b.js'), 'export const b = 1;\n');
});

test('create over the size limit gives too-large', async () => {
  const p = createProjectWriter({ root: project().root, checkpointsDir: project().checkpointsDir, maxCreateBytes: 10 });
  await code(p.previewCreate('a.txt', '01234567890'), 'too-large');
});

test('apply after the file changed gives changed', async () => {
  const p = project({ 'a.txt': 'one\n' });
  const change = await p.w.previewEdit('a.txt', [{ old: 'one', new: 'two' }]);
  fs.writeFileSync(path.join(p.root, 'a.txt'), 'edited by hand\n');
  await code(p.w.apply(change, 't'), 'changed');
  assert.equal(p.read('a.txt'), 'edited by hand\n');
});

test('apply writes atomically (no temp file left)', async () => {
  const p = project({ 'a.txt': 'one\n' });
  await p.w.apply(await p.w.previewEdit('a.txt', [{ old: 'one', new: 'two' }]), 't');
  assert.deepEqual(fs.readdirSync(p.root), ['a.txt']);
});

test('undo restores edited files and deletes created ones', async () => {
  const p = project({ 'a.txt': 'one\n' });
  await p.w.apply(await p.w.previewEdit('a.txt', [{ old: 'one', new: 'two' }]), 't1');
  await p.w.apply(await p.w.previewEdit('a.txt', [{ old: 'two', new: 'three' }]), 't1');
  await p.w.apply(await p.w.previewCreate('n/b.txt', 'b'), 't1');
  assert.deepEqual(p.w.changedFiles('t1').sort(), ['a.txt', 'n/b.txt']);
  const r = await p.w.undo('t1');
  assert.deepEqual(r.restored, ['a.txt']); assert.deepEqual(r.removed, ['n/b.txt']); assert.deepEqual(r.skipped, []);
  assert.equal(p.read('a.txt'), 'one\n', 'back to the content before the first write of the task');
  assert.equal(fs.existsSync(path.join(p.root, 'n/b.txt')), false);
});

test('undo skips a file changed after the task', async () => {
  const p = project({ 'a.txt': 'one\n', 'b.txt': 'bee\n' });
  await p.w.apply(await p.w.previewEdit('a.txt', [{ old: 'one', new: 'two' }]), 't1');
  await p.w.apply(await p.w.previewEdit('b.txt', [{ old: 'bee', new: 'B' }]), 't1');
  fs.writeFileSync(path.join(p.root, 'a.txt'), 'my own edit\n');
  const r = await p.w.undo('t1');
  assert.deepEqual(r.restored, ['b.txt']);
  assert.deepEqual(r.skipped.map(s => s.path), ['a.txt']);
  assert.equal(p.read('a.txt'), 'my own edit\n');
  assert.equal(p.read('b.txt'), 'bee\n');
});

test('checkpoints survive a new writer (undo after restart)', async () => {
  const p = project({ 'a.txt': 'one\n' });
  await p.w.apply(await p.w.previewEdit('a.txt', [{ old: 'one', new: 'two' }]), 't1');
  const again = createProjectWriter({ root: p.root, checkpointsDir: p.checkpointsDir });
  assert.deepEqual((await again.undo('t1')).restored, ['a.txt']);
  assert.equal(p.read('a.txt'), 'one\n');
});
