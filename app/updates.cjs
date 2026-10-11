'use strict';
// Version check and updates from GitHub Releases.
// A release carries lumen-update.json (build number, notes, size and SHA-256 of the portable ZIP and the setup) and
// lumen-update.json.sig, an Ed25519 signature made with the project's offline release key. Lumen only trusts a manifest whose
// signature matches the public key below, and only installs a file whose size and SHA-256 match that manifest, so a changed
// release asset (or a compromised account without the key) cannot push an update.
// Installing: the app quits and backend/lumen-updater.exe (copied to TEMP first) replaces the app folder from the ZIP, or
// runs the setup silently for an installed copy, then starts Lumen again. User data in %LOCALAPPDATA%\lumen.cpp is untouched.
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), https = require('node:https'), http = require('node:http'), crypto = require('node:crypto'), os = require('node:os');
const {spawn} = require('node:child_process');

const REPO = 'olves/lumen.cpp';
const PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAG9kSVLeuTmPYrxSiCTGXOH5mw46318A7rHy/WkCuSkw=\n-----END PUBLIC KEY-----\n';
const MANIFEST = 'lumen-update.json', DAY = 86400000, MAX_JSON = 2 * 1048576, MAX_FILE = 2 * 1073741824;

function updateError(code, message) { return Object.assign(new Error(message), {code}); }
function buildOf(version) { const m = /-beta\.(\d+)$/.exec(String(version || '')); return m ? Number(m[1]) : 0; }

