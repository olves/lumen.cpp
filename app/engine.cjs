'use strict';
// llama.cpp engine updates. The bundled engine (b11438) stays installed as the fallback; a newer official build from
// github.com/ggml-org/llama.cpp is downloaded only when the user asks, checked against the SHA-256 digest GitHub publishes for
// that file, unpacked into <data>/runtime/b<N>/<engine>, tested (--version, and --list-devices for GPU engines) and then
// activated through <data>/engine-override.json. lumen-host tries that engine first and falls back to the bundled one, marking
// the override as failed, if it cannot start or does not use the GPU. CUDA runtime DLLs are reused when GitHub's digest for
// the runtime archive is unchanged, so a CUDA update downloads only llama.cpp itself (~150 MB instead of ~550 MB).
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), https = require('node:https'), crypto = require('node:crypto');
const {spawn, execFile} = require('node:child_process');

const BUNDLED = 'b11438', REPO = 'ggml-org/llama.cpp', DAY = 86400000, SNOOZE = 7 * DAY;
const ASSET = {cuda13: /^llama-b(\d+)-bin-win-cuda-13\.(\d+)-x64\.zip$/, cuda12: /^llama-b(\d+)-bin-win-cuda-12\.(\d+)-x64\.zip$/, vulkan: /^llama-b(\d+)-bin-win-vulkan-x64\.zip$/, cpu: /^llama-b(\d+)-bin-win-cpu-x64\.zip$/};
const CUDART = {cuda13: /^cudart-llama-bin-win-cuda-13\.(\d+)-x64\.zip$/, cuda12: /^cudart-llama-bin-win-cuda-12\.(\d+)-x64\.zip$/};
const CUDA_DLL = /^(cudart|cublas|cublasLt)64_\d+\.dll$/i;
const engineError = (code, message) => Object.assign(new Error(message), {code});
const wait = ms => new Promise(r => setTimeout(r, ms));
const buildNumber = tag => Number(/^b(\d+)$/.exec(String(tag || ''))?.[1] || 0);

