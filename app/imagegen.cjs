'use strict';
// Image generation. Local: stable-diffusion.cpp's sd-server (official Windows builds, pinned release and SHA-256), started
// on 127.0.0.1 with a random port only while images are being made, stopped after a few idle minutes or before a chat
// needs the GPU. Cloud: the user's provider (cloud.cjs generateImage), with the same rules as cloud chat.
// Generated pictures are PNG files in <data>/generated/<sha256>.png; conversation-generated.json links them to replies.
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const net = require('node:net'), {spawn, execFile} = require('node:child_process');

const TAG = 'master-956-1b0ba10', RELEASE = 'https://github.com/leejet/stable-diffusion.cpp/releases/download/' + TAG + '/';
const ENGINES = {
  vulkan: {label: 'Vulkan', files: [{name: 'sd-master-1b0ba10-bin-win-vulkan-x64.zip', size: 30123908, sha256: '9e8b9baff514fe5dfb77e51bf08d85f11e6f10128eac14d4474c87f563309725'}]},
  cuda12: {label: 'CUDA 12', files: [{name: 'sd-master-1b0ba10-bin-win-cuda12-x64.zip', size: 337974452, sha256: '144b9631bf2eeb9bf6bf7f148cf40aaf05739ce7c49d3ac0ec2ddf6b65765d69'},
    {name: 'cudart-sd-bin-win-cu12-x64.zip', size: 563452046, sha256: 'fe20366827d357c00797eebb58244dddab7fd9a348d70090c3871004c320f38d'}]},
  cpu: {label: 'CPU', files: [{name: 'sd-master-1b0ba10-bin-win-cpu-x64.zip', size: 17543461, sha256: '39c2ea1cc03f697864c858ad0b22b9b8ce62f945ba428e8596a814527e6db6fb'}]},
};
const VAE = {role: 'vae', repo: 'Comfy-Org/z_image_turbo', file: 'split_files/vae/ae.safetensors', sha: 'afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38', bytes: 335304388};
const QWEN = {role: 'llm', repo: 'unsloth/Qwen3-4B-Instruct-2507-GGUF', file: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf', sha: '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597', bytes: 2497281120};
// Image model packages: every file a pipeline needs, with its Hugging Face SHA-256. Apache-2.0 models only.
const PACKAGES = [
  {id: 'z-image-turbo', name: 'Z-Image Turbo', variant: 'Q4', license: 'Apache-2.0', by: 'Tongyi-MAI (Alibaba)', steps: 8, cfg: 1,
    files: [{role: 'diffusion', repo: 'leejet/Z-Image-Turbo-GGUF', file: 'z_image_turbo-Q4_K.gguf', sha: '14b375ab4f226bc5378f68f37e899ef3c2242b8541e61e2bc1aff40976086fbd', bytes: 3864250304}, QWEN, VAE]},
  {id: 'z-image-turbo-q8', name: 'Z-Image Turbo', variant: 'Q8', license: 'Apache-2.0', by: 'Tongyi-MAI (Alibaba)', steps: 8, cfg: 1,
    files: [{role: 'diffusion', repo: 'leejet/Z-Image-Turbo-GGUF', file: 'z_image_turbo-Q8_0.gguf', sha: 'df1c5baa86d1398c979495a6072dbcee79444fdb884a2445582ba0769c44e9a1', bytes: 6577440704}, QWEN, VAE]},
];
const ROLE_ARG = {diffusion: '--diffusion-model', llm: '--llm', vae: '--vae'};
// Sizes for each shape; "fast" is about 0.75× (multiples of 64).
const SHAPES = {square: [1024, 1024], landscape: [1216, 832], portrait: [832, 1216]};
const FAST = {square: [768, 768], landscape: [896, 640], portrait: [640, 896]};
const CHAT = /^[a-fA-F0-9]{32}$/, SHA = /^[a-f0-9]{64}$/;

function imgError(code, message) { return Object.assign(Error(message), {code}); }
const wait = ms => new Promise(r => setTimeout(r, ms));
const localName = f => 'img-' + f.sha.slice(0, 12) + '-' + path.basename(f.file);
function pngSize(buf) { return buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 ? {width: buf.readUInt32BE(16), height: buf.readUInt32BE(20)} : null; }
function freePort() { return new Promise((resolve, reject) => { const s = net.createServer(); s.unref(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const {port} = s.address(); s.close(() => resolve(port)); }); }); }

