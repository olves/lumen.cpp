// Measures startup time, idle memory and folder size of a Lumen shell. No npm dependencies (Node 22+).
// Library: measure({exe, args, dataDir}) -> {startupMs, idleRssMB, folderMB}
// CLI:     node tests/harness/measure.mjs --shell electron --out <file> [--runs 5] [--exe <path>] [--idle-ms 30000]
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workRoot = path.resolve(here, '..', '..', '..', 'work');
const EXCLUDED_PROCS = ['lumen-host.exe', 'llama-server.exe'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Shell definitions. Add 'tauri' here later with its exe path.
export const SHELLS = {
  electron: { exe: path.join(workRoot, 'electron-dev', 'lumen.cpp.exe') },
};

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

function folderSizeMB(dir) {
  const skip = path.join(dir, 'resources', 'app', 'backend', 'engines').toLowerCase();
  let total = 0;
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (p.toLowerCase() === skip) continue;
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && !/\.(gguf|partial)$/i.test(e.name)) total += fs.statSync(p).size;
    }
  };
  walk(dir);
  return total / 1048576;
}

function processTable() {
  const ps = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,WorkingSetSize | ConvertTo-Json -Compress';
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const rows = JSON.parse(out);
  return Array.isArray(rows) ? rows : [rows];
}

function descendants(rows, rootPid) {
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

// Sum of working sets of the shell process tree, excluding the engine processes (and anything below them).
function shellRssMB(rootPid) {
  const rows = processTable();
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

// Kill the tree and any leftover process whose executable lives under dir (never touches other Lumen installs).
function killAll(rootPid, dir) {
  try { execFileSync('taskkill', ['/PID', String(rootPid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  const prefix = dir.toLowerCase() + path.sep;
  for (let i = 0; i < 5; i++) {
    let left;
    try { left = processTable().filter(r => r.ExecutablePath && r.ExecutablePath.toLowerCase().startsWith(prefix)); } catch { break; }
    if (!left.length) return;
    for (const r of left) { try { execFileSync('taskkill', ['/PID', String(r.ProcessId), '/F'], { stdio: 'ignore' }); } catch {} }
  }
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

async function waitReady(port, t0, timeoutMs) {
  while (performance.now() - t0 < timeoutMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find(t => t.type === 'page' && /^lumen:\/\/app\//.test(t.url) && t.webSocketDebuggerUrl);
      if (page && await cdpEvaluate(page.webSocketDebuggerUrl, "document.readyState==='complete'") === true) return performance.now() - t0;
    } catch {}
    await sleep(25);
  }
  throw new Error('Main window did not reach readyState complete in time');
}

export async function measure({ exe, args = [], dataDir, idleMs = 30000, timeoutMs = 60000 }) {
  exe = path.resolve(exe);
  const exeDir = path.dirname(exe);
  fs.mkdirSync(dataDir, { recursive: true });
  const port = await freePort();
  // A separate user-data-dir also gives a separate single-instance lock, so a running Lumen is unaffected.
  const full = [...args, `--test-data=${dataDir}`, `--user-data-dir=${dataDir}-profile`, `--remote-debugging-port=${port}`];
  const t0 = performance.now();
  const child = spawn(exe, full, { stdio: 'ignore' });
  let exited = false;
  child.on('exit', () => { exited = true; });
  try {
    const startupMs = await waitReady(port, t0, timeoutMs);
    const wait = idleMs - (performance.now() - t0);
    if (wait > 0) await sleep(wait);
    if (exited) throw new Error('Shell exited before idle sample');
    const idleRssMB = shellRssMB(child.pid);
    return {
      startupMs: Math.round(startupMs),
      idleRssMB: Math.round(idleRssMB * 10) / 10,
      folderMB: Math.round(folderSizeMB(exeDir) * 10) / 10,
    };
  } finally {
    killAll(child.pid, exeDir);
  }
}

const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function cli() {
  const opt = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, '')] = argv[i + 1];
  const shell = SHELLS[opt.shell];
  if (!shell) throw new Error(`Unknown --shell '${opt.shell}'. Known: ${Object.keys(SHELLS).join(', ')}`);
  if (!opt.out) throw new Error('--out <file> is required');
  const runs = Number(opt.runs || 5), idleMs = Number(opt['idle-ms'] || 30000);
  const exe = opt.exe || shell.exe;
  const stamp = Date.now();
  const results = [];
  for (let i = 1; i <= runs; i++) {
    const dataDir = path.join(workRoot, 'measure', `data-${stamp}-${i}`);
    const r = await measure({ exe, args: [], dataDir, idleMs });
    console.log(`run ${i}: ${JSON.stringify(r)}`);
    results.push(r);
  }
  const out = {
    shell: opt.shell, exe, runs: results.length, idleMs, measuredAt: new Date().toISOString(),
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
