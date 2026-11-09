// Which other programs keep the GPU busy (v1.0.9). A local model shares the graphics card with everything else; an animated
// wallpaper or a game at 90% makes replies 5-10x slower (measured 9 Nov 2026: Wallpaper Engine 92% -> 5 tok/s, paused -> 55 tok/s).
// Windows exposes the same per-process numbers as Task Manager's GPU column through the "GPU Engine" performance counters
// (the counter names are not translated). Read on demand after a local reply, at most once every two minutes; never polled.
'use strict';
const { execFile } = require('child_process');

// Lumen's own processes and the desktop compositor (always a few percent) are not "other programs".
const OWN = new Set(['llama-server', 'sd-server', 'lumen-host', 'lumen.cpp', 'lumen-core', 'node', 'dwm', 'idle']);
const GAP_MS = 120000;

// One sample per process and engine instance -> load per process: instances of one engine type add up (Task Manager does the
// same), and a process's load is its busiest engine type.
function parseSamples(data) {
  const perType = new Map();
  for (const s of Array.isArray(data?.samples) ? data.samples : []) {
    const m = /^pid_(\d+)_.*_engtype_([A-Za-z0-9]+)/.exec(String(s?.i || ''));
    if (!m || !Number.isFinite(Number(s.v))) continue;
    const key = m[1] + '|' + m[2];
    perType.set(key, (perType.get(key) || 0) + Number(s.v));
  }
  const load = new Map();
  for (const [key, v] of perType) {
    const pid = Number(key.split('|')[0]);
    load.set(pid, Math.max(load.get(pid) || 0, Math.round(v * 10) / 10));
  }
  return load;
}

// PowerShell: counter samples (above 1%) and the name and description of each process in them, as one JSON object.
const SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$s=@((Get-Counter '\\GPU Engine(*)\\Utilization Percentage').CounterSamples | Where-Object { $_.CookedValue -gt 1 } | ForEach-Object { @{ i=$_.InstanceName; v=[math]::Round($_.CookedValue,1) } })",
  "$ids=@($s | ForEach-Object { if($_.i -match '^pid_(\\d+)_'){ [int]$matches[1] } } | Sort-Object -Unique)",
  "$p=@($ids | ForEach-Object { $x=Get-Process -Id $_; if($x){ @{ pid=$x.Id; name=$x.ProcessName; title=[string]$x.Description } } })",
  "@{ samples=$s; procs=$p } | ConvertTo-Json -Depth 4 -Compress",
].join('; ');

function runPowerShell() {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
      { windowsHide: true, timeout: 10000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
        if (error) return reject(error);
        try { resolve(JSON.parse(String(stdout).trim() || '{}')); } catch (e) { reject(e); }
      });
  });
}

function createGpuBusy({ run = runPowerShell, platform = process.platform, now = Date.now, minPercent = 30, canned = null } = {}) {
  let last = null, at = -Infinity, flight = null;
  async function read() {
    if (Array.isArray(canned)) return canned.map(b => ({ name: String(b.name), title: String(b.title || ''), percent: Math.round(Number(b.percent) || 0) }));
    const data = await run();
    const load = parseSamples(data);
    const procs = new Map((Array.isArray(data?.procs) ? data.procs : []).map(p => [Number(p.pid), p]));
    const busy = [];
    for (const [pid, percent] of load) {
      const p = procs.get(pid);
      if (!p || OWN.has(String(p.name || '').toLowerCase()) || percent < minPercent) continue;
      busy.push({ name: String(p.name), title: String(p.title || '').trim(), percent: Math.round(percent) });
    }
    return busy.sort((a, b) => b.percent - a.percent).slice(0, 3);
  }
  return {
    // {busy:[{name, title, percent}], checkedAt}. Errors are quiet (an empty list) and also wait for the next window.
    async check() {
      if (platform !== 'win32' && !Array.isArray(canned)) return { busy: [], checkedAt: null };
      if (last && now() - at < GAP_MS) return last;
      if (flight) return flight;
      flight = (async () => {
        let busy = [];
        try { busy = await read(); } catch {}
        at = now(); last = { busy, checkedAt: at }; flight = null;
        return last;
      })();
      return flight;
    },
  };
}

module.exports = { parseSamples, createGpuBusy };