function createUpdater({dataDir, appDir, version, emit = () => {}, log = () => {}, test = false, apiBase, publicKey}) {
  // Overrides exist only for the isolated UI tests; the product always uses GitHub and the embedded key.
  const api = test && apiBase ? apiBase.replace(/\/$/, '') : 'https://api.github.com';
  const key = crypto.createPublicKey(test && publicKey ? publicKey : PUBLIC_KEY);
  const build = buildOf(version), dir = path.join(dataDir, 'updates'), statePath = path.join(dataDir, 'update-state.json');
  const installed = fs.existsSync(path.join(appDir, 'unins000.exe'));
  let checking = null, download = null, lastError = null;

  function readState() { try { const s = JSON.parse(fs.readFileSync(statePath, 'utf8')); return s && typeof s === 'object' ? s : {}; } catch { return {}; } }
  function writeState(patch) { const s = {...readState(), ...patch}; fs.mkdirSync(dataDir, {recursive: true}); const temp = statePath + '.tmp'; fs.writeFileSync(temp, JSON.stringify(s)); fs.renameSync(temp, statePath); return s; }
  function writable() { try { fs.accessSync(path.dirname(appDir), fs.constants.W_OK); fs.accessSync(appDir, fs.constants.W_OK); return true; } catch { return false; } }

  function status() {
    const s = readState(), latest = s.latest && s.latest.build > build ? s.latest : null;
    const ready = download?.phase === 'ready' || (latest && s.downloaded?.build === latest.build && fs.existsSync(s.downloaded.file || ''));
    return {version, build, repo: REPO, mode: installed ? 'installed' : 'portable', writable: installed || writable(), auto: s.auto !== false,
      lastCheck: s.lastCheck || null, checking: !!checking, error: lastError,
      available: latest ? {build: latest.build, version: latest.version, notes: latest.notes, published: latest.published, size: latest.asset.size} : null,
      download: download && download.phase !== 'ready' ? {phase: download.phase, bytes: download.bytes, total: download.total, speed: Math.round(download.speed || 0), error: download.error || null} : (ready ? {phase: 'ready'} : null)};
  }
  const publish = () => emit(status());

  function get(url, {max = MAX_JSON, headers = {}, signal, redirects = 5} = {}) {
    return new Promise((resolve, reject) => {
      const target = new URL(url);
      const local = test && target.protocol === 'http:' && target.hostname === '127.0.0.1';
      if (target.protocol !== 'https:' && !local) return reject(updateError('network', 'Updates use https only.'));
      const request = (local ? http : https).get(target, {headers: {'user-agent': 'lumen.cpp-updater', accept: 'application/vnd.github+json', ...headers}, timeout: 20000}, response => {
        const code = response.statusCode || 0;
        if (code >= 300 && code < 400 && response.headers.location) { response.resume(); if (!redirects) return reject(updateError('network', 'Too many redirects.')); return resolve(get(new URL(response.headers.location, target).href, {max, headers, signal, redirects: redirects - 1})); }
        resolve(response);
      });
      request.on('timeout', () => request.destroy(updateError('network', 'GitHub did not answer in time.')));
      request.on('error', error => reject(error.code ? error : updateError('network', error.message)));
      signal?.addEventListener('abort', () => request.destroy(updateError('aborted', 'Cancelled')), {once: true});
    });
  }
  async function getBuffer(url, max) {
    const response = await get(url, {max});
    if (response.statusCode === 403 || response.statusCode === 429) { response.resume(); throw updateError('limit', 'GitHub is limiting requests right now. Try again later.'); }
    if (response.statusCode === 404) { response.resume(); throw updateError('missing', 'No releases were found.'); }
    if (response.statusCode !== 200) { response.resume(); throw updateError('network', 'GitHub returned ' + response.statusCode + '.'); }
    const parts = []; let size = 0;
    for await (const piece of response) { size += piece.length; if (size > max) { response.destroy(); throw updateError('invalid', 'The response is too large.'); } parts.push(piece); }
    return Buffer.concat(parts);
  }

  // A manifest is accepted only if its signature verifies and its fields are sane.
  function readManifest(bytes, signature, assets) {
    let ok = false; try { ok = crypto.verify(null, bytes, key, Buffer.from(signature.toString('utf8').trim(), 'base64')); } catch {}
    if (!ok) throw updateError('signature', 'The update manifest is not signed by the Lumen release key.');
    const m = JSON.parse(bytes.toString('utf8'));
    const asset = a => a && typeof a.name === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(a.name) && Number.isSafeInteger(a.size) && a.size > 0 && a.size < MAX_FILE && /^[a-f0-9]{64}$/.test(a.sha256);
    if (m.product !== 'lumen.cpp' || m.channel !== 'beta' || !Number.isSafeInteger(m.build) || m.build < 1 || !asset(m.assets?.zip) || !asset(m.assets?.setup)) throw updateError('invalid', 'The update manifest is invalid.');
    const pick = installed ? m.assets.setup : m.assets.zip, remote = assets.find(a => a.name === pick.name);
    if (!remote || remote.size !== pick.size) throw updateError('invalid', 'The release files do not match the manifest.');
    const notes = {en: String(m.notes?.en || '').slice(0, 4000), tr: String(m.notes?.tr || '').slice(0, 4000)};
    return {build: m.build, version: String(m.version || '').slice(0, 40), published: String(m.published || '').slice(0, 40), notes, asset: {...pick, url: remote.browser_download_url}};
  }

  async function check({manual = false} = {}) {
    if (checking) return checking;
    checking = (async () => {
      publish();
      try {
        const releases = JSON.parse((await getBuffer(`${api}/repos/${REPO}/releases?per_page=20`, MAX_JSON)).toString('utf8'));
        if (!Array.isArray(releases)) throw updateError('invalid', 'Unexpected answer from GitHub.');
        let best = null, rejected = null;
        for (const release of releases) {
          if (release.draft) continue;
          const assets = Array.isArray(release.assets) ? release.assets : [];
          const manifest = assets.find(a => a.name === MANIFEST), sig = assets.find(a => a.name === MANIFEST + '.sig');
          if (!manifest || !sig) continue;
          try {
            const info = readManifest(await getBuffer(manifest.browser_download_url, 65536), await getBuffer(sig.browser_download_url, 4096), assets);
            if (!best || info.build > best.build) best = info;
          } catch (error) { rejected = error; log('[update] release ' + (release.tag_name || '?') + ' rejected: ' + error.message); }
        }
        if (!best && rejected) throw rejected;
        lastError = null; writeState({lastCheck: Date.now(), latest: best});
      } catch (error) {
        lastError = error.message; log('[update] check failed: ' + error.message);
        if (manual) throw error;
      } finally { checking = null; publish(); }
      return status();
    })();
    return checking;
  }

  async function sha256(file) { return new Promise((resolve, reject) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject); }); }

  async function startDownload() {
    const s = readState(), latest = s.latest;
    if (!latest || latest.build <= build) throw updateError('none', 'There is no newer version to download.');
    if (download && ['downloading', 'verifying'].includes(download.phase)) return status();
    const file = path.join(dir, latest.asset.name.replace(/(\.[a-z]+)$/i, `-build${latest.build}$1`)), partial = file + '.partial';
    if (s.downloaded?.build === latest.build && fs.existsSync(file) && fs.statSync(file).size === latest.asset.size) { download = {phase: 'ready'}; publish(); return status(); }
    const controller = new AbortController();
    download = {phase: 'downloading', bytes: 0, total: latest.asset.size, speed: 0, controller};
    publish();
    (async () => {
      let lastEmit = 0, windowStart = Date.now(), windowBytes = 0;
      try {
        await fsp.mkdir(dir, {recursive: true});
        let start = fs.existsSync(partial) ? fs.statSync(partial).size : 0; if (start > latest.asset.size) { await fsp.rm(partial, {force: true}); start = 0; }
        const response = await get(latest.asset.url, {headers: {accept: 'application/octet-stream', ...(start ? {range: `bytes=${start}-`} : {})}, signal: controller.signal});
        if (response.statusCode === 200) start = 0; else if (response.statusCode !== 206) { response.resume(); throw updateError('network', 'The download returned ' + response.statusCode + '.'); }
        const out = fs.createWriteStream(partial, {flags: start ? 'a' : 'w'}); download.bytes = start;
        try {
          for await (const piece of response) {
            if (download.bytes + piece.length > latest.asset.size) throw updateError('invalid', 'The download is larger than expected.');
            if (!out.write(piece)) await new Promise(r => out.once('drain', r));
            download.bytes += piece.length; windowBytes += piece.length;
            const now = Date.now(); if (now - windowStart >= 1000) { const rate = windowBytes / ((now - windowStart) / 1000); download.speed = download.speed ? download.speed * 0.6 + rate * 0.4 : rate; windowStart = now; windowBytes = 0; }
            if (now - lastEmit > 250) { lastEmit = now; publish(); }
          }
        } finally { await new Promise(r => out.end(r)); }
        if (download.bytes !== latest.asset.size) throw updateError('network', 'The download ended early. Try again to continue it.');
        download.phase = 'verifying'; publish();
        if (await sha256(partial) !== latest.asset.sha256) { await fsp.rm(partial, {force: true}); throw updateError('verify', 'The downloaded update failed verification and was removed. Try again.'); }
        await fsp.rm(file, {force: true}); await fsp.rename(partial, file);
        writeState({downloaded: {build: latest.build, file, sha256: latest.asset.sha256, mode: installed ? 'setup' : 'zip'}});
        download = {phase: 'ready'};
      } catch (error) {
        download = {...download, phase: error.code === 'aborted' ? 'cancelled' : 'failed', error: error.code === 'aborted' ? null : error.message, speed: 0};
        log('[update] download: ' + error.message);
      } finally { publish(); }
    })();
    return status();
  }

  // Starts the updater and asks the app to quit; the updater waits for this process to exit before changing files.
  async function install({quit, relaunchArgs = [], language = 'en'}) {
    const s = readState(), d = s.downloaded;
    if (!d || !s.latest || d.build !== s.latest.build || !fs.existsSync(d.file)) throw updateError('none', 'Download the update first.');
    if (!installed && !writable()) throw updateError('denied', 'Lumen cannot write to its folder. Download the new version from GitHub instead.');
    if (await sha256(d.file) !== d.sha256) { await fsp.rm(d.file, {force: true}); writeState({downloaded: null}); throw updateError('verify', 'The downloaded update changed on disk and was removed. Download it again.'); }
    const source = path.join(appDir, 'resources', 'app', 'backend', 'lumen-updater.exe');
    const helper = path.join(os.tmpdir(), `lumen-updater-${crypto.randomBytes(6).toString('hex')}.exe`);
    await fsp.copyFile(source, helper);
    const args = ['--pid', String(process.pid), '--mode', d.mode, '--file', d.file, '--sha256', d.sha256, '--target', appDir, '--exe', path.basename(process.execPath), '--log', path.join(dataDir, 'update.log'), '--lang', language === 'tr' ? 'tr' : 'en'];
    for (const a of relaunchArgs) args.push('--arg', a);
    const child = spawn(helper, args, {detached: true, stdio: 'ignore', windowsHide: true, cwd: os.tmpdir()});
    child.unref();
    log('[update] installing build ' + d.build + ' (' + d.mode + ')');
    quit();
    return true;
  }

  // Leftovers from earlier updates: old downloads, helper copies and folders the updater could not remove.
  async function cleanup() {
    try { const s = readState(); if (s.downloaded && s.downloaded.build <= build) { await fsp.rm(s.downloaded.file, {force: true}); writeState({downloaded: null}); }
      for (const name of await fsp.readdir(dir).catch(() => [])) if (/-build(\d+)\./.test(name) && Number(/-build(\d+)\./.exec(name)[1]) <= build) await fsp.rm(path.join(dir, name), {force: true}); } catch {}
    try { for (const name of await fsp.readdir(os.tmpdir())) if (/^lumen-updater-[a-f0-9]{12}\.exe$/.test(name)) await fsp.rm(path.join(os.tmpdir(), name), {force: true}).catch(() => {}); } catch {}
    try { const parent = path.dirname(appDir), base = path.basename(appDir).toLowerCase(); for (const name of await fsp.readdir(parent)) if (name.toLowerCase().startsWith(base + '.old-') || name.toLowerCase().startsWith(base + '.new-')) await fsp.rm(path.join(parent, name), {recursive: true, force: true}).catch(() => {}); } catch {}
  }

  function scheduleAutoCheck(delay = 20000) {
    const s = readState(); if (s.auto === false || (s.lastCheck && Date.now() - s.lastCheck < DAY)) return;
    setTimeout(() => check().catch(() => {}), delay).unref?.();
  }

  return {
    status, check, download: startDownload, install, cleanup, scheduleAutoCheck,
    setAuto(on) { writeState({auto: on === true}); publish(); return status(); },
    cancel() { download?.controller?.abort(); return true; }
  };
}

module.exports = {createUpdater, buildOf, REPO};