function createEngineUpdater({dataDir, emit = () => {}, log = () => {}, unload = async () => {}}) {
  const runtime = path.join(dataDir, 'runtime'), statePath = path.join(dataDir, 'engine-update.json'), overridePath = path.join(dataDir, 'engine-override.json');
  let checking = null, job = null, lastError = null;
  const readJson = (file, fallback) => { try { const v = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); return v && typeof v === 'object' ? v : fallback; } catch { return fallback; } };
  const writeJson = (file, value) => { const temp = file + '.tmp'; fs.writeFileSync(temp, JSON.stringify(value, null, 1)); fs.renameSync(temp, file); };
  const readState = () => readJson(statePath, {});
  const writeState = patch => { const s = {...readState(), ...patch}; writeJson(statePath, s); return s; };
  const backend = () => { const b = readJson(path.join(dataDir, 'engine-preferences.json'), {}).Backend; return ASSET[b] ? b : 'cpu'; };

  // The engine chats run with now: an active, non-failed override for the selected engine, otherwise the bundled build.
  function current() {
    const o = readJson(overridePath, null), b = backend();
    if (o && o.backend === b && !o.failed && fs.existsSync(o.path || '')) return {build: o.build, backend: b, path: o.path, updated: true};
    return {build: BUNDLED, backend: b, updated: false, failed: o && o.backend === b && o.failed && !o.failedSeen ? {build: o.build, error: o.error || ''} : null};
  }
  function status() {
    const s = readState(), cur = current(), latest = s.latest && s.latest.backend === cur.backend && buildNumber(s.latest.build) > buildNumber(cur.build) ? s.latest : null;
    return {current: cur, auto: s.auto !== false, lastCheck: s.lastCheck || null, checking: !!checking, error: lastError,
      available: latest ? {build: latest.build, published: latest.published, size: latest.size, behind: buildNumber(latest.build) - buildNumber(cur.build)} : null,
      snoozed: !!(latest && s.snoozedUntil && s.snoozedUntil > Date.now()),
      job: job ? {phase: job.phase, bytes: job.bytes, total: job.total, error: job.error || null} : null,
      previous: readJson(overridePath, null)?.previous || null};
  }
  const publish = () => emit(status());

  function get(url, {accept = 'application/vnd.github+json', range, signal, redirects = 5} = {}) {
    return new Promise((resolve, reject) => {
      const target = new URL(url); if (target.protocol !== 'https:') return reject(engineError('network', 'Engine downloads use https only.'));
      const request = https.get(target, {headers: {'user-agent': 'lumen.cpp-engine-updater', accept, ...(range ? {range} : {})}, timeout: 20000}, response => {
        const code = response.statusCode || 0;
        if (code >= 300 && code < 400 && response.headers.location) { response.resume(); if (!redirects) return reject(engineError('network', 'Too many redirects.')); return resolve(get(new URL(response.headers.location, target).href, {accept, range, signal, redirects: redirects - 1})); }
        resolve(response);
      });
      request.on('timeout', () => request.destroy(engineError('network', 'GitHub did not answer in time.')));
      request.on('error', error => reject(error.code === 'aborted' ? error : engineError('network', error.message)));
      signal?.addEventListener('abort', () => request.destroy(engineError('aborted', 'Cancelled')), {once: true});
    });
  }
  async function json(url) {
    const r = await get(url); if (r.statusCode === 403 || r.statusCode === 429) { r.resume(); throw engineError('limit', 'GitHub is limiting requests right now.'); }
    if (r.statusCode !== 200) { r.resume(); throw engineError('network', 'GitHub returned ' + r.statusCode + '.'); }
    const parts = []; let size = 0; for await (const p of r) { size += p.length; if (size > 4 * 1048576) { r.destroy(); throw engineError('invalid', 'Response too large.'); } parts.push(p); }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  }
  const asset = a => ({name: a.name, url: a.browser_download_url, size: a.size, sha256: String(a.digest || '').replace(/^sha256:/, '')});

  // Newest numbered build that has a Windows x64 file for the selected engine and a published SHA-256 digest.
  async function check() {
    if (checking) return checking;
    checking = (async () => {
      publish();
      try {
        const b = backend(), releases = await json(`https://api.github.com/repos/${REPO}/releases?per_page=5`);
        let best = null;
        for (const r of Array.isArray(releases) ? releases : []) {
          if (r.draft || !/^b\d+$/.test(r.tag_name || '')) continue;
          const main = (r.assets || []).find(a => ASSET[b].test(a.name) && /^sha256:[a-f0-9]{64}$/.test(a.digest || ''));
          if (!main || (best && buildNumber(r.tag_name) <= buildNumber(best.build))) continue;
          const rt = CUDART[b] ? (r.assets || []).find(a => CUDART[b].test(a.name) && /^sha256:[a-f0-9]{64}$/.test(a.digest || '')) : null;
          if (CUDART[b] && !rt) continue;
          best = {build: r.tag_name, backend: b, published: r.published_at, main: asset(main), cudart: rt ? asset(rt) : null};
        }
        if (best) {
          // CUDA runtime: reuse the installed DLLs when GitHub's digest for the runtime archive is the one the current engine came from.
          let reuse = false;
          if (best.cudart) { const cur = current(), known = readState().cudart?.[cur.build] || (cur.build === BUNDLED ? await bundledCudart(b) : null); reuse = known === best.cudart.sha256; }
          best.reuseCudart = reuse; best.size = best.main.size + (best.cudart && !reuse ? best.cudart.size : 0);
        }
        lastError = null; writeState({lastCheck: Date.now(), latest: best});
      } catch (error) { lastError = error.message; log('[engine] check failed: ' + error.message); throw error; }
      finally { checking = null; publish(); }
      return status();
    })();
    return checking;
  }
  async function bundledCudart(b) {
    const s = readState(); if (s.cudart?.[BUNDLED]) return s.cudart[BUNDLED];
    const r = await json(`https://api.github.com/repos/${REPO}/releases/tags/${BUNDLED}`);
    const rt = (r.assets || []).find(a => CUDART[b].test(a.name)); const sha = String(rt?.digest || '').replace(/^sha256:/, '');
    if (sha) writeState({cudart: {...(s.cudart || {}), [BUNDLED]: sha}});
    return sha || null;
  }

  // Retries a stalled or dropped download a few times, continuing from what is already on disk.
  async function download(file, item, signal) {
    for (let attempt = 1; ; attempt++) {
      try { return await downloadOnce(file, item, signal); }
      catch (error) { if (signal.aborted || !['network', 'stalled'].includes(error.code) || attempt >= 3) throw error; log('[engine] download retry ' + attempt + ': ' + error.message); await wait(2000 * attempt); }
    }
  }
  async function downloadOnce(file, item, signal) {
    const partial = file + '.partial'; let start = fs.existsSync(partial) ? fs.statSync(partial).size : 0; if (start > item.size) { fs.rmSync(partial); start = 0; }
    const r = await get(item.url, {accept: 'application/octet-stream', range: start ? `bytes=${start}-` : undefined, signal});
    if (r.statusCode === 200) start = 0; else if (r.statusCode !== 206) { r.resume(); throw engineError('network', 'The download returned ' + r.statusCode + '.'); }
    const out = fs.createWriteStream(partial, {flags: start ? 'a' : 'w'}); let got = start, last = 0;
    let stall = setTimeout(() => r.destroy(engineError('stalled', 'The download stalled.')), 30000);
    try { for await (const p of r) { clearTimeout(stall); stall = setTimeout(() => r.destroy(engineError('stalled', 'The download stalled.')), 30000); got += p.length; if (got > item.size) throw engineError('invalid', 'The download is larger than expected.'); if (!out.write(p)) await new Promise(res => out.once('drain', res)); job.bytes = job.base + got; if (Date.now() - last > 250) { last = Date.now(); publish(); } } }
    finally { clearTimeout(stall); await new Promise(res => out.end(res)); }
    if (got !== item.size) throw engineError('network', 'The download ended early. Try again to continue it.');
    const h = crypto.createHash('sha256'); await new Promise((res, rej) => fs.createReadStream(partial).on('data', d => h.update(d)).on('end', res).on('error', rej));
    if (h.digest('hex') !== item.sha256) { fs.rmSync(partial, {force: true}); throw engineError('verify', 'The engine download did not match GitHub\'s checksum and was removed.'); }
    await fsp.rename(partial, file); return file;
  }
  // Windows' own tar.exe unpacks zip files and refuses paths that leave the target folder.
  function unzip(file, dir) {
    return new Promise((resolve, reject) => execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', file, '-C', dir], {windowsHide: true, timeout: 300000}, error => error ? reject(engineError('unpack', 'The engine archive could not be unpacked.')) : resolve()));
  }
  function run(exe, args, ms = 30000) {
    return new Promise(resolve => {
      const child = spawn(exe, args, {cwd: path.dirname(exe), windowsHide: true}); let output = '';
      child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
      const timer = setTimeout(() => child.kill(), ms);
      child.on('error', () => { clearTimeout(timer); resolve({code: -1, output}); });
      child.on('close', code => { clearTimeout(timer); resolve({code, output: output.slice(-4000)}); });
    });
  }

  async function install() {
    const s = readState(), latest = s.latest, cur = current();
    if (!latest || latest.backend !== cur.backend || buildNumber(latest.build) <= buildNumber(cur.build)) throw engineError('none', 'There is no newer engine to install.');
    if (job && ['downloading', 'verifying', 'testing'].includes(job.phase)) return status();
    const controller = new AbortController(), downloads = path.join(runtime, 'downloads');
    job = {phase: 'downloading', bytes: 0, base: 0, total: latest.size, controller}; publish();
    (async () => {
      const target = path.join(runtime, latest.build, latest.backend), staging = target + '.staging';
      try {
        await fsp.mkdir(downloads, {recursive: true});
        const mainZip = await download(path.join(downloads, latest.main.name), latest.main, controller.signal);
        let runtimeZip = null;
        // The CUDA runtime DLLs are copied from the current engine when they are the same; if they are not on disk, download them.
        const from = cur.updated ? path.dirname(cur.path) : path.join(runtime, BUNDLED, cur.backend);
        const local = latest.cudart && fs.existsSync(from) ? (await fsp.readdir(from)).filter(n => CUDA_DLL.test(n)) : [];
        if (latest.cudart && latest.reuseCudart && local.length < 3) { latest.reuseCudart = false; job.total = latest.main.size + latest.cudart.size; }
        if (latest.cudart && !latest.reuseCudart) { job.base = latest.main.size; runtimeZip = await download(path.join(downloads, latest.cudart.name), latest.cudart, controller.signal); }
        job.phase = 'verifying'; publish();
        await fsp.rm(staging, {recursive: true, force: true}); await fsp.mkdir(staging, {recursive: true});
        await unzip(mainZip, staging);
        if (runtimeZip) await unzip(runtimeZip, staging);
        else if (latest.cudart) for (const name of local) await fsp.copyFile(path.join(from, name), path.join(staging, name)); // same runtime archive as the current engine
        const exe = path.join(staging, 'llama-server.exe'); if (!fs.existsSync(exe)) throw engineError('invalid', 'The engine archive does not contain llama-server.exe.');
        job.phase = 'testing'; publish();
        const version = await run(exe, ['--version'], 30000);
        if (version.code !== 0 || !new RegExp('\\(build ' + buildNumber(latest.build) + '\\b|version: ' + buildNumber(latest.build) + '\\b').test(version.output)) throw engineError('test', 'The new engine did not start (' + (version.output.trim().split('\n').pop() || 'no output') + ').');
        if (latest.backend !== 'cpu') { const devices = await run(exe, ['--list-devices'], 60000); if (!/(CUDA|Vulkan)\d*\s*:/i.test(devices.output)) throw engineError('test', 'The new engine did not find the GPU.'); }
        await fsp.rm(target, {recursive: true, force: true}); await fsp.rename(staging, target);
        if (latest.cudart) writeState({cudart: {...(readState().cudart || {}), [latest.build]: latest.cudart.sha256}});
        // Keep the engine that ran before as the way back; older updated engines are removed.
        const before = readJson(overridePath, null), previous = cur.updated ? {build: cur.build, path: cur.path} : null;
        writeJson(overridePath, {build: latest.build, backend: latest.backend, path: path.join(target, 'llama-server.exe'), installedAt: new Date().toISOString(), previous});
        if (before?.previous?.path && before.previous.build !== cur.build) await fsp.rm(path.dirname(before.previous.path), {recursive: true, force: true}).catch(() => {});
        await fsp.rm(mainZip, {force: true}); if (runtimeZip) await fsp.rm(runtimeZip, {force: true});
        await unload().catch(() => {});
        job = {phase: 'done'}; log('[engine] installed ' + latest.build + ' (' + latest.backend + ')');
      } catch (error) {
        await fsp.rm(staging, {recursive: true, force: true}).catch(() => {});
        job = {phase: error.code === 'aborted' ? 'cancelled' : 'failed', error: error.code === 'aborted' ? null : error.message};
        log('[engine] install failed: ' + error.message);
      } finally { publish(); }
    })();
    return status();
  }

  // Back to the engine that ran before the last update (or the bundled one).
  async function rollback() {
    const o = readJson(overridePath, null); if (!o) return status();
    if (o.previous?.path && fs.existsSync(o.previous.path)) writeJson(overridePath, {build: o.previous.build, backend: o.backend, path: o.previous.path, installedAt: new Date().toISOString(), previous: null});
    else await fsp.rm(overridePath, {force: true});
    await unload().catch(() => {}); publish(); return status();
  }

  return {
    status, check, install, rollback,
    cancel() { job?.controller?.abort(); return true; },
    snooze() { const s = readState(); writeState({snoozedUntil: Date.now() + SNOOZE, snoozedBuild: s.latest?.build || null}); publish(); return status(); },
    setAuto(on) { writeState({auto: on === true}); publish(); return status(); },
    // Clears the "failed" note after the user has seen it, so the notice is shown once.
    acknowledgeFailure() { const o = readJson(overridePath, null); if (o?.failed) { o.failedSeen = true; writeJson(overridePath, o); } return status(); }
  };
}
module.exports = {createEngineUpdater, BUNDLED};
