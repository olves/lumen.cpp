// Launches Lumen in test mode and returns a CDP handle.
// launch({shell:'electron'|'tauri', dataDir, port, env}) -> {cdp, process, stop()}
// Test mode passes the shell: --ui-check --test-data=<dir> --remote-debugging-port=<port>
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp.mjs';
import { sleep, freePort, processTable, track, killTracked } from './procs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..');
export const workRoot = path.resolve(repoRoot, '..', 'work');

export const SHELLS = {
  electron: {
    exe: path.join(workRoot, 'electron-dev', 'lumen.cpp.exe'),
    appDir: path.join(workRoot, 'electron-dev', 'resources', 'app'),
    // A separate user-data-dir gives a separate single-instance lock and keeps the profile out of the user's.
    args: (dataDir, port) => ['--ui-check', `--test-data=${dataDir}`, `--user-data-dir=${dataDir}-profile`, `--remote-debugging-port=${port}`],
    env: () => ({}),
    target: /^lumen:\/\/app\//,
  },
  // Stub for Task 11; not runnable yet.
  tauri: {
    exe: path.join(workRoot, 'tauri-build', 'lumen.exe'),
    args: dataDir => ['--ui-check', `--test-data=${dataDir}`],
    env: (_d, port) => ({ WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }),
    target: /^http:\/\/lumen\.localhost\//,
  },
};

// Mirrors repo app/ into the dev copy, keeping its compiled backend (exes and engines). robocopy exit codes 0-7 are success.
export function syncApp(def) {
  if (!def.appDir) return;
  const src = path.join(repoRoot, 'app');
  const r = spawnSync('robocopy', [src, def.appDir, '/MIR', '/NJH', '/NJS', '/NP', '/NFL', '/NDL',
    '/XF', '*.exe', '/XD', path.join(def.appDir, 'backend', 'engines'), path.join(src, 'backend', 'engines')], { encoding: 'utf8' });
  if (r.error || r.status > 7) throw new Error(`robocopy failed (${r.status ?? r.error}): ${r.stdout}`);
}

export async function launch({ shell = 'electron', dataDir, port, env = {}, sync = true, timeoutMs = 60000 } = {}) {
  const def = SHELLS[shell];
  if (!def) throw new Error(`Unknown shell '${shell}'`);
  if (!fs.existsSync(def.exe)) throw new Error(`${shell} executable not found: ${def.exe}`);
  if (!dataDir) throw new Error('dataDir is required');
  if (sync) syncApp(def);
  fs.mkdirSync(dataDir, { recursive: true });
  port = port || await freePort();
  const child = spawn(def.exe, def.args(dataDir, port), { stdio: 'ignore', env: { ...process.env, ...def.env(dataDir, port), ...env } });
  const tracked = new Map();
  let exited = false;
  child.on('exit', () => { exited = true; tracked.delete(child.pid); });
  const poll = () => { try { track(processTable(), child.pid, tracked, !exited); } catch {} };
  const stopTracked = () => { poll(); if (exited) tracked.delete(child.pid); killTracked(tracked); };
  let cdp;
  try {
    const t0 = Date.now();
    let nextPoll = 0;
    while (!cdp) {
      if (exited) throw new Error('Lumen exited during startup');
      if (Date.now() - t0 > timeoutMs) throw new Error('Lumen did not open its window in time');
      if (Date.now() >= nextPoll) { poll(); nextPoll = Date.now() + 1000; }
      try { cdp = await connect(port, { target: def.target, timeoutMs: 1000 }); } catch { await sleep(200); }
    }
    await cdp.waitFor("document.readyState==='complete'", timeoutMs);
    poll();
  } catch (e) { cdp?.close(); stopTracked(); throw e; }
  return {
    cdp, process: child, port, dataDir,
    async stop() {
      poll();
      try { await cdp.send('Browser.close'); } catch {}
      cdp.close();
      for (let i = 0; i < 100 && !exited; i++) await sleep(100); // graceful quit takes up to 8 s
      stopTracked();
    },
  };
}
