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

function createProjectWriter({ root, checkpointsDir, allowSensitive = [], maxCreateBytes = 200 * 1024, maxEditBytes = 1024 * 1024 }) {
  let rootReal = null;
  async function resolve(input) {
    rootReal ??= await realRoot(root);
    const text = String(input || '').replace(/\\/g, '/').trim();
    if (!text || path.isAbsolute(text) || /^[a-z]:/i.test(text)) throw fail('outside', 'Use a path inside the project folder.');
    const full = path.resolve(rootReal, text);
    if (!inside(full, rootReal) || full === rootReal) throw fail('outside', 'That path is outside the project folder.');
    const rel = path.relative(rootReal, full).split(path.sep).join('/');
    const parts = rel.split('/');
    if (parts.some(part => EXCLUDED_DIRS.has(part))) throw fail('excluded', `${rel} is in a folder the agent does not change.`);
    if (isSensitive(parts.at(-1)) && !allowSensitive.includes(rel)) throw fail('sensitive', `${rel} looks like a secret (keys, .env, credentials) and is not changed.`);
    // The nearest existing part of the path must really be inside the root: a junction or symbolic link cannot lead out.
    let probe = full; while (!fs.existsSync(probe)) probe = path.dirname(probe);
    if (!inside(fs.realpathSync.native(probe), rootReal)) throw fail('outside', 'That path leads outside the project folder.');
    return { full, rel };
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
    const bom = text.startsWith('﻿'), body = bom ? text.slice(1) : text;
    const crlf = (body.match(/\r\n/g) || []).length, lf = (body.match(/\n/g) || []).length - crlf;
    const eol = crlf > lf ? '\r\n' : '\n';
    const original = body.replace(/\r\n/g, '\n');
    if (!Array.isArray(edits) || !edits.length) throw fail('not-found', 'Give at least one edit.');
    let next = original;
    for (const edit of edits) {
      const old = String(edit?.old ?? '').replace(/\r\n/g, '\n'), replacement = String(edit?.new ?? '').replace(/\r\n/g, '\n');
      if (!old) throw fail('not-found', 'Each edit needs the exact old text to replace.');
      const at = []; for (let i = next.indexOf(old); i !== -1; i = next.indexOf(old, i + 1)) at.push(i);
      if (!at.length) throw fail('not-found', `The old text was not found in ${rel}. Read the file again and copy the text exactly.`);
      if (at.length > 1) { const lines = at.map(i => lineOf(next, i)); throw fail('ambiguous', `The old text occurs ${at.length} times in ${rel} (lines ${lines.join(', ')}). Include more surrounding lines so it is unique.`, { lines }); }
      next = next.slice(0, at[0]) + replacement + next.slice(at[0] + old.length);
    }
    const after = (bom ? '﻿' : '') + (eol === '\n' ? next : next.replace(/\n/g, eol));
    return { kind: 'edit', path: rel, before: text, after, diff: diffLines(original, next), sha: sha256(buffer) };
  }

  async function previewCreate(input, content) {
    const { full, rel } = await resolve(input);
    if (fs.existsSync(full)) throw fail('exists', `${rel} already exists. Use edit_file to change it.`);
    const text = String(content ?? '');
    if (Buffer.byteLength(text) > maxCreateBytes) throw fail('too-large', `New files can be at most ${Math.round(maxCreateBytes / 1024)} KB; create a smaller file and extend it with edit_file.`);
    if (text.includes('\0')) throw fail('binary', 'New files must be text.');
    return { kind: 'create', path: rel, before: '', after: text, diff: diffLines('', text), sha: null };
  }

  async function apply(change, taskId) {
    if (!validTask(taskId)) throw fail('invalid', 'Invalid task.');
    const { full, rel } = await resolve(change?.path);
    const exists = fs.existsSync(full);
    if (change.kind === 'edit' ? !exists || sha256(fs.readFileSync(full)) !== change.sha : exists) throw fail('changed', `${rel} changed since the change was prepared. Read it again.`);
    const m = manifest(taskId); let entry = m.files.find(f => f.path === rel);
    if (!entry) {
      entry = { path: rel, kind: change.kind, orig: null, sha256After: null };
      if (change.kind === 'edit') { entry.orig = 'orig-' + m.files.length; fs.mkdirSync(taskDir(taskId), { recursive: true }); fs.copyFileSync(full, path.join(taskDir(taskId), entry.orig)); }
      m.files.push(entry);
    }
    const data = Buffer.from(change.after, 'utf8');
    writeAtomic(full, data);
    entry.sha256After = sha256(data); saveManifest(taskId, m);
    const changed = change.diff.hunks.flatMap(h => { let n = h.newStart; return h.lines.flatMap(l => l.t === '-' ? [] : (l.t === '+' ? [n++] : (n++, []))); });
    return { path: rel, lines: changed.length ? `${changed[0]}-${changed.at(-1)}` : '' };
  }

  async function undo(taskId) {
    if (!validTask(taskId)) throw fail('invalid', 'Invalid task.');
    const m = manifest(taskId), restored = [], removed = [], skipped = [];
    if (m.undone) return { restored, removed, skipped };
    for (const entry of m.files) {
      const { full } = await resolve(entry.path);
      const current = fs.existsSync(full) ? sha256(fs.readFileSync(full)) : null;
      if (current !== entry.sha256After) { skipped.push({ path: entry.path, reason: current ? 'changed' : 'missing' }); continue; }
      if (entry.kind === 'create') { fs.unlinkSync(full); removed.push(entry.path); }
      else { writeAtomic(full, fs.readFileSync(path.join(taskDir(taskId), entry.orig))); restored.push(entry.path); }
    }
    m.undone = true; saveManifest(taskId, m);
    return { restored, removed, skipped };
  }

  return { previewEdit, previewCreate, apply, undo, changedFiles: taskId => validTask(taskId) ? manifest(taskId).files.map(f => f.path) : [] };
}

module.exports = { createProjectWriter };
