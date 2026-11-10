// workspaces.cjs: sidecar store of workspaces, their folders and modes, and which chat belongs where.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { createWorkspaces, documentsFolder } = createRequire(import.meta.url)('../../app/workspaces.cjs');

const CHAT = 'a'.repeat(32), CHAT2 = 'b'.repeat(32);
function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-ws-'));
  const data = path.join(base, 'data'), docs = path.join(base, 'Belgeler');
  fs.mkdirSync(data); fs.mkdirSync(docs);
  return { base, data, docs, ws: () => createWorkspaces({ dataDir: data, documentsDir: () => docs }) };
}

test('Default exists, points at Documents\\Lumen, starts in Ask, and nothing is created at startup', () => {
  const s = setup(), ws = s.ws();
  const [def] = ws.list();
  assert.equal(def.id, 'default'); assert.equal(def.isDefault, true); assert.equal(def.mode, 'ask');
  assert.equal(def.root, path.join(s.docs, 'Lumen'));
  assert.equal(fs.existsSync(def.root), false, 'no folder before it is needed');
  assert.deepEqual(fs.readdirSync(s.data), [], 'no file written by reading');
  assert.equal(ws.ensureFolder('default'), def.root); assert.ok(fs.statSync(def.root).isDirectory());
});

test('old chats belong to Default without any migration', () => {
  const s = setup(), ws = s.ws();
  assert.equal(ws.of(CHAT).id, 'default');
  assert.deepEqual(ws.assignments(), {});
});

test('create makes Documents\\Lumen\\<name>, new ones start in Ask, survive a reload', () => {
  const s = setup(), ws = s.ws();
  const w = ws.create({ name: 'Ödev projesi' });
  assert.match(w.id, /^[a-f0-9]{12}$/); assert.equal(w.mode, 'ask');
  assert.equal(w.root, path.join(s.docs, 'Lumen', 'Ödev projesi')); assert.ok(fs.existsSync(w.root));
  ws.assign(CHAT, w.id); ws.setMode(w.id, 'auto');
  const again = s.ws();
  assert.equal(again.of(CHAT).id, w.id); assert.equal(again.of(CHAT).mode, 'auto');
  assert.equal(again.list().length, 2);
});

test('a picked folder is used as is; a drive root and file are refused', () => {
  const s = setup(), ws = s.ws();
  const picked = path.join(s.base, 'code'); fs.mkdirSync(picked);
  assert.equal(ws.create({ name: 'Code', root: picked }).root, fs.realpathSync.native(picked));
  assert.throws(() => ws.create({ name: 'Drive', root: path.parse(s.base).root }), e => e.code === 'drive');
});

test('names: duplicates, empty and Windows-invalid folder names are refused', () => {
  const s = setup(), ws = s.ws();
  ws.create({ name: 'Notes' });
  assert.throws(() => ws.create({ name: 'notes' }), e => e.code === 'exists');
  assert.throws(() => ws.create({ name: '   ' }), e => e.code === 'name');
  for (const bad of ['a/b', 'a:b', 'con', 'trailing.', 'what?']) assert.throws(() => ws.create({ name: bad }), e => e.code === 'name', bad);
});

test('rename keeps the folder; remove moves chats to Default and keeps the folder', () => {
  const s = setup(), ws = s.ws();
  const w = ws.create({ name: 'Temp' }); ws.assign(CHAT, w.id); ws.assign(CHAT2, w.id);
  assert.equal(ws.rename(w.id, 'Renamed').root, w.root);
  const r = ws.remove(w.id);
  assert.equal(r.moved, 2); assert.ok(fs.existsSync(w.root), 'folder never deleted');
  assert.equal(ws.of(CHAT).id, 'default');
  assert.throws(() => ws.remove('default'), e => e.code === 'default');
});

test('branch copies the workspace, forget drops it, assigning Default clears the entry', () => {
  const s = setup(), ws = s.ws();
  const w = ws.create({ name: 'B' }); ws.assign(CHAT, w.id);
  ws.branch(CHAT, CHAT2); assert.equal(ws.of(CHAT2).id, w.id);
  ws.forget(CHAT2); assert.equal(ws.of(CHAT2).id, 'default');
  ws.assign(CHAT, 'default'); assert.deepEqual(ws.assignments(), {});
});

test('a damaged workspaces.json is kept aside and Default still works', () => {
  const s = setup();
  fs.writeFileSync(path.join(s.data, 'workspaces.json'), '{not json');
  const ws = s.ws();
  assert.equal(ws.list()[0].id, 'default');
  assert.ok(fs.existsSync(path.join(s.data, 'workspaces.json.damaged')));
});

test('a user-picked folder that disappeared is reported, not recreated', () => {
  const s = setup(), ws = s.ws();
  const picked = path.join(s.base, 'gone'); fs.mkdirSync(picked);
  const w = ws.create({ name: 'Gone', root: picked }); fs.rmSync(picked, { recursive: true });
  assert.throws(() => ws.ensureFolder(w.id), e => e.code === 'missing-folder');
  assert.equal(fs.existsSync(picked), false);
});

test('documentsFolder returns an absolute path', () => {
  assert.ok(path.isAbsolute(documentsFolder()));
});
