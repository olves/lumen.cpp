'use strict';
// The only place the coding agent writes to a project folder. A change is first a preview (nothing touches the disk); the
// user approves it and `apply` writes it atomically after checking the file did not change since the preview. Before the first
// write of a file in a task its original is copied to <checkpointsDir>/<task>/, so the whole task can be undone; undo leaves
// alone (and reports) any file that changed after the task. Paths must stay inside the project's real root (no "..",
// absolute paths, symbolic links or junctions out); sensitive files, excluded folders (.git, node_modules, …) and binary files
// are never written. Line endings (CRLF/LF) and a UTF-8 BOM are kept; edits match by exact text, with line endings ignored.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { diffLines } = require('./linediff.cjs');
const { realRoot, inside, isSensitive, EXCLUDED_DIRS } = require('./projects.cjs');

const fail = (code, message, extra = {}) => Object.assign(Error(message), { code }, extra);
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const validTask = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id);
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.lumen-' + crypto.randomBytes(4).toString('hex') + '.tmp';
  try { fs.writeFileSync(temp, data); fs.renameSync(temp, file); } catch (error) { try { fs.unlinkSync(temp); } catch {} throw error; }
}

const DELETE_LIMITS = { files: 2000, bytes: 500 * 1024 * 1024 };
function folderSize(dir) {
  let files = 0, bytes = 0, links = 0; const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const e of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, e.name);
      if (e.isSymbolicLink()) { links++; continue; }
      if (e.isDirectory()) stack.push(full); else { files++; bytes += fs.statSync(full).size; }
      if (files > DELETE_LIMITS.files) return { files, bytes, links };
    }
  }
  return { files, bytes, links };
}
const EXCLUDED_LOWER =new Set([...EXCLUDED_DIRS].map(name => name.toLowerCase()));
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
// guard(rel) -> reason|null runs the project's read rules (gitignore, user excludes, sensitive, binary) on the real path.
function createProjectWriter({ root, checkpointsDir, allowSensitive = [], maxCreateBytes = 200 * 1024, maxEditBytes = 1024 * 1024, guard = null }) {
  let rootReal = null;
  const allowed = new Set(allowSensitive.map(p => String(p).replace(/\\/g, '/').toLowerCase()));
  async function resolve(input) {
    rootReal ??= await realRoot(root);
    const text = String(input || '').replace(/\\/g, '/').trim();
    if (!text || path.isAbsolute(text) || /^[a-z]:/i.test(text)) throw fail('outside', 'Use a path inside the project folder.');
    // Windows: no alternate data streams (":"), device names (NUL, CON, COM1…) or names ending in a dot or space.
    if (text.includes(':') || text.split('/').some(seg => RESERVED.test(seg) || (seg !== '.' && seg !== '..' && /[. ]$/.test(seg)))) throw fail('outside', 'That file name is not allowed on Windows.');
    const full = path.resolve(rootReal, text);
    if (!inside(full, rootReal) || full === rootReal) throw fail('outside', 'That path is outside the project folder.');
    // The nearest existing part of the path must really be inside the root: a junction or symbolic link cannot lead out. The
    // rules below then run on the real path (on-disk letter case), so ".GIT/hooks" is ".git/hooks".
    let probe = full; while (!fs.existsSync(probe)) probe = path.dirname(probe);
    const realProbe = fs.realpathSync.native(probe);
    if (!inside(realProbe, rootReal)) throw fail('outside', 'That path leads outside the project folder.');
    const realFull = path.join(realProbe, path.relative(probe, full));
    const rel = path.relative(rootReal, realFull).split(path.sep).join('/');
    const parts = rel.split('/');
    if (parts.some(part => EXCLUDED_LOWER.has(part.toLowerCase()))) throw fail('excluded', `${rel} is in a folder the agent does not change.`);
    if (isSensitive(parts.at(-1)) && !allowed.has(rel.toLowerCase())) throw fail('sensitive', `${rel} looks like a secret (keys, .env, credentials) and is not changed.`);
    const why = guard ? await guard(rel) : null;
    if (why) throw fail(why === 'sensitive' ? 'sensitive' : why === 'binary' ? 'binary' : 'excluded', `${rel} is excluded from changes (${why}).`);
    return { full: realFull, rel };
  }
  const taskDir = taskId => path.join(checkpointsDir, taskId);
  function manifest(taskId) { try { return JSON.parse(fs.readFileSync(path.join(taskDir(taskId), 'manifest.json'), 'utf8')); } catch { return { files: [] }; } }
  function saveManifest(taskId, value) { writeAtomic(path.join(taskDir(taskId), 'manifest.json'), JSON.stringify(value)); }

  async function previewEdit(input, edits) {
    const { full, rel } = await resolve(input);
    let stat; try { stat = fs.statSync(full); } catch { throw fail('not-found', `${rel} does not exist. Use create_file for a new file.`); }
    if (!stat.isFile()) throw fail('not-found', `${rel} is not a file.`);
    if (stat.size > maxEditBytes) throw fail('too-large', `${rel} is larger than ${Math.round(maxEditBytes / 1024)} KB and is not edited.`);
    const buffer = fs.readFileSync(full);
    if (buffer.includes(0)) throw fail('binary', `${rel} is a binary file.`);
    let text; try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer); } catch { throw fail('binary', `${rel} is not UTF-8 text.`); }
    const bom = text.startsWith('\uFEFF'), body = bom ? text.slice(1) : text;
    // Edits work on the raw text: a "\n" in old matches CRLF or LF, and the replacement takes the line ending of the text it
    // replaces, so every line outside the edit keeps its bytes, even in a file with mixed endings.
    const dominant = (body.match(/\r\n/g) || []).length > (body.match(/(?<!\r)\n/g) || []).length ? '\r\n' : '\n';
    if (!Array.isArray(edits) || !edits.length) throw fail('not-found', 'Give at least one edit.');
    let next = body;
    for (const edit of edits) {
      const old = String(edit?.old ?? '').replace(/\r\n/g, '\n'), replacement = String(edit?.new ?? '').replace(/\r\n/g, '\n');
      if (!old) throw fail('not-found', 'Each edit needs the exact old text to replace.');
      const pattern = new RegExp(old.split('\n').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\r?\\n'), 'g');
      const at = [...next.matchAll(pattern)];
      if (!at.length) throw fail('not-found', `The old text was not found in ${rel}. Read the file again and copy the text exactly.`);
      if (at.length > 1) { const lines = at.map(m => lineOf(next, m.index)); throw fail('ambiguous', `The old text occurs ${at.length} times in ${rel} (lines ${lines.join(', ')}). Include more surrounding lines so it is unique.`, { lines }); }
      const match = at[0], eol = /\r\n/.test(match[0]) ? '\r\n' : /\n/.test(match[0]) ? '\n' : dominant;
      next = next.slice(0, match.index) + (eol === '\n' ? replacement : replacement.replace(/\n/g, eol)) + next.slice(match.index + match[0].length);
    }
    const after = (bom ? '\uFEFF' : '') + next;
    return { kind: 'edit', path: rel, before: text, after, diff: diffLines(body, next), sha: sha256(buffer) };
  }

  async function previewCreate(input, content) {
    const { full, rel } = await resolve(input);
    if (fs.existsSync(full)) throw fail('exists', `${rel} already exists. Use edit_file to change it.`);
    const text = String(content ?? '');
    if (Buffer.byteLength(text) > maxCreateBytes) throw fail('too-large', `New files can be at most ${Math.round(maxCreateBytes / 1024)} KB; create a smaller file and extend it with edit_file.`);
    if (text.includes('\0')) throw fail('binary', 'New files must be text.');
    return { kind: 'create', path: rel, before: '', after: text, diff: diffLines('', text), sha: null };
  }

  // v1.1: folders, deletes and moves. A deleted file or folder is moved into the task's checkpoint folder (copied when it is on
  // another drive), so undo can put it back; folders larger than DELETE_LIMITS are refused.
  async function previewMkdir(input) {
    const { full, rel } = await resolve(input);
    if (fs.existsSync(full)) throw fail('exists', `${rel} already exists.`);
    return { kind: 'mkdir', path: rel, before: '', after: '', diff: { added: 0, removed: 0, hunks: [] }, sha: null };
  }
  async function previewDelete(input) {
    const { full, rel } = await resolve(input);
    let stat; try { stat = fs.lstatSync(full); } catch { throw fail('not-found', `${rel} does not exist.`); }
    if (stat.isSymbolicLink()) throw fail('outside', `${rel} is a link; it is not deleted.`);
    if (stat.isDirectory()) {
      const size = folderSize(full);
      if (size.files > DELETE_LIMITS.files || size.bytes > DELETE_LIMITS.bytes) throw fail('too-large', `${rel} has ${size.files} files (${Math.round(size.bytes / 1048576)} MB); folders over ${DELETE_LIMITS.files} files or ${Math.round(DELETE_LIMITS.bytes / 1048576)} MB are not deleted by the agent.`);
      if (size.links) throw fail('outside', `${rel} contains links; it is not deleted.`);
      return { kind: 'delete', path: rel, isDir: true, files: size.files, bytes: size.bytes, before: '', after: '', diff: { added: 0, removed: 0, hunks: [] }, sha: null };
    }
    const buffer = fs.readFileSync(full);
    let text = null; if (buffer.length <= 256 * 1024 && !buffer.includes(0)) { try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buffer); } catch {} }
    return { kind: 'delete', path: rel, isDir: false, files: 1, bytes: buffer.length, before: text ?? '', after: '', diff: text !== null ? diffLines(text, '') : { added: 0, removed: 0, hunks: [] }, sha: sha256(buffer) };
  }
  // A case-only rename (a.js -> A.js) resolves to the same real file; the requested spelling of the new name is kept.
  async function moveTarget(from, target) {
    const to = await resolve(target);
    if (from.full.toLowerCase() !== to.full.toLowerCase()) return to;
    const name = String(target).replace(/\\/g, '/').split('/').filter(Boolean).at(-1);
    return { full: path.join(path.dirname(from.full), name), rel: [...from.rel.split('/').slice(0, -1), name].join('/') };
  }
  async function previewMove(input, target) {
    const from = await resolve(input), to = await moveTarget(from, target);
    if (!fs.existsSync(from.full)) throw fail('not-found', `${from.rel} does not exist.`);
    if (fs.lstatSync(from.full).isSymbolicLink()) throw fail('outside', `${from.rel} is a link; it is not moved.`);
    if (fs.existsSync(to.full) && from.full.toLowerCase() !== to.full.toLowerCase()) throw fail('exists', `${to.rel} already exists.`);
    if (from.full.toLowerCase() !== to.full.toLowerCase() && inside(to.full, from.full)) throw fail('invalid', 'A folder cannot be moved into itself.');
    return { kind: 'move', path: from.rel, to: to.rel, isDir: fs.statSync(from.full).isDirectory(), before: '', after: '', diff: { added: 0, removed: 0, hunks: [] }, sha: null };
  }
  function moveInto(source, dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try { fs.renameSync(source, dest); }
    catch (error) { if (error.code !== 'EXDEV') throw error; fs.cpSync(source, dest, { recursive: true, errorOnExist: true, force: false }); fs.rmSync(source, { recursive: true, force: true }); }
  }

  async function apply(change, taskId) {
    if (!validTask(taskId)) throw fail('invalid', 'Invalid task.');
    if (change?.kind === 'mkdir' || change?.kind === 'delete' || change?.kind === 'move') return applyOther(change, taskId);
    const { full, rel } = await resolve(change?.path);
    const exists = fs.existsSync(full);
    if (change.kind === 'edit' ? !exists || sha256(fs.readFileSync(full)) !== change.sha : exists) throw fail('changed', `${rel} changed since the change was prepared. Read it again.`);
    const m = manifest(taskId);
    // Several edits of one file in a task share one checkpoint, unless something else (delete, move) touched the path since.
    const last = m.files.filter(f => f.path === rel || f.to === rel).at(-1);
    let entry = last && (last.kind === 'edit' || last.kind === 'create') && last.path === rel ? last : null;
    if (!entry) {
      entry = { path: rel, kind: change.kind, orig: null, sha256After: null, root: rootReal };
      if (change.kind === 'edit') { entry.orig = 'orig-' + m.files.length; fs.mkdirSync(taskDir(taskId), { recursive: true }); fs.copyFileSync(full, path.join(taskDir(taskId), entry.orig)); }
      // v1.2: folders a new file needs are created by the write; they are recorded so undo removes them again (when empty).
      if (change.kind === 'create') { const dirs = []; let probe = path.dirname(full); while (!fs.existsSync(probe)) { dirs.unshift(path.relative(rootReal, probe).split(path.sep).join('/')); probe = path.dirname(probe); } if (dirs.length) entry.createdDirs = dirs; }
      m.files.push(entry);
    }
    const data = Buffer.from(change.after, 'utf8');
    writeAtomic(full, data);
    entry.sha256After = sha256(data); saveManifest(taskId, m);
    const changed = change.diff.hunks.flatMap(h => { let n = h.newStart; return h.lines.flatMap(l => l.t === '-' ? [] : (l.t === '+' ? [n++] : (n++, []))); });
    return { path: rel, lines: changed.length ? `${changed[0]}-${changed.at(-1)}` : '' };
  }

  async function applyOther(change, taskId) {
    const m = manifest(taskId), n = m.files.length;
    if (change.kind === 'mkdir') {
      const { full, rel } = await resolve(change.path);
      if (fs.existsSync(full)) throw fail('changed', `${rel} exists now.`);
      const created = []; let probe = full; while (!fs.existsSync(probe)) { created.unshift(probe); probe = path.dirname(probe); }
      fs.mkdirSync(full, { recursive: true });
      m.files.push({ path: rel, kind: 'mkdir', created: created.map(p => path.relative(rootReal, p).split(path.sep).join('/')), root: rootReal });
      saveManifest(taskId, m); return { path: rel, lines: '' };
    }
    if (change.kind === 'delete') {
      const { full, rel } = await resolve(change.path);
      if (!fs.existsSync(full) || (!change.isDir && sha256(fs.readFileSync(full)) !== change.sha)) throw fail('changed', `${rel} changed since the change was prepared.`);
      const store = 'del-' + n;
      moveInto(full, path.join(taskDir(taskId), store));
      m.files.push({ path: rel, kind: 'delete', store, isDir: !!change.isDir, root: rootReal });
      saveManifest(taskId, m); return { path: rel, lines: '' };
    }
    const from = await resolve(change.path), to = await moveTarget(from, change.to);
    if (!fs.existsSync(from.full) || (fs.existsSync(to.full) && from.full.toLowerCase() !== to.full.toLowerCase())) throw fail('changed', `${from.rel} or ${to.rel} changed since the change was prepared.`);
    fs.mkdirSync(path.dirname(to.full), { recursive: true });
    fs.renameSync(from.full, to.full);
    m.files.push({ path: from.rel, to: to.rel, kind: 'move', root: rootReal });
    saveManifest(taskId, m); return { path: to.rel, lines: '' };
  }

  // Undo runs the task's changes backwards, so "edit, then delete" or "move, then edit" come back in the right order. A writer for
  // another root (changes outside the workspace folder, Full access or approved) undoes its own entries.
  async function undo(taskId) {
    if (!validTask(taskId)) throw fail('invalid', 'Invalid task.');
    rootReal ??= await realRoot(root);
    const m = manifest(taskId), restored = [], removed = [], skipped = [];
    if (m.undone) return { restored, removed, skipped };
    const others = new Map();
    const writerFor = entry => {
      if (!entry.root || entry.root.toLowerCase() === rootReal.toLowerCase()) return null;
      if (!others.has(entry.root)) others.set(entry.root, createProjectWriter({ root: entry.root, checkpointsDir, allowSensitive: [...allowed], maxCreateBytes, maxEditBytes }));
      return others.get(entry.root);
    };
    for (const entry of [...m.files].reverse()) {
      try {
        const w = writerFor(entry);
        const r = w ? await w.undoEntry(entry, taskId) : await undoEntry(entry, taskId);
        if (r === 'restored') restored.push(entry.path); else if (r === 'removed') removed.push(entry.to || entry.path); else skipped.push({ path: entry.to || entry.path, reason: r });
      } catch (error) { skipped.push({ path: entry.path, reason: 'error: ' + error.message }); }
    }
    m.undone = true; saveManifest(taskId, m);
    return { restored, removed, skipped };
  }
  async function undoEntry(entry, taskId) {
    const { full } = await resolve(entry.path);
    if (entry.kind === 'mkdir') {
      for (const rel of [...entry.created].reverse()) { const dir = path.join(rootReal, rel); try { fs.rmdirSync(dir); } catch (error) { if (error.code !== 'ENOENT') return 'changed'; } }
      return 'removed';
    }
    if (entry.kind === 'delete') {
      if (fs.existsSync(full)) return 'changed';
      moveInto(path.join(taskDir(taskId), entry.store), full); return 'restored';
    }
    if (entry.kind === 'move') {
      const to = await moveTarget({ full, rel: entry.path }, entry.to);
      if (!fs.existsSync(to.full)) return 'missing';
      if (fs.existsSync(full) && full.toLowerCase() !== to.full.toLowerCase()) return 'changed';
      fs.mkdirSync(path.dirname(full), { recursive: true }); fs.renameSync(to.full, full); return 'restored';
    }
    const current = fs.existsSync(full) ? sha256(fs.readFileSync(full)) : null;
    if (current !== entry.sha256After) return current ? 'changed' : 'missing';
    if (entry.kind === 'create') {
      fs.unlinkSync(full);
      for (const rel of [...(entry.createdDirs || [])].reverse()) { try { fs.rmdirSync(path.join(rootReal, rel)); } catch {} }
      return 'removed';
    }
    writeAtomic(full, fs.readFileSync(path.join(taskDir(taskId), entry.orig))); return 'restored';
  }

  return {
    previewEdit, previewCreate, previewMkdir, previewDelete, previewMove, apply, undo, undoEntry,
    changedFiles: taskId => validTask(taskId) ? [...new Set(manifest(taskId).files.map(f => f.to || f.path))] : [],
  };
}

module.exports = { createProjectWriter };
