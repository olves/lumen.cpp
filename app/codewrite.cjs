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

const EXCLUDED_LOWER = new Set([...EXCLUDED_DIRS].map(name => name.toLowerCase()));
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
      try {
        const { full } = await resolve(entry.path);
        const current = fs.existsSync(full) ? sha256(fs.readFileSync(full)) : null;
        if (current !== entry.sha256After) { skipped.push({ path: entry.path, reason: current ? 'changed' : 'missing' }); continue; }
        if (entry.kind === 'create') { fs.unlinkSync(full); removed.push(entry.path); }
        else { writeAtomic(full, fs.readFileSync(path.join(taskDir(taskId), entry.orig))); restored.push(entry.path); }
      } catch (error) { skipped.push({ path: entry.path, reason: 'error: ' + error.message }); }
    }
    m.undone = true; saveManifest(taskId, m);
    return { restored, removed, skipped };
  }

  return { previewEdit, previewCreate, apply, undo, changedFiles: taskId => validTask(taskId) ? manifest(taskId).files.map(f => f.path) : [] };
}

module.exports = { createProjectWriter };
