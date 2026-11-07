// Launches Lumen in test mode and returns a CDP handle.
// launch({shell:'electron'|'tauri', dataDir, port, env, args}) -> {cdp, process, stop()}   args: extra command-line arguments
// Test mode passes the shell: --ui-check --test-data=<dir> --remote-debugging-port=<port>
// LUMEN_SHELL=tauri needs work/tauri-build from scripts/build-tauri.ps1 -Features ui-check (app/ is mirrored on each launch).
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
    // Graceful quit: closing the browser ends the app (window-all-closed -> quit -> core shutdown).
    close: cdp => cdp.send('Browser.close'),
  },
  // Built by scripts/build-tauri.ps1 -Features ui-check. The debugging port exists only in that build and only with --ui-check;
  // the shell gives each data folder its own WebView2 profile (<data>/webview/main). --user-data-dir names Electron's userData
  // folder of the same test (its Local State holds the safeStorage key), so saved API keys work in both shells.
  tauri: {
    exe: path.join(workRoot, 'tauri-build', 'lumen.exe'),
    appDir: path.join(workRoot, 'tauri-build', 'app'),
    args: (dataDir, port) => ['--ui-check', `--test-data=${dataDir}`, `--user-data-dir=${dataDir}-profile`, `--remote-debugging-port=${port}`],
    env: () => ({}),
    target: /^http:\/\/lumen\.localhost\//,
    // Graceful quit like the title bar's close button (shutdown to the core, then exit).
    close: cdp => cdp.evaluate("window.lumen.window('close'); 0"),
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

export async function launch({ shell = 'electron', dataDir, port, env = {}, args = [], sync = true, timeoutMs = 60000 } = {}) {
  const def = SHELLS[shell];
  if (!def) throw new Error(`Unknown shell '${shell}'`);
  if (!fs.existsSync(def.exe)) throw new Error(`${shell} executable not found: ${def.exe}`);
  if (!dataDir) throw new Error('dataDir is required');
  if (sync) syncApp(def);
  fs.mkdirSync(dataDir, { recursive: true });
  port = port || await freePort();
  const child = spawn(def.exe, [...def.args(dataDir, port), ...args], { stdio: 'ignore', env: { ...process.env, ...def.env(dataDir, port), ...env } });
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
      // An app that already exited has a dead CDP socket whose requests never settle: skip it, and never wait long.
      if (!exited) { try { await Promise.race([def.close(cdp), sleep(3000)]); } catch {} }
      cdp.close();
      for (let i = 0; i < 100 && !exited; i++) await sleep(100); // graceful quit takes up to 8 s
      stopTracked();
    },
  };
}
