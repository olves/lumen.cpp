// Appearance model (app/appearance.js): themes, token resolution, contrast, override validation and the migration of the old
// layout/colorMode/accent/text-size preferences. The last test runs the real core (core-host.cjs) to prove both shells
// get the migration where prefs are loaded and that saving keeps old fields.
//   node --test "tests/core/appearance-migrate.test.mjs"
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const require = createRequire(import.meta.url);
const A = require('../../app/appearance.js');
const { THEMES, THEME_IDS, MODES, PAIRS, contrast, resolveTokens, migrateAppearance, sanitizeAppearance, setOverride, validateOverride } = A;

describe('themes and contrast', () => {
  test('three themes x two modes define every token', () => {
    assert.deepEqual(THEME_IDS, ['native', 'reading', 'pro']);
    for (const t of THEME_IDS) for (const m of MODES) {
      const tokens = resolveTokens({ theme: t, mode: m });
      for (const name of A.TOKEN_NAMES) assert.ok(tokens[name], `${t}/${m} has ${name}`);
    }
  });
  test('every text/surface and accent pair is >= its minimum in every theme and mode', () => {
    for (const t of THEME_IDS) for (const m of MODES) {
      const k = resolveTokens({ theme: t, mode: m });
      for (const p of PAIRS) assert.ok(contrast(k[p.fg], k[p.bg]) >= p.min, `${t}/${m} ${p.fg} on ${p.bg}: ${contrast(k[p.fg], k[p.bg]).toFixed(2)} < ${p.min}`);
      for (const s of ['--surface-0', '--surface-1', '--surface-2', '--surface-3']) assert.ok(contrast(k['--text'], k[s]) >= 4.5 && contrast(k['--text-muted'], k[s]) >= 4.5);
      assert.ok(contrast(k['--accent-text'], k['--accent']) >= 4.5, `${t}/${m} accent-text on accent`);
    }
  });
  test('contrast matches known values', () => {
    assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
    assert.equal(contrast('#777777', '#777777'), 1);
  });
  test('the global build works in a classic script (browser) without module', () => {
    const ctx = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(repoRoot, 'app', 'appearance.js'), 'utf8'), ctx);
    assert.equal(typeof vm.runInContext('resolveTokens', ctx), 'function');
    assert.equal(typeof vm.runInContext('contrast', ctx), 'function');
    assert.equal(vm.runInContext('Object.keys(THEMES).join()', ctx), 'native,reading,pro');
    assert.equal(typeof vm.runInContext('LumenAppearance.migrateAppearance', ctx), 'function');
  });
  test('fonts: an override keeps the theme stack as fallback', () => {
    const k = resolveTokens({ theme: 'native', mode: 'dark', overrides: { '--font-ui': '"Not Installed Sans"' } });
    assert.ok(k['--font-ui'].startsWith('"Not Installed Sans",'));
    assert.ok(k['--font-ui'].includes('"Segoe UI"') && k['--font-ui'].endsWith('sans-serif'));
  });
});

describe('override validation', () => {
  const base = { theme: 'reading', mode: 'light', overrides: {}, statusBar: false };
  test('accepts a readable accent and derives accent-text', () => {
    const r = setOverride(base, '--accent', '#2F5F8A');
    assert.equal(r.ok, true);
    assert.equal(r.appearance.overrides['--accent'], '#2f5f8a');
    const k = resolveTokens(r.appearance);
    assert.ok(contrast(k['--accent-text'], k['--accent']) >= 4.5);
    assert.equal(k['--focus'], '#2f5f8a');
  });
  test('rejects low-contrast color (light yellow on white) and leaves the appearance unchanged', () => {
    const r = setOverride(base, '--accent', '#ffeb99');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'low-contrast');
    assert.deepEqual(r.appearance.overrides, {});
    const t = setOverride(base, '--text', '#cccccc');
    assert.equal(t.ok, false);
    assert.equal(t.reason, 'low-contrast');
  });
  test('rejects invalid hex, unknown token and bad values', () => {
    for (const v of ['red', '#fff', '#12345g', '', 12, null, '#1234567']) assert.equal(validateOverride(base, '--accent', v).ok, false, String(v));
    assert.equal(validateOverride(base, '--not-a-token', '#112233').reason, 'unknown-token');
    assert.equal(validateOverride(base, '--font-size', '40px').ok, false);
    assert.equal(validateOverride(base, '--font-size', '16px').ok, true);
    assert.equal(validateOverride(base, '--radius', '99px').ok, false);
    assert.equal(validateOverride(base, '--radius', '12px').ok, true);
    assert.equal(validateOverride(base, '--font-ui', 'x; background:red').ok, false);
    assert.equal(validateOverride(base, '--font-ui', 'url(http://x)').ok, false);
  });
  test('sanitize drops invalid stored overrides and resolve ignores them', () => {
    const dirty = { theme: 'pro', mode: 'dark', statusBar: 1, overrides: { '--accent': '#fff', '--bogus': '#112233', '--text': '#222222', '--radius': '8px' } };
    const clean = sanitizeAppearance(dirty);
    assert.deepEqual(clean.overrides, { '--radius': '8px' });
    assert.equal(clean.statusBar, false);
    const k = resolveTokens(dirty);
    assert.equal(k['--accent'], THEMES.pro.dark['--accent']);
    assert.equal(k['--text'], THEMES.pro.dark['--text']);
    assert.equal(k['--radius'], '8px');
  });
  test('garbage appearance falls back to defaults', () => {
    assert.deepEqual(sanitizeAppearance(null), { theme: 'native', mode: 'dark', overrides: {}, statusBar: false });
    assert.deepEqual(sanitizeAppearance({ theme: 'x', mode: 'y', overrides: 5 }), { theme: 'native', mode: 'dark', overrides: {}, statusBar: false });
  });
});

