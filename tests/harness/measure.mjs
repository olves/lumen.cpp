// Measures startup time, idle memory and folder size of a Lumen shell. No npm dependencies (Node 22+).
// Library: measure({exe, args, dataDir}) -> {startupMs, idleRssMB, folderMB}
// CLI:     node tests/harness/measure.mjs --shell electron --out <file> [--runs 5] [--exe <path>] [--idle-ms 30000]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sleep, freePort, processTable, descendants, track, killTracked } from './procs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const workRoot = path.resolve(here, '..', '..', '..', 'work');
const EXCLUDED_PROCS = ['lumen-host.exe', 'llama-server.exe'];

// Shell definitions. A new shell is added here only; measure() has no shell-specific code.
//   exe:            default executable
//   launch(d, p):   {args, env} for data dir d and debugging port p
//   target:         regex matched against the app page URL in the CDP target list
//   folderExcludes: paths (relative to the exe folder) not counted in folderMB (engines/models)
export const SHELLS = {
  electron: {
    exe: path.join(workRoot, 'electron-dev', 'lumen.cpp.exe'),
    // A separate user-data-dir also gives a separate single-instance lock, so a running Lumen is unaffected.
    launch: (dataDir, port) => ({
      args: [`--test-data=${dataDir}`, `--user-data-dir=${dataDir}-profile`, `--remote-debugging-port=${port}`],
      env: {},
    }),
    target: /^lumen:\/\/app\//,
    folderExcludes: ['resources/app/backend/engines'],
  },
  // Needs the test build (scripts/build-tauri.ps1 -Features ui-check): the shell opens WebView2's debugging port only there and
  // only with --ui-check, and drops WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS otherwise. Task 11 measures with this definition.
  tauri: {
    exe: path.join(workRoot, 'tauri-build', 'lumen.exe'),
    launch: (dataDir, port) => ({
      args: ['--ui-check', `--test-data=${dataDir}`, `--remote-debugging-port=${port}`],
      env: {},
    }),
    target: /^http:\/\/lumen\.localhost\//,
    folderExcludes: ['backend/engines', 'resources/app/backend/engines'],
  },
};

export const DEFINITIONS = {
  startupMs: 'spawn -> document.readyState complete on the app page (CDP)',
  idleRssMB: 'sum of working sets of the shell process tree 30 s after spawn, excluding lumen-host and llama-server trees',
  folderMB: 'shell folder size minus engines and models',
};

export function folderSizeMB(dir, excludes = []) {
  const skip = new Set(excludes.map(x => path.join(dir, x).toLowerCase()));
  let total = 0;
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (skip.has(p.toLowerCase())) continue;
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && !/\.(gguf|partial)$/i.test(e.name)) total += fs.statSync(p).size;
    }
  };
  walk(dir);
  return total / 1048576;
}

// Sum of working sets of the shell process tree, excluding the engine processes (and anything below them).
function shellRssMB(rows, rootPid) {
  const byPid = new Map(rows.map(r => [r.ProcessId, r]));
  const excluded = new Set();
  for (const r of descendants(rows, rootPid)) {
    if (EXCLUDED_PROCS.includes(String(r.Name).toLowerCase())) {
      excluded.add(r.ProcessId);
      for (const d of descendants(rows, r.ProcessId)) excluded.add(d.ProcessId);
    }
  }
  const tree = [byPid.get(rootPid), ...descendants(rows, rootPid)].filter(r => r && !excluded.has(r.ProcessId));
  return tree.reduce((s, r) => s + Number(r.WorkingSetSize || 0), 0) / 1048576;
}

function cdpEvaluate(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('CDP timeout')); }, 5000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id === 1) { clearTimeout(timer); ws.close(); resolve(m.result?.result?.value); }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('CDP error')); };
  });
}

