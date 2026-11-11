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

// ---- Final review fixes ----
test('review #1: excluded folders cannot be reached by changing letter case', async () => {
  const p = project({ '.git/hooks/.keep': '', 'node_modules/m/i.js': 'x' });
  await code(p.w.previewCreate('.GIT/hooks/pre-commit', 'echo pwned'), 'excluded');
  await code(p.w.previewCreate('Node_Modules/m/new.js', 'x'), 'excluded');
  await code(p.w.previewCreate('NODE_MODULES/fresh.js', 'x'), 'excluded');
  assert.equal(fs.existsSync(path.join(p.root, '.git/hooks/pre-commit')), false);
});

test('review #2: a guard (gitignore, user excludes) is checked on the real path', async () => {
  const p = project({ 'secret/app.json': '{"a":1}', 'src/a.js': 'x' });
  const seen = [];
  const w = createProjectWriter({ root: p.root, checkpointsDir: p.checkpointsDir, guard: async rel => { seen.push(rel); return rel.startsWith('secret/') ? 'gitignore' : null; } });
  await code(w.previewEdit('SECRET/app.json', [{ old: '"a":1', new: '"a":2' }]), 'excluded');
  await code(w.previewCreate('secret/new.json', '{}'), 'excluded');
  await w.previewEdit('src/a.js', [{ old: 'x', new: 'y' }]);
  assert.ok(seen.includes('secret/app.json'), 'guard sees the real on-disk casing: ' + seen.join(','));
});

test('review #7: mixed line endings outside the edit are kept byte for byte', async () => {
  const p = project({ 'm.txt': 'a\r\nb\r\nc\nd\r\ne\r\n' });
  await p.w.apply(await p.w.previewEdit('m.txt', [{ old: 'a\nb', new: 'A\nB' }]), 't');
  assert.equal(p.read('m.txt'), 'A\r\nB\r\nc\nd\r\ne\r\n');
});

test('review #8: Windows reserved names and alternate data streams are refused', async () => {
  const p = project({ 'a.txt': 'x' });
  for (const bad of ['NUL', 'con.txt', 'sub/COM1', 'a.txt:hidden', 'trail. ', 'dot.']) await code(p.w.previewCreate(bad, 'x'), 'outside');
  assert.deepEqual(fs.readdirSync(p.root).sort(), ['a.txt']);
  assert.equal(p.read('a.txt'), 'x');
});

test('review #9: undo continues past a file it cannot restore and reports it', async () => {
  const p = project({ 'a.txt': 'one\n', 'b.txt': 'two\n' });
  await p.w.apply(await p.w.previewEdit('a.txt', [{ old: 'one', new: '1' }]), 't1');
  await p.w.apply(await p.w.previewEdit('b.txt', [{ old: 'two', new: '2' }]), 't1');
  fs.unlinkSync(path.join(p.checkpointsDir, 't1', 'orig-0'));
  const r = await p.w.undo('t1');
  assert.deepEqual(r.restored, ['b.txt']);
  assert.deepEqual(r.skipped.map(s => s.path), ['a.txt']);
  assert.equal(p.read('b.txt'), 'two\n');
});

// v1.1: folders, deletes, moves, and changes outside the workspace folder.
test('mkdir creates nested folders and undo removes only what it created', async () => {
  const p = project({ 'keep/a.txt': 'x' });
  const c = await p.w.previewMkdir('keep/new/deep');
  assert.equal(c.kind, 'mkdir');
  await p.w.apply(c, 't1');
  assert.ok(fs.statSync(path.join(p.root, 'keep/new/deep')).isDirectory());
  await code(p.w.previewMkdir('keep'), 'exists');
  const r = await p.w.undo('t1');
  assert.deepEqual(r.removed, ['keep/new/deep']);
  assert.equal(fs.existsSync(path.join(p.root, 'keep/new')), false);
  assert.ok(fs.existsSync(path.join(p.root, 'keep/a.txt')));
});

test('mkdir undo leaves a folder that got files afterwards', async () => {
  const p = project({});
  await p.w.apply(await p.w.previewMkdir('d'), 't1');
  fs.writeFileSync(path.join(p.root, 'd/user.txt'), 'mine');
  const r = await p.w.undo('t1');
  assert.equal(r.skipped[0].reason, 'changed');
  assert.ok(fs.existsSync(path.join(p.root, 'd/user.txt')));
});

test('delete moves a file into the checkpoint and undo brings it back', async () => {
  const p = project({ 'src/old.js': 'line1\nline2\n' });
  const c = await p.w.previewDelete('src/old.js');
  assert.equal(c.kind, 'delete'); assert.equal(c.diff.removed, 2);
  assert.ok(fs.existsSync(path.join(p.root, 'src/old.js')), 'preview deletes nothing');
  await p.w.apply(c, 't1');
  assert.equal(fs.existsSync(path.join(p.root, 'src/old.js')), false);
  const r = await p.w.undo('t1');
  assert.deepEqual(r.restored, ['src/old.js']);
  assert.equal(p.read('src/old.js'), 'line1\nline2\n');
});