describe('migration', () => {
  test('layout: desk -> native, studio -> pro, missing -> native', () => {
    assert.equal(migrateAppearance({ layout: 'desk' }).appearance.theme, 'native');
    assert.equal(migrateAppearance({ layout: 'studio' }).appearance.theme, 'pro');
    assert.equal(migrateAppearance({}).appearance.theme, 'native');
    assert.equal(migrateAppearance({ layout: 'weird' }).appearance.theme, 'native');
  });
  test('colorMode -> mode (default dark), statusBar off', () => {
    assert.equal(migrateAppearance({ colorMode: 'light' }).appearance.mode, 'light');
    assert.equal(migrateAppearance({ colorMode: 'dark' }).appearance.mode, 'dark');
    assert.equal(migrateAppearance({}).appearance.mode, 'dark');
    assert.equal(migrateAppearance({}).appearance.statusBar, false);
  });
  test('custom accent hex -> overrides[--accent]; readable value is kept as is', () => {
    const m = migrateAppearance({ theme: 'custom', accentColor: '#2F5F8A', colorMode: 'light' });
    assert.equal(m.appearance.overrides['--accent'], '#2f5f8a');
  });
  test('custom accent that would be unreadable is moved, not dropped, and still passes', () => {
    const m = migrateAppearance({ theme: 'custom', accentColor: '#ffeb99', colorMode: 'light' });
    const accent = m.appearance.overrides['--accent'];
    assert.ok(accent && accent !== '#ffeb99');
    assert.ok(contrast(accent, THEMES.native.light['--surface-0']) >= 3);
    assert.ok(contrast(resolveTokens(m.appearance)['--accent-text'], accent) >= 4.5);
  });
  test('old preset themes map to their accent for the migrated mode; warm adds nothing', () => {
    assert.equal(migrateAppearance({ theme: 'ocean', colorMode: 'dark' }).appearance.overrides['--accent'], '#8fb4d9');
    assert.equal(migrateAppearance({ theme: 'ocean', colorMode: 'light' }).appearance.overrides['--accent'], '#2f5f8a');
    assert.equal(migrateAppearance({ theme: 'gold', colorMode: 'light' }).appearance.overrides['--accent'], '#765e1d');
    assert.equal('--accent' in migrateAppearance({ theme: 'warm' }).appearance.overrides, false);
    assert.equal('--accent' in migrateAppearance({ accentColor: '#112233' }).appearance.overrides, false, 'accentColor only counts with theme custom');
  });
  test('chat text size -> overrides[--font-size]', () => {
    for (const n of [13, 14, 15, 16]) assert.equal(migrateAppearance({ textSize: n }).appearance.overrides['--font-size'], n + 'px');
    assert.equal('--font-size' in migrateAppearance({}).appearance.overrides, false);
    assert.equal('--font-size' in migrateAppearance({ textSize: 99 }).appearance.overrides, false);
  });
  test('old fields are kept untouched and unrelated prefs survive', () => {
    const old = { language: 'tr', layout: 'studio', colorMode: 'light', designChosen: true, theme: 'custom', accentColor: '#6a4a85', textSize: 15, contextSize: 8192 };
    const m = migrateAppearance(old);
    for (const [k, v] of Object.entries(old)) assert.deepEqual(m[k], v, k);
    assert.equal(old.appearance, undefined, 'input is not mutated');
  });
  test('second migration is idempotent and never overwrites a chosen appearance', () => {
    const once = migrateAppearance({ layout: 'studio', colorMode: 'light', theme: 'ocean', textSize: 16 });
    const twice = migrateAppearance(once);
    assert.deepEqual(twice, once);
    const chosen = { ...once, appearance: { theme: 'reading', mode: 'dark', overrides: {}, statusBar: true } };
    assert.deepEqual(migrateAppearance(chosen).appearance, chosen.appearance);
  });
  test('migrated appearance always resolves to passing contrast', () => {
    for (const theme of ['custom', 'ocean', 'gold', 'rose', 'graphite', 'warm']) for (const colorMode of MODES) for (const layout of ['desk', 'studio']) for (const accentColor of ['#ffeb99', '#101010', '#d08a5c', '#00ff00']) {
      const a = migrateAppearance({ theme, colorMode, layout, accentColor, textSize: 14 }).appearance, k = resolveTokens(a);
      for (const p of PAIRS) assert.ok(contrast(k[p.fg], k[p.bg]) >= p.min, `${theme}/${colorMode}/${layout}/${accentColor} ${p.fg}`);
    }
  });
});