function createImageGen({dataDir, nativeImage, downloader, cloud, connections, emit = () => {}, log = () => {}, releaseChatModel = async () => {}, fetchImpl = fetch}) {
  const runtimeDir = path.join(dataDir, 'image-runtime'), modelsDir = path.join(dataDir, 'models'), outDir = path.join(dataDir, 'generated');
  const settingsFile = path.join(dataDir, 'image-settings.json'), linkFile = path.join(dataDir, 'conversation-generated.json');
  let settings = null, links = null, install = null, server = null, idleTimer = null, flight = null;

  // ---------- settings ----------
  function cleanSettings(s = {}) {
    const cloudModels = {};
    for (const [p, list] of Object.entries(s.cloudModels || {})) if (connections.PROVIDERS[p] && Array.isArray(list)) cloudModels[p] = [...new Set(list.filter(x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:\/@+-]{0,127}$/.test(x)))].slice(0, 12);
    return {engine: ENGINES[s.engine] ? s.engine : null, model: typeof s.model === 'string' && s.model.length <= 200 ? s.model : 'local:z-image-turbo',
      shape: SHAPES[s.shape] ? s.shape : 'square', fast: s.fast === true, steps: Number.isInteger(s.steps) && s.steps >= 1 && s.steps <= 50 ? s.steps : null,
      tool: s.tool === true, toolAsk: s.toolAsk !== false, cloudModels};
  }
  function readSettings() { if (settings) return settings; try { settings = cleanSettings(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))); } catch { settings = cleanSettings(); } return settings; }
  function writeSettings(next) { settings = cleanSettings(next); fs.mkdirSync(dataDir, {recursive: true}); const t = settingsFile + '.tmp'; fs.writeFileSync(t, JSON.stringify(settings, null, 1)); fs.renameSync(t, settingsFile); return settings; }

  // ---------- engine ----------
  const engineDir = kind => path.join(runtimeDir, TAG, kind);
  const engineExe = kind => path.join(engineDir(kind), 'sd-server.exe');
  const installed = kind => fs.existsSync(engineExe(kind)) && fs.existsSync(path.join(engineDir(kind), 'ready.json'));
  function unzip(file, dir) {
    return new Promise((resolve, reject) => execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', file, '-C', dir], {windowsHide: true, timeout: 600000}, e => e ? reject(imgError('unpack', 'The image engine archive could not be unpacked.')) : resolve()));
  }
  function run(exe, args, ms = 60000) {
    return new Promise(resolve => {
      const child = spawn(exe, args, {cwd: path.dirname(exe), windowsHide: true}); let output = '';
      child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
      const timer = setTimeout(() => child.kill(), ms);
      child.on('error', () => { clearTimeout(timer); resolve({code: -1, output}); });
      child.on('close', code => { clearTimeout(timer); resolve({code, output: output.slice(-6000)}); });
    });
  }
  async function downloadFile(item, file, signal, onBytes) {
    for (let attempt = 1; ; attempt++) {
      try {
        const partial = file + '.partial'; let start = fs.existsSync(partial) ? fs.statSync(partial).size : 0; if (start > item.size) { fs.rmSync(partial); start = 0; }
        if (start < item.size) {
          const response = await fetchImpl(RELEASE + item.name, {headers: start ? {range: `bytes=${start}-`} : {}, signal});
          if (response.status === 200) start = 0; else if (response.status !== 206) throw imgError('network', 'The download returned ' + response.status + '.');
          const out = fs.createWriteStream(partial, {flags: start ? 'a' : 'w'}); let got = start;
          try { for await (const chunk of response.body) { got += chunk.length; if (got > item.size) throw imgError('invalid', 'The download is larger than expected.'); if (!out.write(chunk)) await new Promise(r => out.once('drain', r)); onBytes(got); } }
          finally { await new Promise(r => out.end(r)); }
          if (got !== item.size) throw imgError('network', 'The download ended early.');
        }
        const h = crypto.createHash('sha256'); await new Promise((res, rej) => fs.createReadStream(partial).on('data', d => h.update(d)).on('end', res).on('error', rej));
        if (h.digest('hex') !== item.sha256) { fs.rmSync(partial, {force: true}); throw imgError('verify', 'The image engine download did not match the published checksum and was removed.'); }
        await fsp.rename(partial, file); return file;
      } catch (error) { if (signal.aborted || attempt >= 3 || !['network'].includes(error.code) && !/fetch failed|terminated|ECONNRESET/i.test(error.message)) throw error; log('[images] download retry ' + attempt + ': ' + error.message); await wait(2000 * attempt); }
    }
  }
  async function installEngine(kind) {
    if (!ENGINES[kind]) throw imgError('invalid', 'Unknown image engine.');
    if (install) throw imgError('busy', 'The image engine is already being installed.');
    if (installed(kind)) { writeSettings({...readSettings(), engine: kind}); return status(); }
    const controller = new AbortController(), files = ENGINES[kind].files, total = files.reduce((n, f) => n + f.size, 0);
    install = {kind, controller, bytes: 0, total, phase: 'downloading'};
    const publish = () => emit({type: 'install', kind, phase: install?.phase, bytes: install?.bytes || 0, total});
    try {
      const downloads = path.join(runtimeDir, 'downloads'); fs.mkdirSync(downloads, {recursive: true});
      let base = 0, last = 0;
      for (const item of files) {
        await downloadFile(item, path.join(downloads, item.name), controller.signal, got => { install.bytes = base + got; if (Date.now() - last > 250) { last = Date.now(); publish(); } });
        base += item.size;
      }
      install.phase = 'checking'; publish();
      const staging = engineDir(kind) + '.staging'; await fsp.rm(staging, {recursive: true, force: true}); fs.mkdirSync(staging, {recursive: true});
      for (const item of files) await unzip(path.join(downloads, item.name), staging);
      const exe = path.join(staging, 'sd-server.exe'); if (!fs.existsSync(exe)) throw imgError('invalid', 'sd-server.exe is missing from the image engine archive.');
      const probe = await run(exe, ['--list-devices']);
      const devices = probe.output.split(/\r?\n/).filter(l => /^\S+\t/.test(l)).map(l => l.split('\t')[0]);
      if (probe.code !== 0) throw imgError('probe', 'The image engine did not start on this computer.');
      if (kind !== 'cpu' && !devices.some(d => /^(Vulkan|CUDA)\d/i.test(d))) throw imgError('probe', ENGINES[kind].label + ' found no usable GPU on this computer. Choose another engine.');
      fs.writeFileSync(path.join(staging, 'ready.json'), JSON.stringify({tag: TAG, kind, devices, installed: new Date().toISOString()}));
      await stopServer(); await fsp.rm(engineDir(kind), {recursive: true, force: true}); await fsp.rename(staging, engineDir(kind));
      for (const item of files) await fsp.rm(path.join(downloads, item.name), {force: true});
      writeSettings({...readSettings(), engine: kind}); log('[images] engine installed: ' + kind + ' (' + devices.join(', ') + ')');
      install.phase = 'done'; publish(); return status();
    } catch (error) {
      if (install) install.phase = controller.signal.aborted ? 'cancelled' : 'failed'; emit({type: 'install', kind, phase: install?.phase, error: controller.signal.aborted ? null : error.message});
      if (controller.signal.aborted) throw imgError('cancelled', 'Cancelled'); throw error;
    } finally { install = null; }
  }
  async function removeEngine(kind) { if (!ENGINES[kind]) throw imgError('invalid', 'Unknown image engine.'); await stopServer(); await fsp.rm(engineDir(kind), {recursive: true, force: true}); const s = readSettings(); if (s.engine === kind) writeSettings({...s, engine: Object.keys(ENGINES).find(installed) || null}); return status(); }

  // ---------- model packages ----------
  const fileReady = f => { try { return fs.statSync(path.join(modelsDir, localName(f))).size === f.bytes; } catch { return false; } };
  const packageReady = p => p.files.every(fileReady);
  const job = (p, f) => ({Name: p.name + ' · ' + f.role, Repo: f.repo, File: f.file, Sha: f.sha, Bytes: f.bytes, LocalFile: localName(f)});
  let packageRun = null;
  async function downloadPackage(id) {
    const p = PACKAGES.find(x => x.id === id); if (!p) throw imgError('invalid', 'Unknown image model.');
    if (packageRun) throw imgError('busy', 'An image model is already downloading.');
    packageRun = id;
    try { for (const f of p.files) if (!fileReady(f)) await downloader.start(job(p, f)); return status(); }
    finally { packageRun = null; }
  }
  async function removePackage(id) {
    const p = PACKAGES.find(x => x.id === id); if (!p) throw imgError('invalid', 'Unknown image model.');
    await stopServer();
    const keep = new Set(PACKAGES.filter(x => x.id !== id && packageReady(x)).flatMap(x => x.files.map(f => f.sha)));
    for (const f of p.files) if (!keep.has(f.sha)) await fsp.rm(path.join(modelsDir, localName(f)), {force: true});
    return status();
  }

  // ---------- local server ----------
  async function stopServer() {
    clearTimeout(idleTimer); idleTimer = null; const s = server; server = null; if (!s) return;
    try { s.proc.kill(); } catch {}
    await Promise.race([new Promise(r => s.proc.once('exit', r)), wait(5000)]);
    log('[images] engine stopped');
  }
  function armIdle() { clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (!flight) stopServer(); }, 180000); }
  async function ensureServer(p, kind, onPhase) {
    const key = p.id + '|' + kind;
    if (server && server.key === key && server.proc.exitCode === null) return server;
    await stopServer(); onPhase('loading');
    await releaseChatModel(); // the chat model and the image model would compete for GPU memory
    const port = await freePort(), exe = engineExe(kind);
    const args = ['--listen-ip', '127.0.0.1', '--listen-port', String(port), '--diffusion-fa', '--log-level', 'warn'];
    for (const f of p.files) args.push(ROLE_ARG[f.role], path.join(modelsDir, localName(f)));
    const proc = spawn(exe, args, {cwd: path.dirname(exe), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    let tail = ''; const keep = d => { tail = (tail + d).slice(-4000); }; proc.stdout.on('data', keep); proc.stderr.on('data', keep);
    const s = {proc, port, key, base: 'http://127.0.0.1:' + port, tail: () => tail}; server = s;
    proc.on('exit', code => { if (code && code !== 0) log('[images] engine exited ' + code + ': ' + tail.slice(-600).replace(/\s+/g, ' ')); if (server === s) server = null; });
    const deadline = Date.now() + 600000;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) throw imgError('start', 'The image engine stopped while loading the model. ' + (tail.match(/(error|failed)[^\n]*/i)?.[0] || '').slice(0, 200));
      try { const r = await fetchImpl(s.base + '/sdcpp/v1/capabilities', {signal: AbortSignal.timeout(2000)}); if (r.ok) { await r.arrayBuffer(); return s; } } catch {}
      await wait(500);
    }
    await stopServer(); throw imgError('start', 'The image engine took too long to load the model.');
  }

  // ---------- generation ----------
  function sizeFor(shape, fast) { return (fast ? FAST : SHAPES)[SHAPES[shape] ? shape : 'square']; }
  async function saveImage(buffer) {
    const size = pngSize(buffer); if (!size) throw imgError('invalid', 'The engine returned something that is not a PNG image.');
    const sha = crypto.createHash('sha256').update(buffer).digest('hex'); fs.mkdirSync(outDir, {recursive: true});
    const file = path.join(outDir, sha + '.png'); if (!fs.existsSync(file)) fs.writeFileSync(file, buffer);
    const thumb = path.join(outDir, sha + '.thumb.png');
    if (!fs.existsSync(thumb)) { try { const img = nativeImage.createFromBuffer(buffer); const w = Math.min(512, size.width); fs.writeFileSync(thumb, img.resize({width: w, quality: 'good'}).toPNG()); } catch {} }
    return {sha, ...size};
  }
  function toPng(buffer) { if (pngSize(buffer)) return buffer; const img = nativeImage.createFromBuffer(buffer); if (img.isEmpty()) throw imgError('invalid', 'The image could not be read.'); return img.toPNG(); }
  async function localGenerate(p, options, onProgress, signal) {
    const s = readSettings(), kind = s.engine && installed(s.engine) ? s.engine : Object.keys(ENGINES).find(installed);
    if (!kind) throw imgError('setup', 'Install the image engine in Settings → Images first.');
    if (!packageReady(p)) throw imgError('setup', 'Download ' + p.name + ' in Settings → Images first.');
    const srv = await ensureServer(p, kind, phase => onProgress({phase}));
    clearTimeout(idleTimer);
    const [width, height] = sizeFor(options.shape, options.fast);
    const body = {prompt: options.prompt, negative_prompt: options.negative || '', width, height, seed: Number.isInteger(options.seed) ? options.seed : -1, batch_count: options.count,
      sample_params: {sample_steps: options.steps || p.steps, guidance: {txt_cfg: p.cfg}}, preview: 'proj', preview_interval: 1, output_format: 'png', embed_image_metadata: false};
    const submit = await fetchImpl(srv.base + '/sdcpp/v1/img_gen', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
    if (submit.status !== 202 && !submit.ok) throw imgError('engine', 'The image engine refused the request (' + submit.status + '): ' + (await submit.text()).slice(0, 200));
    const jobId = (await submit.json()).id; let lastPreview = 0;
    onProgress({phase: 'generating', step: 0, total: body.sample_params.sample_steps * options.count});
    for (;;) {
      if (signal.aborted) { await fetchImpl(srv.base + '/sdcpp/v1/jobs/' + encodeURIComponent(jobId) + '/cancel', {method: 'POST'}).catch(() => {}); throw Object.assign(Error('Cancelled'), {cancelled: true}); }
      await wait(400);
      // A busy engine can be slow to answer; a few failed polls in a row are tolerated before giving up.
      let r = null;
      for (let attempt = 1; !r; attempt++) {
        try { r = await fetchImpl(srv.base + '/sdcpp/v1/jobs/' + encodeURIComponent(jobId), {signal: AbortSignal.timeout(30000)}); }
        catch (error) { if (srv.proc.exitCode !== null) throw imgError('engine', 'The image engine stopped while making the picture.'); if (attempt >= 5) throw imgError('engine', 'The image engine stopped answering: ' + error.message); log('[images] poll retry ' + attempt + ': ' + error.message); await wait(1000 * attempt); }
      }
      if (!r.ok) throw imgError('engine', 'The image engine lost the job (' + r.status + ').');
      const j = await r.json();
      if (j.status === 'completed') return (j.result?.images || []).map(x => Buffer.from(x.b64_json, 'base64'));
      if (j.status === 'failed' || j.status === 'cancelled') throw j.status === 'cancelled' ? Object.assign(Error('Cancelled'), {cancelled: true}) : imgError('engine', 'Image generation failed: ' + (j.error?.message || 'unknown error'));
      if (j.preview) {
        const step = (j.preview.pass - 1) * j.preview.total_steps + j.preview.step, total = j.preview.total_steps * options.count, now = Date.now();
        const sendPreview = j.preview.b64_json && now - lastPreview > 700; if (sendPreview) lastPreview = now;
        onProgress({phase: 'generating', step, total, ...(sendPreview ? {preview: 'data:image/png;base64,' + j.preview.b64_json} : {})});
      }
    }
  }
  // Generates images for a prompt; returns saved PNGs with what was used.
  async function generate(options, {onProgress = () => {}, signal} = {}) {
    if (flight) throw imgError('busy', 'An image is already being made.');
    const prompt = String(options.prompt || '').trim(); if (!prompt || prompt.length > 4000) throw imgError('invalid', 'Describe the image in 1–4,000 characters.');
    const s = readSettings(), model = String(options.model || s.model), count = Math.min(4, Math.max(1, Number(options.count) || 1));
    const opts = {prompt, negative: String(options.negative || '').slice(0, 2000), shape: SHAPES[options.shape] ? options.shape : s.shape, fast: typeof options.fast === 'boolean' ? options.fast : s.fast,
      steps: Number.isInteger(options.steps) && options.steps >= 1 && options.steps <= 50 ? options.steps : s.steps, seed: Number.isInteger(options.seed) && options.seed >= 0 ? options.seed : null, count};
    const controller = new AbortController(); flight = controller; const started = Date.now();
    const any = AbortSignal.any([controller.signal, signal || new AbortController().signal]);
    try {
      let buffers, label, engine;
      if (model.startsWith('local:')) {
        const p = PACKAGES.find(x => x.id === model.slice(6)); if (!p) throw imgError('invalid', 'Unknown image model.');
        buffers = await localGenerate(p, opts, onProgress, any); label = p.name + ' · ' + p.variant; engine = 'local';
      } else if (model.startsWith('cloud:')) {
        const m = /^cloud:([a-z]+)\/(.+)$/.exec(model); if (!m) throw imgError('invalid', 'Unknown image model.');
        if (!connections.public().cloud.enabled) throw imgError('setup', 'Cloud models are turned off. Turn them on in Settings → Cloud models.');
        onProgress({phase: 'cloud', provider: connections.providerLabel(m[1])});
        buffers = await cloud.generateImage({provider: m[1], model: m[2], prompt: opts.prompt, shape: opts.shape, count, signal: any});
        label = m[2] + ' · ' + connections.providerLabel(m[1]); engine = 'cloud';
      } else throw imgError('invalid', 'Choose an image model.');
      if (!buffers.length) throw imgError('engine', 'No image was returned.');
      const images = []; for (const b of buffers) images.push(await saveImage(toPng(b)));
      return {images, model, label, engine, prompt: opts.prompt, negative: opts.negative, shape: opts.shape, fast: opts.fast, steps: engine === 'local' ? (opts.steps || PACKAGES.find(x => 'local:' + x.id === model).steps) : null, seed: opts.seed, seconds: Math.round((Date.now() - started) / 100) / 10};
    } catch (error) { if (!error.cancelled) log('[images] generation failed (' + model + '): ' + error.message + (server ? ' | engine: ' + server.tail().slice(-500).replace(/\s+/g, ' ') : '')); throw error; }
    finally { flight = null; if (server) armIdle(); }
  }
  function cancel() { flight?.abort(); install?.controller.abort(); return true; }

  // ---------- conversation links ----------
  function loadLinks() { if (links) return links; try { links = JSON.parse(fs.readFileSync(linkFile, 'utf8')); if (!links || typeof links !== 'object' || Array.isArray(links)) links = {}; } catch { links = {}; } return links; }
  function saveLinks() { const t = linkFile + '.tmp'; fs.writeFileSync(t, JSON.stringify(links)); fs.renameSync(t, linkFile); }
  function cleanEntry(e) {
    return {images: (e.images || []).filter(x => SHA.test(x.sha || '')).slice(0, 4).map(x => ({sha: x.sha, width: Number(x.width) || 0, height: Number(x.height) || 0})),
      prompt: String(e.prompt || '').slice(0, 4000), negative: String(e.negative || '').slice(0, 2000), model: String(e.model || '').slice(0, 200), label: String(e.label || '').slice(0, 200),
      engine: e.engine === 'cloud' ? 'cloud' : 'local', shape: SHAPES[e.shape] ? e.shape : 'square', steps: Number.isInteger(e.steps) ? e.steps : null, seed: Number.isInteger(e.seed) ? e.seed : null, seconds: Number(e.seconds) || 0, tool: e.tool === true};
  }
  function referenced() { const set = new Set(); for (const chat of Object.values(loadLinks())) for (const e of Object.values(chat)) for (const x of e.images || []) set.add(x.sha); return set; }
  async function sweep(candidates) { const used = referenced(); for (const sha of candidates) if (!used.has(sha)) { await fsp.rm(path.join(outDir, sha + '.png'), {force: true}); await fsp.rm(path.join(outDir, sha + '.thumb.png'), {force: true}); } }

  function status() {
    const s = readSettings();
    return {
      settings: s, tag: TAG, install: install ? {kind: install.kind, phase: install.phase, bytes: install.bytes, total: install.total} : null, busy: !!flight, running: !!server,
      engines: Object.entries(ENGINES).map(([id, e]) => ({id, label: e.label, size: e.files.reduce((n, f) => n + f.size, 0), installed: installed(id)})),
      packages: PACKAGES.map(p => ({id: p.id, name: p.name, variant: p.variant, license: p.license, by: p.by, steps: p.steps, size: p.files.reduce((n, f) => n + f.bytes, 0), peak: Math.max(...p.files.map(f => f.bytes)),
        missing: p.files.filter(f => !fileReady(f)).reduce((n, f) => n + f.bytes, 0), ready: packageReady(p), downloading: packageRun === p.id})),
      cloudModels: s.cloudModels,
    };
  }
  return {
    status, readSettings, setSettings: patch => { writeSettings({...readSettings(), ...patch}); return status(); },
    installEngine, removeEngine, downloadPackage, removePackage, generate, cancel, stop: stopServer, busy: () => !!flight,
    // Frees the GPU for chat: stops the image engine unless it is working.
    release: async () => { if (!flight) await stopServer(); },
    file(sha, thumb) { if (!SHA.test(sha)) throw imgError('invalid', 'Invalid image.'); const f = path.join(outDir, sha + (thumb ? '.thumb.png' : '.png')); return thumb && !fs.existsSync(f) ? path.join(outDir, sha + '.png') : f; },
    record(chatId, index, entry) { if (!CHAT.test(chatId) || !Number.isInteger(index) || index < 0 || index > 4000) throw imgError('invalid', 'Invalid image record.'); const all = loadLinks(); all[chatId] = {...(all[chatId] || {}), [index]: cleanEntry(entry)}; saveLinks(); return all[chatId][index]; },
    decorate(chat) { if (!chat?.Id || !Array.isArray(chat.Messages)) return chat; const e = loadLinks()[chat.Id]; if (!e) return chat; return {...chat, Messages: chat.Messages.map((m, i) => e[i] && m.Role === 'assistant' ? {...m, Generated: e[i]} : m)}; },
    branch(from, to, count) { const all = loadLinks(); if (!all[from]) return; const copy = {}; for (const [i, v] of Object.entries(all[from])) if (Number(i) < count) copy[i] = v; if (Object.keys(copy).length) { all[to] = copy; saveLinks(); } },
    async forget(chatId) { const all = loadLinks(); if (!all[chatId]) return; const shas = Object.values(all[chatId]).flatMap(e => (e.images || []).map(x => x.sha)); delete all[chatId]; saveLinks(); await sweep(shas); },
    async removeAt(chatId, index) { const all = loadLinks(); if (!all[chatId]?.[index]) return; const shas = all[chatId][index].images.map(x => x.sha); delete all[chatId][index]; saveLinks(); await sweep(shas); },
    PACKAGES, ENGINES, SHAPES, TAG, localName,
  };
}

module.exports = {createImageGen, PACKAGES, ENGINES, SHAPES, FAST, pngSize};