async function waitReady(port, target, t0, timeoutMs, onTick) {
  let nextTick = 1000; // first process-tree poll only after 1 s so sub-second startups are not perturbed
  while (performance.now() - t0 < timeoutMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find(t => t.type === 'page' && target.test(t.url) && t.webSocketDebuggerUrl);
      if (page && await cdpEvaluate(page.webSocketDebuggerUrl, "document.readyState==='complete'") === true) return performance.now() - t0;
    } catch {}
    if (performance.now() - t0 >= nextTick) { onTick(); nextTick = performance.now() - t0 + 1000; }
    await sleep(25);
  }
  throw new Error('Main window did not reach readyState complete in time');
}

// shell: key of SHELLS or a shell definition object. exe defaults to the shell's exe.
export async function measure({ shell = 'electron', exe, args = [], dataDir, idleMs = 30000, timeoutMs = 60000 }) {
  const def = typeof shell === 'string' ? SHELLS[shell] : shell;
  if (!def) throw new Error(`Unknown shell '${shell}'`);
  exe = path.resolve(exe || def.exe);
  const exeDir = path.dirname(exe);
  fs.mkdirSync(dataDir, { recursive: true });
  const port = await freePort();
  const launch = def.launch(dataDir, port);
  const t0 = performance.now();
  const child = spawn(exe, [...args, ...launch.args], { stdio: 'ignore', env: { ...process.env, ...launch.env } });
  const tracked = new Map();
  let exited = false;
  child.on('exit', () => { exited = true; tracked.delete(child.pid); });
  const poll = () => { try { track(processTable(), child.pid, tracked, !exited); } catch {} };
  try {
    const startupMs = await waitReady(port, def.target, t0, timeoutMs, poll);
    poll();
    // Keep polling the process tree about once a second until the idle sample.
    while (!exited && performance.now() - t0 < idleMs) {
      poll();
      await sleep(Math.min(1000, Math.max(0, idleMs - (performance.now() - t0))));
    }
    if (exited) throw new Error('Shell exited before idle sample');
    const rows = processTable();
    track(rows, child.pid, tracked, !exited);
    const idleRssMB = shellRssMB(rows, child.pid);
    return {
      startupMs: Math.round(startupMs),
      idleRssMB: Math.round(idleRssMB * 10) / 10,
      folderMB: Math.round(folderSizeMB(exeDir, def.folderExcludes) * 10) / 10,
    };
  } finally {
    poll();
    if (exited) tracked.delete(child.pid);
    killTracked(tracked);
  }
}

const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function cli() {
  const opt = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, '')] = argv[i + 1];
  const shell = Object.hasOwn(SHELLS, opt.shell) ? SHELLS[opt.shell] : undefined;
  if (!shell) throw new Error(`Unknown --shell '${opt.shell}'. Known: ${Object.keys(SHELLS).join(', ')}`);
  if (!opt.out) throw new Error('--out <file> is required');
  const runs = Number(opt.runs || 5), idleMs = Number(opt['idle-ms'] || 30000);
  const exe = opt.exe || shell.exe;
  const stamp = Date.now();
  const results = [];
  for (let i = 1; i <= runs; i++) {
    const dataDir = path.join(workRoot, 'measure', `data-${stamp}-${i}`);
    const r = await measure({ shell, exe, dataDir, idleMs });
    console.log(`run ${i}: ${JSON.stringify(r)}`);
    results.push(r);
  }
  const out = {
    shell: opt.shell, exe, runs: results.length, idleMs, measuredAt: new Date().toISOString(), definitions: DEFINITIONS,
    startupMs: median(results.map(r => r.startupMs)),
    idleRssMB: median(results.map(r => r.idleRssMB)),
    folderMB: median(results.map(r => r.folderMB)),
    raw: results,
  };
  fs.mkdirSync(path.dirname(path.resolve(opt.out)), { recursive: true });
  fs.writeFileSync(opt.out, JSON.stringify(out, null, 2));
  console.log(`median: startupMs=${out.startupMs} idleRssMB=${out.idleRssMB} folderMB=${out.folderMB}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch(e => { console.error(e.message); process.exit(1); });
}
