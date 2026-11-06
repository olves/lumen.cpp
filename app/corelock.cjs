'use strict';
// The data-folder lock (core.lock): one core per data folder. Taking it over from a dead process must be safe against another
// starter doing the same at the same moment, so a stale file is never deleted where it lies. The steps:
//   1. create the file with 'wx' (fails when it exists); afterwards the file must still hold our PID;
//   2. otherwise read the PID that is in it (the PID we expect to be dead); a live PID means "already running";
//   3. rename the file to a unique name FIRST, then read the PID from the renamed file. Only if it is the dead PID we expected
//      is it deleted and step 1 repeated. If it is anything else (the other starter won in between and its live lock is what we
//      moved), the file is put back (hard link: it never replaces a file somebody created meanwhile) and we report "already running".
// options: pid, alive(pid), fs, beforeRename() (a test hook: runs between steps 2 and 3).
const nodeFs = require('node:fs');

function defaultAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
const readPid = (fs, file) => { try { const n = Number(fs.readFileSync(file, 'utf8').trim()); return Number.isInteger(n) && n > 0 ? n : 0; } catch { return 0; } };
const valid = pid => Number.isInteger(pid) && pid > 0;
const running = pid => Error('core.lock: Lumen is already running with this data folder (process ' + pid + ').');

function takeLock(lockPath, {pid = process.pid, alive = defaultAlive, fs = nodeFs, beforeRename = null} = {}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    let created = false;
    try { fs.writeFileSync(lockPath, String(pid), {flag: 'wx'}); created = true; }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (created) { if (readPid(fs, lockPath) === pid) return true; continue; }
    const expected = readPid(fs, lockPath);
    if (valid(expected) && alive(expected)) throw running(expected);
    if (beforeRename) beforeRename();
    const aside = lockPath + '.stale-' + pid + '-' + Date.now() + '-' + attempt;
    try { fs.renameSync(lockPath, aside); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    const moved = readPid(fs, aside);
    if (moved === expected && !(valid(moved) && alive(moved))) { try { fs.rmSync(aside, {force: true}); } catch {} continue; }
    // Not the stale file we meant to remove: put it back without overwriting anything.
    try { fs.linkSync(aside, lockPath); } catch { /* somebody created a lock in the meantime */ }
    try { fs.rmSync(aside, {force: true}); } catch {}
    if (valid(moved) && alive(moved)) throw running(moved);
    continue;
  }
  throw Error('core.lock: could not lock the data folder.');
}

module.exports = {takeLock};
