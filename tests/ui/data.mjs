// Test data for UI tests: picks a chat model and prepares a data folder. The user's %LOCALAPPDATA%\lumen.cpp is only read
// (model listing, hard links); nothing is downloaded.
import fs from 'node:fs';
import path from 'node:path';
import { workRoot, repoRoot } from '../harness/launch.mjs';

export const userData = path.join(process.env.LOCALAPPDATA || '', 'lumen.cpp');

// Gemma 4 E2B if installed, else the smallest chat GGUF. Searches the user's models folder first (read-only), then
// LUMEN_TEST_MODELS (default <work>/test-models). Never downloads anything.
function chatGgufs(dir) {
  try { return fs.readdirSync(dir).filter(f => /[.]gguf$/i.test(f) && !/mmproj|mtp|^img-/i.test(f)).map(f => path.join(dir, f)); } catch { return []; }
}
export function pickModel() {
  const dirs = [path.join(userData, 'models'), process.env.LUMEN_TEST_MODELS || path.join(workRoot, 'test-models')];
  for (const dir of dirs) {
    const files = chatGgufs(dir);
    if (!files.length) continue;
    return files.find(f => /gemma[-_ ]?4.*e2b/i.test(f)) || files.sort((x, y) => fs.statSync(x).size - fs.statSync(y).size)[0];
  }
  return null;
}

// The app resolves an installed model as models/<LocalFile || File> from its catalog, so link under that name.
function installedName(model) {
  const base = path.basename(model);
  const bundled = JSON.parse(fs.readFileSync(path.join(repoRoot, 'app', 'backend', 'models.catalog.json'), 'utf8').replace(/^﻿/, ''));
  const entry = bundled.find(m => String(m.File).toLowerCase() === base.toLowerCase() || m.LocalFile === base);
  return entry ? (entry.LocalFile || entry.File) : base;
}

export function prepareData(dataDir, model) {
  fs.mkdirSync(path.join(dataDir, 'models'), { recursive: true });
  // A fresh profile would show the one-time Desk/Studio design choice, which covers the UI.
  const prefs = path.join(dataDir, 'desktop-preferences.json');
  if (!fs.existsSync(prefs)) fs.writeFileSync(prefs, JSON.stringify({ layout: 'desk', colorMode: 'dark', designChosen: true }));
  // ...and the one-time GPU engine screen; the bundled CPU engine is enough for tests.
  const engine = path.join(dataDir, 'engine-preferences.json');
  if (!fs.existsSync(engine)) fs.writeFileSync(engine, JSON.stringify({ SetupDone: true, Backend: 'cpu' }));
  if (!model) return;
  const dest = path.join(dataDir, 'models', installedName(model));
  if (!fs.existsSync(dest)) fs.linkSync(model, dest); // hard link: no extra disk space, the original is never modified
  const catalog = path.join(userData, 'catalog.json');
  if (model.startsWith(userData) && fs.existsSync(catalog) && !fs.existsSync(path.join(dataDir, 'catalog.json'))) fs.copyFileSync(catalog, path.join(dataDir, 'catalog.json'));
}
