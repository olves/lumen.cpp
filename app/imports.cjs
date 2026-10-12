'use strict';
// Models already on this computer (LM Studio, the Hugging Face cache, Ollama, GPT4All, Jan, llama.cpp's cache, or a folder the
// user picks) become Lumen models without downloading them again. Only reads those folders; nothing there is changed.
// A model is added as a hard link in <data>/models: same drive, no extra disk space, and removing it in either app leaves the
// other one working. Another drive needs a copy, which is only made when the user confirms it.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const {readGguf} = require('./gguf.cjs');

const MIN_BYTES = 50 * 1024 * 1024, MAX_FILES = 3000, MAX_DEPTH = 6;
const SPLIT = /-\d{5}-of-\d{5}\.gguf$/i, SHA = /^[a-f0-9]{64}$/, REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const safe = s => String(s || '').replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80) || 'model';

function createImports({dataDir, home, localAppData, appData, env = process.env, register, models, log = () => {}}) {
  const modelsDir = path.join(dataDir, 'models');
  // Where other apps keep GGUF files on Windows. Each entry: source label and how to read it.
  function roots() {
    const list = [];
    const add = (source, dir, kind) => { if (dir && !list.some(r => r.dir.toLowerCase() === path.resolve(dir).toLowerCase())) list.push({source, dir: path.resolve(dir), kind}); };
    add('LM Studio', path.join(home, '.lmstudio', 'models'), 'tree');
    add('LM Studio', path.join(home, '.cache', 'lm-studio', 'models'), 'tree');
    if (env.HF_HUB_CACHE) add('Hugging Face', env.HF_HUB_CACHE, 'hf');
    if (env.HF_HOME) add('Hugging Face', path.join(env.HF_HOME, 'hub'), 'hf');
    add('Hugging Face', path.join(home, '.cache', 'huggingface', 'hub'), 'hf');
    if (env.OLLAMA_MODELS) add('Ollama', env.OLLAMA_MODELS, 'ollama');
    add('Ollama', path.join(home, '.ollama', 'models'), 'ollama');
    add('GPT4All', path.join(localAppData, 'nomic.ai', 'GPT4All'), 'tree');
    add('Jan', path.join(home, 'jan', 'models'), 'tree');
    add('Jan', path.join(appData, 'Jan', 'data', 'models'), 'tree');
    add('llama.cpp', path.join(localAppData, 'llama.cpp'), 'tree');
    return list;
  }

  // GGUF files under a folder, depth- and count-limited; symlinked folders are not followed (files may be symlinks).
  async function walk(dir, depth = 0, out = [], seen = {n: 0}) {
    if (depth > MAX_DEPTH || seen.n > MAX_FILES) return out;
    let entries; try { entries = await fs.promises.readdir(dir, {withFileTypes: true}); } catch { return out; }
    for (const e of entries) {
      if (++seen.n > MAX_FILES) break;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('.')) await walk(full, depth + 1, out, seen); }
      else if ((e.isFile() || e.isSymbolicLink()) && /\.gguf$/i.test(e.name)) out.push(full);
    }
    return out;
  }

  // Header check and the model's own name; vision projectors and split files are not chat models Lumen can load alone.
  async function inspect(file) {
    const real = await fs.promises.realpath(file), stat = await fs.promises.stat(real);
    if (!stat.isFile() || stat.size < MIN_BYTES) return null;
    const handle = await fs.promises.open(real, 'r'); const magic = Buffer.alloc(4);
    try { await handle.read(magic, 0, 4, 0); } finally { await handle.close(); }
    if (magic.toString('latin1') !== 'GGUF') return null;
    let meta = {};
    try { meta = (await readGguf(real, {keep: k => /^general\.(name|basename|size_label|type|architecture)$/.test(k)})).meta; } catch {}
    if (meta['general.type'] === 'mmproj' || /mmproj/i.test(path.basename(file))) return {skip: 'vision'};
    return {real, size: stat.size, mtime: stat.mtimeMs, name: [meta['general.basename'] || meta['general.name'], meta['general.size_label']].filter(Boolean).join(' ') || null, architecture: meta['general.architecture'] || null};
  }

  function candidate(source, file, info, {repo, fileName, sha}) {
    const id = crypto.createHash('sha1').update(info.real.toLowerCase()).digest('hex').slice(0, 16);
    return {id, source, path: file, real: info.real, size: info.size, repo: REPO.test(repo || '') ? repo : 'local/' + safe(path.basename(path.dirname(file))),
      file: fileName || path.basename(file), sha: SHA.test(sha || '') ? sha : null, name: info.name, architecture: info.architecture,
      sameDrive: path.parse(info.real).root.toLowerCase() === path.parse(path.resolve(modelsDir)).root.toLowerCase()};
  }

  async function scanRoot(root) {
    const found = [], skipped = [];
    if (root.kind === 'ollama') {
      // manifests/<registry>/<namespace>/<model>/<tag>: the "model" layer is the GGUF blob, named by its SHA-256.
      const manifests = path.join(root.dir, 'manifests');
      const stack = [[manifests, []]], manifestFiles = [];
      while (stack.length && manifestFiles.length < 500) {
        const [dir, parts] = stack.pop(); let entries; try { entries = await fs.promises.readdir(dir, {withFileTypes: true}); } catch { continue; }
        for (const e of entries) { if (e.isDirectory()) { if (parts.length < 4) stack.push([path.join(dir, e.name), [...parts, e.name]]); } else if (e.isFile()) manifestFiles.push([path.join(dir, e.name), [...parts, e.name]]); }
      }
      const out = [];
      for (const [file, parts] of manifestFiles) {
        try {
          const manifest = JSON.parse(await fs.promises.readFile(file, 'utf8'));
          const layer = (manifest.layers || []).find(l => l.mediaType === 'application/vnd.ollama.image.model');
          const digest = String(layer?.digest || '').replace(/^sha256:/, ''); if (!SHA.test(digest)) continue;
          const blob = path.join(root.dir, 'blobs', 'sha256-' + digest), info = await inspect(blob).catch(() => null); if (!info || info.skip) continue;
          const [, namespace = 'library', model = 'model', tag = 'latest'] = parts.length >= 4 ? parts.slice(-4) : ['', ...parts];
          out.push(candidate(root.source, blob, info, {repo: 'ollama/' + safe(namespace === 'library' ? model : namespace + '-' + model), fileName: safe(model + '-' + tag) + '.gguf', sha: digest}));
        } catch {}
      }
      return {found: out, skipped};
    }
    const files = await walk(root.dir);
    const out = [];
    for (const file of files) {
      if (SPLIT.test(file)) { skipped.push({path: file, reason: 'split'}); continue; }
      const info = await inspect(file).catch(() => null);
      if (!info) continue; if (info.skip) { skipped.push({path: file, reason: info.skip}); continue; }
      const rel = path.relative(root.dir, file).split(path.sep);
      let repo = null, sha = null;
      if (root.kind === 'hf') {
        // models--owner--repo/snapshots/<revision>/<file>; the blob behind a snapshot link is named by its SHA-256.
        const m = /^models--([^-][^]*?)--(.+)$/.exec(rel[0] || ''); if (m) repo = m[1] + '/' + m[2];
        const blob = path.basename(info.real); if (SHA.test(blob)) sha = blob;
      } else if (rel.length >= 3) repo = rel[rel.length - 3] + '/' + rel[rel.length - 2];
      out.push(candidate(root.source, file, info, {repo, sha}));
    }
    return {found: out, skipped};
  }

  // Everything found, minus files Lumen already has (same path behind a link, or the same size and checksum).
  async function scan({folders = []} = {}) {
    const list = [...roots(), ...folders.map(dir => ({source: 'Folder', dir: path.resolve(dir), kind: 'tree'}))];
    const installed = (await models()).filter(m => m.Installed);
    const have = new Set();
    for (const m of installed) { try { have.add((await fs.promises.realpath(path.join(modelsDir, m.LocalFile || m.File))).toLowerCase()); } catch {} }
    const results = [], skipped = [], seen = new Set();
    for (const root of list) {
      if (!fs.existsSync(root.dir)) continue;
      const r = await scanRoot(root); skipped.push(...r.skipped);
      for (const c of r.found) {
        if (seen.has(c.real.toLowerCase())) continue; seen.add(c.real.toLowerCase());
        const same = installed.find(m => m.Bytes === c.size && (c.sha ? m.Sha === c.sha : false));
        let linked = false; try { linked = have.has(c.real.toLowerCase()) || [...have].some(h => fs.statSync(h).ino === fs.statSync(c.real).ino && fs.statSync(h).dev === fs.statSync(c.real).dev); } catch {}
        results.push({...c, status: linked || same ? 'installed' : 'new'});
      }
    }
    return {roots: list.map(r => ({source: r.source, dir: r.dir, exists: fs.existsSync(r.dir)})), models: results, skipped};
  }

  function hashFile(file, size, onProgress, signal) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256'), stream = fs.createReadStream(file, {highWaterMark: 4 * 1024 * 1024});let done = 0, last = 0;
      const abort = () => { stream.destroy(); reject(Object.assign(Error('Cancelled'), {cancelled: true})); };
      if (signal) { if (signal.aborted) return abort(); signal.addEventListener('abort', abort, {once: true}); }
      stream.on('data', chunk => { hash.update(chunk); done += chunk.length; const now = Date.now(); if (now - last > 250) { last = now; onProgress?.(done / size); } });
      stream.on('error', reject); stream.on('end', () => { signal?.removeEventListener('abort', abort); resolve(hash.digest('hex')); });
    });
  }

  // Adds the chosen models. Files on another drive are copied only when allowCopy is true.
  async function importModels(items, {allowCopy = false, onProgress, signal} = {}) {
    fs.mkdirSync(modelsDir, {recursive: true});
    const catalog = await models(), results = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i], report = (phase, value) => onProgress?.({index: i, count: items.length, id: item.id, phase, value});
      try {
        const stat = await fs.promises.stat(item.real);
        if (stat.size !== item.size) throw Error('The file changed since the scan. Scan again.');
        if (!item.sameDrive && !allowCopy) { results.push({id: item.id, status: 'needs-copy', size: item.size}); continue; }
        let sha = item.sha;
        if (!sha) { report('checking', 0); sha = await hashFile(item.real, item.size, v => report('checking', v), signal); }
        const known = catalog.find(m => m.Sha === sha);
        const file = known ? known.File : safe(path.basename(item.file, path.extname(item.file))) + '.gguf';
        const localFile = known?.LocalFile || sha.slice(0, 12) + '-' + path.basename(file);
        const target = path.join(modelsDir, localFile);
        let how = 'existing';
        if (!(fs.existsSync(target) && fs.statSync(target).size === item.size)) {
          try { fs.rmSync(target, {force: true}); fs.linkSync(item.real, target); how = 'linked'; }
          catch (e) {
            if (!allowCopy) { results.push({id: item.id, status: 'needs-copy', size: item.size}); continue; }
            report('copying', 0); await copyFile(item.real, target + '.partial', item.size, v => report('copying', v), signal); fs.renameSync(target + '.partial', target); how = 'copied';
          }
        }
        if (!known) await register({Name: item.repo + ' / ' + file, Repo: item.repo, File: file, Sha: sha, Bytes: item.size});
        log(`[import] ${item.source}: ${item.real} -> ${localFile} (${how})`);
        results.push({id: item.id, status: how, sha, localFile});
      } catch (e) {
        if (e.cancelled) { results.push({id: item.id, status: 'cancelled'}); break; }
        results.push({id: item.id, status: 'failed', error: e.message});
      }
    }
    return results;
  }

  function copyFile(from, to, size, onProgress, signal) {
    return new Promise((resolve, reject) => {
      const input = fs.createReadStream(from, {highWaterMark: 8 * 1024 * 1024}), output = fs.createWriteStream(to);let done = 0, last = 0;
      const fail = e => { input.destroy(); output.destroy(); fs.rm(to, {force: true}, () => reject(e)); };
      const abort = () => fail(Object.assign(Error('Cancelled'), {cancelled: true}));
      if (signal) { if (signal.aborted) return abort(); signal.addEventListener('abort', abort, {once: true}); }
      input.on('data', c => { done += c.length; const now = Date.now(); if (now - last > 250) { last = now; onProgress?.(done / size); } });
      input.on('error', fail); output.on('error', fail); output.on('finish', () => { signal?.removeEventListener('abort', abort); resolve(); });
      input.pipe(output);
    });
  }

  return {roots, scan, importModels};
}

module.exports = {createImports};
