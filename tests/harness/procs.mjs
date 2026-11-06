// Shared process helpers: PID+exe-identity tracking and cleanup that kills only processes we started.
import { execFileSync } from 'node:child_process';
import net from 'node:net';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

export function processTable() {
  const ps = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,WorkingSetSize | ConvertTo-Json -Compress';
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const rows = JSON.parse(out);
  return Array.isArray(rows) ? rows : [rows];
}

export function descendants(rows, rootPid) {
  const kids = new Map();
  for (const r of rows) {
    if (!kids.has(r.ParentProcessId)) kids.set(r.ParentProcessId, []);
    kids.get(r.ParentProcessId).push(r);
  }
  const out = [], stack = [rootPid], seen = new Set([rootPid]);
  while (stack.length) {
    for (const k of kids.get(stack.pop()) || []) {
      if (!seen.has(k.ProcessId)) { seen.add(k.ProcessId); out.push(k); stack.push(k.ProcessId); }
    }
  }
  return out;
}

export const identity = r => String(r.ExecutablePath || r.Name).toLowerCase();

// Remember the spawned tree (pid -> identity) so cleanup kills only processes we started.
// Entries whose PID is gone or now belongs to a different executable are dropped BEFORE their children are
// expanded, so a reused PID is never trusted. Descendants of every still-valid tracked process are added
// (covers orphans whose parent exited). The root is only (re)recorded while it is alive.
export function track(rows, rootPid, tracked, rootAlive) {
  const byPid = new Map(rows.map(r => [r.ProcessId, r]));
  for (const [pid, id] of [...tracked]) {
    const row = byPid.get(pid);
    if (!row || identity(row) !== id || (pid === rootPid && !rootAlive)) tracked.delete(pid);
  }
  const roots = new Set(tracked.keys());
  if (rootAlive && byPid.has(rootPid)) roots.add(rootPid);
  for (const pid of roots) {
    tracked.set(pid, identity(byPid.get(pid)));
    for (const d of descendants(rows, pid)) tracked.set(d.ProcessId, identity(d));
  }
}

// Kill only tracked PIDs that still exist with the same executable. Identity is re-checked inside the same
// PowerShell call, immediately before each kill, and the process table is re-read between passes. No path sweep.
export function killTracked(tracked) {
  const script = '$m=ConvertFrom-Json $env:LUMEN_KILL; foreach($e in $m){$p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$e.pid); if($p){$id=$p.ExecutablePath; if(-not $id){$id=$p.Name}; if($id.ToLower() -eq $e.id){Stop-Process -Id $e.pid -Force -ErrorAction SilentlyContinue}}}';
  for (let pass = 0; pass < 3; pass++) {
    let rows;
    try { rows = processTable(); } catch { return; }
    const victims = rows.filter(r => tracked.get(r.ProcessId) === identity(r)).map(r => ({ pid: r.ProcessId, id: identity(r) }));
    if (!victims.length) return;
    try { execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', env: { ...process.env, LUMEN_KILL: JSON.stringify(victims) } }); } catch {}
  }
}
