'use strict';
// The data-folder lock (core.lock): one core per data folder. Taking it over from a dead process must be safe against another
// starter doing the same at the same moment, so a stale file is never deleted where it lies. The steps:
//   1. create the file with 'wx' (fails when it exists); afterwards the file must still name our PID;
//   2. otherwise read the holder that is in it; a holder that is still running means "already running";
//   3. rename the file to a unique name FIRST, then read the holder from the renamed file. Only if it is the stale holder we
//      expected is it deleted and step 1 repeated. If it is anything else (the other starter won in between and its live lock is
//      what we moved), the file is put back (hard link: it never replaces a file somebody created meanwhile; where hard links do
//      not exist, FAT/exFAT, a rename back, only while no lock is there) and we report "already running".
// The file: line 1 the PID, then 'image=<exe name>' and 'start=<process start, ms since 1970>'. Files of older versions hold only
// the PID. A PID is reused by Windows, so a live PID alone does not prove the holder runs: on this conflict path (never on a
// normal start) the live process is looked up, and the lock is stale when its image is not Lumen's (node.exe, lumen.cpp.exe,
// lumen.exe or this process's own) or, when both start times are known, it started at another time. When the lookup fails the
// lock counts as held (the safe answer).
// options: pid, alive(pid), inspect(pid, {start}) -> {image, start}|null, self {image, start}, fs, beforeRename() (a test hook:
// runs between steps 2 and 3).
const nodeFs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const IMAGES = ['node.exe', 'lumen.cpp.exe', 'lumen.exe'];
// The start time written by a process (its own estimate) and Windows' creation time differ by the process's startup time.
const START_TOLERANCE_MS = 5000;

function defaultAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

// tasklist /FO CSV /NH prints '"node.exe","1234","Console","1","45.000 K"' (the column texts are localized, the image name and
// PID are not); with no match it prints a localized INFO line. -> the image name, '' (no such process) or null (lookup failed).
function parseTasklist(text, pid) {
  let ran = false;
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.trim().match(/^"([^"]+)"\s*[,;]\s*"(\d+)"/);
    if (!m) { if (line.trim()) ran = true; continue; }
    ran = true;
    if (Number(m[2]) === pid) return m[1];
  }
  return ran ? '' : null;
}
function imageOf(pid) {
  try { return parseTasklist(execFileSync('tasklist.exe', ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'], {encoding: 'latin1', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']}), pid); }
  catch { return null; }
}
// The creation time as a FILETIME (an integer, so no locale formats are involved). null when unknown.
function startOf(pid) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Process -Id ' + pid + ' -ErrorAction Stop).StartTime.ToFileTimeUtc()'], {encoding: 'latin1', timeout: 8000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']}).trim();
    if (!/^\d+$/.test(out)) return null;
    return Math.round(Number(out) / 10000 - 11644473600000);
  } catch { return null; }
}
function defaultInspect(pid, {start = false} = {}) {
  const image = imageOf(pid);
  if (image === null) return null;
  if (image === '') return {image: '', start: null};
  return {image, start: start && isOurs(image) ? startOf(pid) : null};
}

const ownImage = path.basename(process.execPath).toLowerCase();
const isOurs = (image, recorded = '') => { const i = String(image).toLowerCase(); return IMAGES.includes(i) || i === ownImage || (!!recorded && i === String(recorded).toLowerCase()); };
const selfInfo = () => ({image: path.basename(process.execPath), start: Math.round(Date.now() - process.uptime() * 1000)});

const valid = pid => Number.isInteger(pid) && pid > 0;
function parseLock(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim());
  const n = Number(lines[0]);
  const out = {pid: Number.isInteger(n) && n > 0 ? n : 0, image: '', start: 0};
  for (const line of lines.slice(1)) {
    const m = line.match(/^(image|start)=(.*)$/); if (!m) continue;
    if (m[1] === 'image') out.image = m[2];
    else { const s = Number(m[2]); if (Number.isFinite(s) && s > 0) out.start = s; }
  }
  return out;
}
const readLock = (fs, file) => { try { return parseLock(fs.readFileSync(file, 'utf8')); } catch { return parseLock(''); } };
const lockText = (pid, self) => String(pid) + '\nimage=' + String(self.image || '').replace(/[\r\n]/g, '') + '\nstart=' + (Number(self.start) || 0) + '\n';
const running = pid => Error('core.lock: Lumen is already running with this data folder (process ' + pid + ').');

// Whether the holder named in the file still runs (see the top of the file).
function holds(holder, alive, inspect) {
  if (!valid(holder.pid) || !alive(holder.pid)) return false;
  const info = inspect(holder.pid, {start: holder.start > 0});
  if (!info) return true;
  if (info.image === '') return false; // gone since the alive check
  if (info.image && !isOurs(info.image, holder.image)) return false;
  if (holder.start > 0 && Number(info.start) > 0 && Math.abs(Number(info.start) - holder.start) > START_TOLERANCE_MS) return false;
  return true;
}

function takeLock(lockPath, {pid = process.pid, alive = defaultAlive, inspect = defaultInspect, self = null, fs = nodeFs, beforeRename = null} = {}) {
  const me = self || selfInfo();
  // The holder is looked up once per PID and attempt: the answer does not change within one takeover.
  for (let attempt = 0; attempt < 6; attempt++) {
    const seen = new Map();
    const held = holder => { const key = holder.pid + '/' + holder.image + '/' + holder.start; if (!seen.has(key)) seen.set(key, holds(holder, alive, inspect)); return seen.get(key); };
    let created = false;
    try { fs.writeFileSync(lockPath, lockText(pid, me), {flag: 'wx'}); created = true; }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (created) { if (readLock(fs, lockPath).pid === pid) return true; continue; }
    const expected = readLock(fs, lockPath);
    if (held(expected)) throw running(expected.pid);
    if (beforeRename) beforeRename();
    const aside = lockPath + '.stale-' + pid + '-' + Date.now() + '-' + attempt;
    try { fs.renameSync(lockPath, aside); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    const moved = readLock(fs, aside);
    if (moved.pid === expected.pid && moved.start === expected.start && !held(moved)) { try { fs.rmSync(aside, {force: true}); } catch {} continue; }
    // Not the stale file we meant to remove: put it back without overwriting anything.
    try { fs.linkSync(aside, lockPath); }
    catch (e) {
      // FAT/exFAT have no hard links: rename it back, but only while no lock is there (a rename would replace one).
      if (e.code !== 'EEXIST') { try { if (!fs.existsSync(lockPath)) fs.renameSync(aside, lockPath); } catch {} }
    }
    try { fs.rmSync(aside, {force: true}); } catch {}
    if (held(moved)) throw running(moved.pid);
    continue;
  }
  throw Error('core.lock: could not lock the data folder.');
}

// Removes the lock only if it is still this process's.
function releaseLock(lockPath, {pid = process.pid, fs = nodeFs} = {}) {
  try { if (readLock(fs, lockPath).pid === pid) fs.rmSync(lockPath, {force: true}); } catch {}
}

module.exports = {takeLock, releaseLock, parseLock, parseTasklist, defaultInspect, START_TOLERANCE_MS};
