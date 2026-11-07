// createUpdater mode: 'check-only' (Tauri preview) may check but never download or install; 'full' is unchanged.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createUpdater } = require('../../app/updates.cjs');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pub = publicKey.export({ type: 'spki', format: 'pem' });
const zip = Buffer.from('PK-fake-zip-payload');
let server, base, root;

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-upd-'));
  const sha = h => crypto.createHash('sha256').update(h).digest('hex');
  server = http.createServer((req, res) => {
    const url = new URL(req.url, base);
    const manifest = Buffer.from(JSON.stringify({
      product: 'lumen.cpp', channel: 'beta', build: 99, version: '9.9.9-beta', published: '2026-11-01',
      notes: { en: 'New things.', tr: 'Yeni şeyler.' },
      assets: { zip: { name: 'lumen-beta-portable.zip', size: zip.length, sha256: sha(zip) }, setup: { name: 'lumen-beta-setup.exe', size: 10, sha256: sha('x') } }
    }));
    if (url.pathname === '/repos/olves/lumen.cpp/releases') {
      const a = (name, size) => ({ name, size, browser_download_url: base + '/dl/' + name });
      return res.end(JSON.stringify([{ tag_name: 'v9.9.9-beta', draft: false, assets: [a('lumen-update.json', manifest.length), a('lumen-update.json.sig', 90), a('lumen-beta-portable.zip', zip.length), a('lumen-beta-setup.exe', 10)] }]));
    }
    if (url.pathname === '/dl/lumen-update.json') return res.end(manifest);
    if (url.pathname === '/dl/lumen-update.json.sig') return res.end(crypto.sign(null, manifest, privateKey).toString('base64'));
    if (url.pathname === '/dl/lumen-beta-portable.zip') { hits.zip++; return res.end(zip); }
    res.statusCode = 404; res.end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });
const hits = { zip: 0 };

function make(mode, name) {
  const dataDir = path.join(root, name), appDir = path.join(root, name + '-app');
  fs.mkdirSync(appDir, { recursive: true });
  return createUpdater({ dataDir, appDir, version: '1.0.0-beta', build: 1, test: true, apiBase: base, publicKey: pub, mode });
}

test('check works in check-only', async () => {
  const u = make('check-only', 'a');
  const s = await u.check({ manual: true });
  assert.equal(s.mode, 'check-only');
  assert.equal(s.available.version, '9.9.9-beta');
  assert.equal(s.available.notes.tr, 'Yeni şeyler.');
  assert.equal(u.status().mode, 'check-only');
});

test('download rejected in check-only', async () => {
  const u = make('check-only', 'b');
  await u.check({ manual: true });
  await assert.rejects(u.download(), /This preview build cannot install updates\./);
  assert.equal(hits.zip, 0);
  assert.equal(u.status().download, null);
});

test('install rejected in check-only', async () => {
  const u = make('check-only', 'c');
  await u.check({ manual: true });
  let quit = false;
  await assert.rejects(u.install({ quit: () => { quit = true; } }), /This preview build cannot install updates\./);
  assert.equal(quit, false);
});

test('full mode unchanged', async () => {
  const u = make('full', 'd');
  const s = await u.check({ manual: true });
  assert.equal(s.mode, 'portable');
  await u.download();
  for (let i = 0; i < 100 && u.status().download?.phase !== 'ready'; i++) await new Promise(r => setTimeout(r, 50));
  assert.equal(u.status().download?.phase, 'ready');
  assert.equal(hits.zip, 1);
});