// ---- real core: migration happens where prefs are loaded; saving keeps old fields and validates appearance ----
const hostScript = path.join(repoRoot, 'app', 'core-host.cjs');
const appRoot = path.join(repoRoot, '..', 'work', 'electron-dev');
const runDir = path.join(repoRoot, '..', 'work', 'appearance-tests', new Date().toISOString().replace(/[:.]/g, '-'));
const children = [];
after(() => { for (const c of children) try { c.kill(); } catch {} });

async function coreWith(prefs) {
  const dataDir = fs.mkdtempSync(path.join((fs.mkdirSync(runDir, { recursive: true }), runDir), 'data-'));
  if (prefs) fs.writeFileSync(path.join(dataDir, 'desktop-preferences.json'), JSON.stringify(prefs));
  const child = spawn(process.execPath, [hostScript, '--data', dataDir, '--app', appRoot, '--asset-base', 'http://lumen.localhost/', '--update-mode', 'check-only', '--version', '9.9.9-test'], { stdio: ['pipe', 'pipe', 'pipe'] });
  children.push(child);
  const waiting = new Map(); let seq = 0, buffer = '', stderr = '';
  let ready; const readyP = new Promise(r => { ready = r; });
  child.stderr.on('data', d => { stderr += d; });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => { buffer += chunk; let i; while ((i = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); let m; try { m = JSON.parse(line); } catch { continue; } if (m.type === 'ready') ready(); else if (m.type === 'result') { waiting.get(m.id)?.(m); waiting.delete(m.id); } } });
  await Promise.race([readyP, new Promise((_, rej) => child.on('exit', () => rej(Error('core exited: ' + stderr)))), new Promise((_, rej) => setTimeout(() => rej(Error('core not ready: ' + stderr)), 30000))]);
  const call = (channel, args = []) => new Promise(resolve => { const id = 'c' + (++seq); waiting.set(id, resolve); child.stdin.write(JSON.stringify({ id, type: 'call', channel, args }) + '\n'); });
  return { call, dataDir, stop: () => { try { child.stdin.end(); } catch {} } };
}

describe('core preferences', () => {
  test('loading old prefs migrates in both read and save paths; old fields stay', async () => {
    const old = { language: 'tr', motion: true, contextSize: 8192, layout: 'studio', colorMode: 'light', designChosen: true, theme: 'custom', accentColor: '#6a4a85', textSize: 15 };
    const core = await coreWith(old);
    try {
      const loaded = (await core.call('preferences', [])).value;
      assert.equal(loaded.appearance.theme, 'pro');
      assert.equal(loaded.appearance.mode, 'light');
      assert.equal(loaded.appearance.overrides['--accent'], '#6a4a85');
      assert.equal(loaded.appearance.overrides['--font-size'], '15px');
      assert.equal(loaded.layout, 'studio'); assert.equal(loaded.colorMode, 'light'); assert.equal(loaded.accentColor, '#6a4a85'); assert.equal(loaded.textSize, 15);
      // a save from the old UI (no appearance field) keeps the appearance and the old fields
      const saved = (await core.call('preferences', [{ language: 'tr', motion: true, contextSize: 8192, layout: 'studio', colorMode: 'light', theme: 'custom', accentColor: '#6a4a85', textSize: 15 }])).value;
      assert.deepEqual(saved.appearance, loaded.appearance);
      // a save with a new appearance is validated: bad overrides are not stored
      const next = (await core.call('preferences', [{ appearance: { theme: 'reading', mode: 'dark', statusBar: true, overrides: { '--accent': '#ffffff', '--text': '#101010', '--radius': '10px', '--nope': '#123456' } } }])).value;
      assert.equal(next.appearance.theme, 'reading');
      assert.equal(next.appearance.statusBar, true);
      assert.deepEqual(next.appearance.overrides, { '--accent': '#ffffff', '--radius': '10px' }, 'white accent on the dark surface passes; unreadable text and unknown token are dropped');
      const onDisk = JSON.parse(fs.readFileSync(path.join(core.dataDir, 'desktop-preferences.json'), 'utf8'));
      assert.deepEqual(onDisk.appearance, next.appearance);
      assert.equal(onDisk.layout, 'studio'); assert.equal(onDisk.textSize, 15);
      // second load: nothing re-migrated
      assert.deepEqual((await core.call('preferences', [])).value.appearance, next.appearance);
    } finally { core.stop(); }
  });
  test('fresh data directory gets the default appearance', async () => {
    const core = await coreWith(null);
    try {
      const p = (await core.call('preferences', [])).value;
      assert.deepEqual(p.appearance, { theme: 'native', mode: 'dark', overrides: {}, statusBar: false });
    } finally { core.stop(); }
  });
});
