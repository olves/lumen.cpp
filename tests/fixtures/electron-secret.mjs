// Electron safeStorage reference for the Tauri shell's secrets (spec §7): runs Electron's own safeStorage (Chromium os_crypt,
// DPAPI-protected key in <userData>/Local State) in a tiny app made of hard links to work/electron-dev (no extra disk space).
// safeStorage needs a real app context, so this is not ELECTRON_RUN_AS_NODE. The user's %APPDATA%\lumen.cpp is never used.
//   node tests/fixtures/electron-secret.mjs                         writes <work>/secret-fixture/fixture.json:
//                                                                    {userData, plaintext, encrypted} (encrypted = base64, as stored by the core)
//   node tests/fixtures/electron-secret.mjs encrypt <text> [--user-data-dir=<dir>]   prints {"value": base64}
//   node tests/fixtures/electron-secret.mjs decrypt <base64> [--user-data-dir=<dir>] prints {"value": text} or {"error": message}
// The values are test values only; nothing is logged.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const workRoot = path.resolve(repoRoot, '..', 'work');
const electronDev = path.join(workRoot, 'electron-dev');
const root = path.join(workRoot, 'secret-fixture');
const appDir = path.join(root, 'app');
export const FIXTURE_PLAINTEXT = 'tvly-fixture-Şubat-ğüşiöç-😀-0123456789';

const MAIN = `'use strict';
const {app, safeStorage} = require('electron');
const fs = require('node:fs');
const arg = name => (process.argv.find(a => a.startsWith('--' + name + '=')) || '').slice(name.length + 3);
const request = JSON.parse(fs.readFileSync(arg('request'), 'utf8'));
app.setPath('userData', request.userData);
app.whenReady().then(() => {
  let out;
  try {
    if (!safeStorage.isEncryptionAvailable()) throw Error('safeStorage unavailable');
    if (request.op === 'encrypt') out = {value: safeStorage.encryptString(request.value).toString('base64')};
    else if (request.op === 'decrypt') out = {value: safeStorage.decryptString(Buffer.from(request.value, 'base64'))};
    else throw Error('unknown op');
  } catch (e) { out = {error: String(e && e.message || e)}; }
  fs.writeFileSync(arg('response'), JSON.stringify(out), 'utf8');
  app.quit();
});
`;

// The fixture app: electron-dev's runtime files as hard links, plus resources/app with the script above.
function prepareApp() {
  if (!fs.existsSync(path.join(electronDev, 'lumen.cpp.exe'))) throw Error('Missing ' + electronDev + '\\lumen.cpp.exe (scripts/build-portable.ps1)');
  const link = (from, to) => { if (!fs.existsSync(to)) { try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to); } } };
  fs.mkdirSync(path.join(appDir, 'locales'), { recursive: true });
  for (const name of fs.readdirSync(electronDev)) {
    const from = path.join(electronDev, name);
    if (fs.statSync(from).isFile() && /\.(exe|dll|pak|dat|bin|json)$|^version$/i.test(name)) link(from, path.join(appDir, name));
  }
  for (const name of fs.readdirSync(path.join(electronDev, 'locales'))) link(path.join(electronDev, 'locales', name), path.join(appDir, 'locales', name));
  const app = path.join(appDir, 'resources', 'app');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'lumen-secret-fixture', version: '1.0.0', main: 'main.cjs', private: true }));
  fs.writeFileSync(path.join(app, 'main.cjs'), MAIN);
}

// Runs one safeStorage operation in Electron. userData: the folder that holds (or gets) Local State.
export function electronSecret(op, value, userData = path.join(root, 'userdata')) {
  prepareApp();
  fs.mkdirSync(userData, { recursive: true });
  const id = process.pid + '-' + Date.now();
  const request = path.join(root, `request-${id}.json`), response = path.join(root, `response-${id}.json`);
  fs.writeFileSync(request, JSON.stringify({ op, value, userData }), 'utf8');
  try {
    const r = spawnSync(path.join(appDir, 'lumen.cpp.exe'), [`--request=${request}`, `--response=${response}`, '--no-sandbox', '--disable-gpu'], { stdio: 'ignore', timeout: 60000 });
    if (!fs.existsSync(response)) throw Error(`Electron fixture produced no answer (status ${r.status}${r.error ? ', ' + r.error.message : ''})`);
    return JSON.parse(fs.readFileSync(response, 'utf8'));
  } finally { fs.rmSync(request, { force: true }); fs.rmSync(response, { force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const userData = args.find(a => a.startsWith('--user-data-dir='))?.slice(16);
  const [op, value] = args.filter(a => !a.startsWith('--'));
  if (op === 'encrypt' || op === 'decrypt') {
    process.stdout.write(JSON.stringify(electronSecret(op, value, userData)) + '\n');
  } else {
    const dir = userData || path.join(root, 'userdata');
    const r = electronSecret('encrypt', FIXTURE_PLAINTEXT, dir);
    if (r.error) { console.error('electron-secret: ' + r.error); process.exit(1); }
    fs.writeFileSync(path.join(root, 'fixture.json'), JSON.stringify({ userData: dir, plaintext: FIXTURE_PLAINTEXT, encrypted: r.value }, null, 1), 'utf8');
    process.stdout.write(path.join(root, 'fixture.json') + '\n');
  }
}