test('delete of a folder, then undo; a recreated path is left alone', async () => {
  const p = project({ 'tmp/a.txt': 'a', 'tmp/sub/b.txt': 'b' });
  const c = await p.w.previewDelete('tmp');
  assert.equal(c.isDir, true); assert.equal(c.files, 2);
  await p.w.apply(c, 't1');
  assert.equal(fs.existsSync(path.join(p.root, 'tmp')), false);
  assert.equal((await p.w.undo('t1')).restored[0], 'tmp');
  assert.equal(p.read('tmp/sub/b.txt'), 'b');
  await p.w.apply(await p.w.previewDelete('tmp'), 't2');
  fs.mkdirSync(path.join(p.root, 'tmp'));
  assert.equal((await p.w.undo('t2')).skipped[0].reason, 'changed');
});

test('delete refuses excluded folders, sensitive files and missing paths', async () => {
  const p = project({ 'node_modules/x/i.js': '1', '.env': 'K=1' });
  await code(p.w.previewDelete('node_modules'), 'excluded');
  await code(p.w.previewDelete('.env'), 'sensitive');
  await code(p.w.previewDelete('nope.txt'), 'not-found');
  await code(p.w.previewDelete('../outside.txt'), 'outside');
});

test('a file changed after the delete preview is not deleted', async () => {
  const p = project({ 'a.txt': 'one' });
  const c = await p.w.previewDelete('a.txt');
  fs.writeFileSync(path.join(p.root, 'a.txt'), 'two');
  await code(p.w.apply(c, 't1'), 'changed');
  assert.equal(p.read('a.txt'), 'two');
});

test('move renames, creates the target folder, undo moves back; case-only rename works', async () => {
  const p = project({ 'a.js': 'A' });
  const c = await p.w.previewMove('a.js', 'lib/b.js');
  assert.equal(c.kind, 'move'); assert.equal(c.to, 'lib/b.js');
  await p.w.apply(c, 't1');
  assert.equal(p.read('lib/b.js'), 'A'); assert.equal(fs.existsSync(path.join(p.root, 'a.js')), false);
  assert.deepEqual(p.w.changedFiles('t1'), ['lib/b.js']);
  await p.w.undo('t1');
  assert.equal(p.read('a.js'), 'A');
  await p.w.apply(await p.w.previewMove('a.js', 'A.js'), 't2');
  assert.ok(fs.readdirSync(p.root).includes('A.js'));
});

test('move refuses an existing target and moving a folder into itself', async () => {
  const p = project({ 'a.txt': '1', 'b.txt': '2', 'd/x.txt': '3' });
  await code(p.w.previewMove('a.txt', 'b.txt'), 'exists');
  await code(p.w.previewMove('d', 'd/inner'), 'invalid');
});

test('undo runs backwards: edit then delete, move then edit', async () => {
  const p = project({ 'a.txt': 'v1\n', 'm.txt': 'm1\n' });
  await p.w.apply(await p.w.previewEdit('a.txt', [{ old: 'v1', new: 'v2' }]), 't1');
  await p.w.apply(await p.w.previewDelete('a.txt'), 't1');
  await p.w.apply(await p.w.previewMove('m.txt', 'n.txt'), 't1');
  await p.w.apply(await p.w.previewEdit('n.txt', [{ old: 'm1', new: 'm2' }]), 't1');
  const r = await p.w.undo('t1');
  assert.deepEqual(r.skipped, []);
  assert.equal(p.read('a.txt'), 'v1\n'); assert.equal(p.read('m.txt'), 'm1\n');
  assert.equal(fs.existsSync(path.join(p.root, 'n.txt')), false);
});

test('changes through a writer for another root are undone by the workspace writer', async () => {
  const p = project({ 'in.txt': 'i' });
  const elsewhere = path.join(p.base, 'elsewhere'); fs.mkdirSync(elsewhere); fs.writeFileSync(path.join(elsewhere, 'o.txt'), 'o\n');
  const outside = createProjectWriter({ root: path.parse(elsewhere).root, checkpointsDir: p.checkpointsDir });
  const rel = path.relative(path.parse(elsewhere).root, path.join(elsewhere, 'o.txt'));
  await outside.apply(await outside.previewEdit(rel, [{ old: 'o', new: 'changed' }]), 't1');
  await p.w.apply(await p.w.previewEdit('in.txt', [{ old: 'i', new: 'j' }]), 't1');
  const r = await p.w.undo('t1');
  assert.equal(r.restored.length, 2);
  assert.equal(fs.readFileSync(path.join(elsewhere, 'o.txt'), 'utf8'), 'o\n'); assert.equal(p.read('in.txt'), 'i');
});

test('v1.2: undo of a new file also removes the folders it needed, unless something else is in them', async () => {
  const p = project({ 'keep.txt': 'k' });
  await p.w.apply(await p.w.previewCreate('a/b/new.txt', 'x'), 't1');
  assert.ok(fs.existsSync(path.join(p.root, 'a/b/new.txt')));
  await p.w.undo('t1');
  assert.equal(fs.existsSync(path.join(p.root, 'a')), false, 'a/ and a/b/ removed');
  await p.w.apply(await p.w.previewCreate('c/d/new.txt', 'x'), 't2');
  fs.writeFileSync(path.join(p.root, 'c/user.txt'), 'mine');
  await p.w.undo('t2');
  assert.equal(fs.existsSync(path.join(p.root, 'c/d')), false);
  assert.ok(fs.existsSync(path.join(p.root, 'c/user.txt')), 'a folder with other files stays');
});
