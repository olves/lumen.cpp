'use strict';
// Running approved commands for the agent (v1.1), through backend/lumen-exec.exe (LumenExec.cs): PowerShell in the workspace
// folder, inside a Windows Job Object, so a command and everything it started end together. Two kinds:
//   run({command, cwd, timeoutMs, signal, onLine}) -> {code, timedOut, stopped, output, lines, truncated, ms}   foreground
//   start({command, cwd}) -> id; read(id) -> {output, running, code}; stop(id); list(); stopAll()              background jobs
//   classify(command, root) -> {harmless, outside, reasons}   for Auto mode (execpolicy.cjs) and the "outside" warning
// The environment is Lumen's own minus anything that looks like a key, token, password or Lumen/Electron internals, so an approved
// command cannot read the user's API keys from the environment. Output for the model is cut to its first and last part.
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { classify: classifyParsed } = require('./execpolicy.cjs');

const SECRET = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD_|CREDENTIAL|AUTH|COOKIE|SESSION)/i;
const INTERNAL = /^(ELECTRON_|LUMEN_|NODE_OPTIONS$|NODE_TEST|CHROME_|GOOGLE_API)/i;
const KEEP_HEAD = 4000, KEEP_TAIL = 12000, MAX_LINES = 20000, MAX_JOBS = 5, JOB_BUFFER = 200000;

function cleanEnv(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string' && !SECRET.test(k) && !INTERNAL.test(k)) out[k] = v;
  return out;
}
// First KEEP_HEAD and last KEEP_TAIL characters, with a note of what was left out.
function clip(text) {
  if (text.length <= KEEP_HEAD + KEEP_TAIL) return { text, truncated: false };
  return { text: text.slice(0, KEEP_HEAD) + `\n… [${text.length - KEEP_HEAD - KEEP_TAIL} characters left out] …\n` + text.slice(-KEEP_TAIL), truncated: true };
}

function createExec({ helper, env = process.env, log = () => {} }) {
  const jobs = new Map();

  function spawnHelper(request, onRecord) {
    const child = spawn(helper, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    let ended = null;
    lines.on('line', line => { let r; try { r = JSON.parse(line); } catch { return; } if (r.t === 'x') ended = r; onRecord(r); });
    child.stderr.on('data', d => log('[exec] ' + String(d).slice(0, 500)));
    child.stdin.on('error', () => {});
    child.stdin.write(JSON.stringify({ ...request, env: cleanEnv(env) }) + '\n');
    const done = new Promise(resolve => child.on('close', code => resolve(ended || { t: 'x', code: code ?? -1, error: 'The command helper ended unexpectedly.' })));
    child.on('error', error => log('[exec] ' + error.message));
    return { child, done, stop: () => { try { child.stdin.write('stop\n'); } catch {} setTimeout(() => { try { child.kill(); } catch {} }, 3000).unref(); } };
  }

  async function run({ command, cwd, timeoutMs = 120000, signal, onLine = () => {} }) {
    let all = '', count = 0;
    const h = spawnHelper({ command: String(command), cwd: String(cwd), timeoutMs: Math.max(1000, Math.min(600000, timeoutMs | 0)) }, r => {
      if (r.t === 'o' || r.t === 'e') { if (++count <= MAX_LINES) { all += (r.t === 'e' ? '[err] ' : '') + r.d + '\n'; onLine(r.t, r.d); } }
    });
    const onAbort = () => h.stop();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const end = await h.done;
      const c = clip(all);
      return { code: end.code, timedOut: !!end.timedOut, stopped: !!end.stopped || !!signal?.aborted, error: end.error || null, output: c.text, truncated: c.truncated || count > MAX_LINES, lines: count, ms: end.ms ?? null };
    } finally { signal?.removeEventListener('abort', onAbort); }
  }

  function parse(command) {
    return new Promise((resolve, reject) => {
      const child = spawn(helper, ['--parse'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      let out = ''; child.stdout.on('data', d => out += d);
      const timer = setTimeout(() => { child.kill(); reject(Error('The command could not be read in time.')); }, 15000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', () => { clearTimeout(timer); try { resolve(JSON.parse(out)); } catch { reject(Error('The command could not be read.')); } });
      child.stdin.end(JSON.stringify({ command: String(command) }) + '\n');
    });
  }
  async function classify(command, root) {
    try { return classifyParsed(await parse(command), { root }); }
    catch (error) { return { harmless: false, outside: false, reasons: ['unreadable: ' + error.message] }; }
  }

  // Background jobs: dev servers, watchers. They keep running after the agent's step; the agent reads new output and stops them.
  function start({ command, cwd, label }) {
    if ([...jobs.values()].filter(j => j.running).length >= MAX_JOBS) throw Error(`At most ${MAX_JOBS} background commands can run at once; stop one first.`);
    const id = 'bg' + crypto.randomBytes(3).toString('hex');
    const job = { id, command: String(command), label: String(label || command).slice(0, 120), cwd, started: Date.now(), running: true, code: null, buffer: '', read: 0, dropped: 0 };
    const h = spawnHelper({ command: job.command, cwd: String(cwd), timeoutMs: 0 }, r => {
      if (r.t === 'o' || r.t === 'e') { job.buffer += (r.t === 'e' ? '[err] ' : '') + r.d + '\n'; if (job.buffer.length > JOB_BUFFER) { const cut = job.buffer.length - JOB_BUFFER; job.buffer = job.buffer.slice(cut); job.read = Math.max(0, job.read - cut); job.dropped += cut; } }
    });
    job.handle = h;
    h.done.then(end => { job.running = false; job.code = end.code; });
    jobs.set(id, job);
    return { id, label: job.label };
  }
  function read(id) {
    const job = jobs.get(String(id)); if (!job) throw Error('No background command with that id.');
    const fresh = job.buffer.slice(job.read); job.read = job.buffer.length;
    const c = clip(fresh);
    return { id: job.id, running: job.running, code: job.code, output: c.text, truncated: c.truncated || job.dropped > 0 };
  }
  async function stop(id) {
    const job = jobs.get(String(id)); if (!job) throw Error('No background command with that id.');
    if (job.running) { job.handle.stop(); await Promise.race([job.handle.done, new Promise(r => setTimeout(r, 5000))]); }
    return { id: job.id, running: job.running, code: job.code };
  }
  const list = () => [...jobs.values()].map(j => ({ id: j.id, label: j.label, command: j.command, running: j.running, code: j.code, started: j.started }));
  async function stopAll() { await Promise.all([...jobs.values()].filter(j => j.running).map(j => stop(j.id).catch(() => {}))); }

  return { run, parse, classify, start, read, stop, list, stopAll };
}

module.exports = { createExec, cleanEnv, clip };
