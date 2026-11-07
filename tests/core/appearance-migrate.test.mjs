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
    const k = resolveTokens({ theme: 'native', mode: 'dark', overrides: { common: { '--font-ui': '"Not Installed Sans"' } } });
    assert.ok(k['--font-ui'].startsWith('"Not Installed Sans",'));
    assert.ok(k['--font-ui'].includes('"Segoe UI"') && k['--font-ui'].endsWith('sans-serif'));
  });
  test('native accent is the Windows blue family; reading and pro stay warm orange', () => {
    assert.equal(THEMES.native.dark['--accent'], '#4cc2ff');
    assert.ok(THEMES.native.light['--accent'].startsWith('#00'));
    for (const t of ['reading', 'pro']) for (const m of MODES) { const [r, g, b] = [1, 3, 5].map(i => parseInt(THEMES[t][m]['--accent'].slice(i, i + 2), 16)); assert.ok(r > g && g > b, `${t}/${m} warm`); }
  });
  test('accent and focus reach 3:1 on ALL four surfaces in every theme and mode', () => {
    for (const t of THEME_IDS) for (const m of MODES) {
      const k = resolveTokens({ theme: t, mode: m });
      for (const s of ['--surface-0', '--surface-1', '--surface-2', '--surface-3']) for (const f of ['--accent', '--focus']) assert.ok(contrast(k[f], k[s]) >= 3, `${t}/${m} ${f} on ${s}`);
    }
  });
});

describe('override validation', () => {
  const base = { theme: 'reading', mode: 'light', overrides: { common: {}, dark: {}, light: {} }, statusBar: false };
  test('accepts a readable accent and derives accent-text and focus', () => {
    const r = setOverride(base, '--accent', '#2F5F8A');
    assert.equal(r.ok, true);
    assert.equal(r.appearance.overrides.light['--accent'], '#2f5f8a');
    assert.deepEqual(r.appearance.overrides.dark, {});
    const k = resolveTokens(r.appearance);
    assert.ok(contrast(k['--accent-text'], k['--accent']) >= 4.5);
    assert.equal(k['--focus'], '#2f5f8a');
  });
  test('rejects low-contrast color (light yellow on white) and leaves the appearance unchanged', () => {
    const r = setOverride(base, '--accent', '#ffeb99');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'low-contrast');
    assert.deepEqual(r.appearance.overrides, { common: {}, dark: {}, light: {} });
    assert.equal(setOverride(base, '--text', '#cccccc').reason, 'low-contrast');
  });
  test('accent must reach 3:1 on every surface, not only surface-0', () => {
    // passes on surface-0 (#faf9f7) but not on surface-3 (#ebe7e0)
    let found = null;
    for (let v = 0x80; v < 0xff && !found; v++) { const c = '#' + v.toString(16).repeat(3); if (contrast(c, '#faf9f7') >= 3 && contrast(c, '#ebe7e0') < 3) found = c; }
    assert.ok(found, 'a grey exists that passes only surface-0');
    assert.equal(validateOverride(base, '--accent', found).ok, false);
  });
  test('rejects invalid hex, unknown token and bad values', () => {
    for (const v of ['red', '#fff', '#12345g', '', 12, null, '#1234567']) assert.equal(validateOverride(base, '--accent', v).ok, false, String(v));
    assert.equal(validateOverride(base, '--not-a-token', '#112233').reason, 'unknown-token');
    assert.equal(validateOverride(base, '--font-size', '40px').ok, false);
    assert.equal(validateOverride(base, '--font-size', '16px').ok, true);
    assert.equal(validateOverride(base, '--font-size', '20px').ok, true);
    assert.equal(validateOverride(base, '--font-size', '20.5px').ok, false);
    assert.equal(validateOverride(base, '--font-size', '11.5px').ok, false);
    assert.equal(validateOverride(base, '--font-size', '14.5px').ok, true);
    assert.equal(validateOverride(base, '--radius', '99px').ok, false);
    assert.equal(validateOverride(base, '--radius', '12px').ok, true);
    assert.equal(validateOverride(base, '--font-ui', 'x; background:red').ok, false);
    assert.equal(validateOverride(base, '--font-ui', 'url(http://x)').ok, false);
  });
  test('font values need balanced quotes', () => {
    for (const v of ['"Open Sans', 'Open Sans"', "'Foo", '"a" "b', "a,\"b'", "Foo's Font"]) assert.equal(validateOverride(base, '--font-ui', v).ok, false, v);
    for (const v of ['"Open Sans"', "'Foo Bar',serif", 'Inter', `"Foo's Font"`,"'Say \"hi\"'"]) assert.equal(validateOverride(base, '--font-ui', v).ok, true, v);
  });
  test('modes are validated separately and a mode switch never drops the other mode', () => {
    let a = { ...base, mode: 'dark' };
    // a light accent is fine on dark surfaces...
    let r = setOverride(a, '--accent', '#ffeb99'); assert.equal(r.ok, true); a = r.appearance;
    // ...and unreadable on light ones (explicit mode)
    assert.equal(setOverride(a, '--accent', '#ffeb99', 'light').ok, false);
    r = setOverride(a, '--accent', '#2f5f8a', 'light'); assert.equal(r.ok, true); a = r.appearance;
    assert.equal(a.overrides.dark['--accent'], '#ffeb99'); assert.equal(a.overrides.light['--accent'], '#2f5f8a');
    for (const mode of ['light', 'dark', 'light']) {
      a = sanitizeAppearance({ ...a, mode });
      assert.equal(a.overrides.dark['--accent'], '#ffeb99', 'dark kept after switching to ' + mode);
      assert.equal(a.overrides.light['--accent'], '#2f5f8a', 'light kept after switching to ' + mode);
      assert.equal(resolveTokens(a)['--accent'], mode === 'dark' ? '#ffeb99' : '#2f5f8a');
    }
  });
  test('sanitize drops invalid stored overrides per mode and resolve ignores them', () => {
    const dirty = { theme: 'pro', mode: 'dark', statusBar: 1, overrides: { common: { '--radius': '8px', '--bogus': '1px', '--font-ui': '"x' }, dark: { '--accent': '#fff', '--text': '#222222', '--border': '#445566' }, light: { '--accent': '#112233' } } };
    const clean = sanitizeAppearance(dirty);
    assert.deepEqual(clean.overrides.common, { '--radius': '8px' });
    assert.ok(!('--text' in clean.overrides.dark));
    assert.equal(clean.overrides.dark['--border'], '#445566');
    assert.equal(clean.overrides.light['--accent'], '#112233', 'valid in light even though the mode is dark');
    assert.equal(clean.statusBar, false);
    const k = resolveTokens(dirty);
    assert.equal(k['--text'], THEMES.pro.dark['--text']);
    assert.equal(k['--radius'], '8px');
  });
  test('cumulative validation is order independent and deterministic', () => {
    // two overrides that only fail together (text and surface-0 both pushed to mid grey)
    const a = { '--surface-0': '#808080', '--text': '#909090', '--border': '#101010' };
    const r1 = sanitizeAppearance({ theme: 'native', mode: 'dark', overrides: { dark: a } });
    const r2 = sanitizeAppearance({ theme: 'native', mode: 'dark', overrides: { dark: Object.fromEntries(Object.entries(a).reverse()) } });
    assert.deepEqual(r1, r2);
    assert.equal(r1.overrides.dark['--border'], '#101010', 'unrelated override survives');
    const k = resolveTokens(r1);
    for (const p of PAIRS) assert.ok(contrast(k[p.fg], k[p.bg]) >= p.min);
  });
  test('garbage appearance falls back to defaults', () => {
    const d = { theme: 'native', mode: 'dark', overrides: { common: {}, dark: {}, light: {} }, statusBar: false };
    assert.deepEqual(sanitizeAppearance(null), d);
    assert.deepEqual(sanitizeAppearance({ theme: 'x', mode: 'y', overrides: 5 }), d);
    assert.deepEqual(sanitizeAppearance({ overrides: [1] }), d);
  });
  test('partial appearance merges with the previous one', () => {
    const prev = { theme: 'pro', mode: 'light', statusBar: false, overrides: { common: { '--radius': '10px' }, dark: { '--accent': '#ffeb99' }, light: { '--accent': '#2f5f8a' } } };
    const m1 = A.mergeAppearance(prev, { statusBar: true });
    assert.deepEqual(m1, { ...prev, statusBar: true });
    const m2 = A.mergeAppearance(prev, { mode: 'dark' });
    assert.equal(m2.theme, 'pro'); assert.deepEqual(m2.overrides, prev.overrides);
    const m3 = A.mergeAppearance(prev, { overrides: { common: {} } });
    assert.deepEqual(m3.overrides, { common: {}, dark: prev.overrides.dark, light: prev.overrides.light });
    // invalid values keep the PREVIOUS value, never reset to defaults
    const bad = A.mergeAppearance(prev, { theme: 'nope', mode: 'x', statusBar: 'yes', overrides: { dark: 5, light: [1], common: null } });
    assert.deepEqual(bad, prev);
    assert.deepEqual(A.mergeAppearance(prev, 'garbage'), prev);
    assert.equal(A.mergeAppearance(prev, { theme: 'reading', mode: 'nope' }).mode, 'light');
    assert.deepEqual(A.mergeAppearance(prev, { overrides: { dark: { '--accent': 'red', '--radius': '3px' } } }).overrides.dark, {}, 'a valid section replaces it; invalid entries are dropped');
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
  test('custom accent hex goes into the modes where it passes; elsewhere it is fitted per mode', () => {
    // #2f5f8a passes on light surfaces, is too dark for dark surfaces -> fitted (lighter) there
    const o = migrateAppearance({ theme: 'custom', accentColor: '#2F5F8A', colorMode: 'light' }).appearance.overrides;
    assert.equal(o.light['--accent'], '#2f5f8a');
    assert.ok(o.dark['--accent'] && o.dark['--accent'] !== '#2f5f8a');
    // #ffeb99 passes on dark, is fitted (darker) on light
    const y = migrateAppearance({ theme: 'custom', accentColor: '#ffeb99', colorMode: 'light' }).appearance.overrides;
    assert.equal(y.dark['--accent'], '#ffeb99');
    assert.ok(y.light['--accent'] && y.light['--accent'] !== '#ffeb99');
    assert.deepEqual(y.common, {});
  });
  test('old preset themes map to their own dark and light accents; warm adds nothing', () => {
    const o = migrateAppearance({ theme: 'ocean', colorMode: 'dark' }).appearance.overrides;
    assert.equal(o.dark['--accent'], '#8fb4d9'); assert.equal(o.light['--accent'], '#2f5f8a');
    assert.equal(migrateAppearance({ theme: 'gold', colorMode: 'light' }).appearance.overrides.light['--accent'], '#765e1d');
    const w = migrateAppearance({ theme: 'warm' }).appearance.overrides;
    assert.deepEqual(w, { common: {}, dark: {}, light: {} });
    assert.deepEqual(migrateAppearance({ accentColor: '#112233' }).appearance.overrides, { common: {}, dark: {}, light: {} }, 'accentColor only counts with theme custom');
  });
  test('chat text size -> common --font-size, but 14 (old default) adds nothing', () => {
    for (const n of [13, 15, 16]) assert.equal(migrateAppearance({ textSize: n }).appearance.overrides.common['--font-size'], n + 'px');
    assert.equal('--font-size' in migrateAppearance({ textSize: 14 }).appearance.overrides.common, false);
    assert.equal('--font-size' in migrateAppearance({}).appearance.overrides.common, false);
    assert.equal('--font-size' in migrateAppearance({ textSize: 99 }).appearance.overrides.common, false);
  });
  test('old fields are kept untouched and unrelated prefs survive', () => {
    const old = { language: 'tr', layout: 'studio', colorMode: 'light', designChosen: true, theme: 'custom', accentColor: '#6a4a85', textSize: 15, contextSize: 8192 };
    const m = migrateAppearance(old);
    for (const [k, v] of Object.entries(old)) assert.deepEqual(m[k], v, k);
    assert.equal(old.appearance, undefined, 'input is not mutated');
  });
  test('second migration is idempotent; an existing appearance is only sanitized', () => {
    const once = migrateAppearance({ layout: 'studio', colorMode: 'light', theme: 'ocean', textSize: 16 });
    assert.deepEqual(migrateAppearance(once), once);
    assert.deepEqual(migrateAppearance(migrateAppearance(once)), once);
    const chosen = { ...once, appearance: { theme: 'reading', mode: 'dark', overrides: { common: {}, dark: { '--accent': '#ffffff', '--text': '#101010' }, light: {} }, statusBar: true } };
    const again = migrateAppearance(chosen).appearance;
    assert.equal(again.theme, 'reading'); assert.equal(again.statusBar, true);
    assert.deepEqual(again.overrides.dark, { '--accent': '#ffffff' }, 'sanitized on read: unreadable text dropped');
  });
  test('migrated appearance always resolves to passing contrast in both modes', () => {
    for (const theme of ['custom', 'ocean', 'gold', 'rose', 'graphite', 'warm']) for (const colorMode of MODES) for (const layout of ['desk', 'studio']) for (const accentColor of ['#ffeb99', '#101010', '#d08a5c', '#00ff00']) {
      const a = migrateAppearance({ theme, colorMode, layout, accentColor, textSize: 14 }).appearance;
      for (const mode of MODES) {
        const k = resolveTokens({ ...a, mode });
        for (const p of PAIRS) assert.ok(contrast(k[p.fg], k[p.bg]) >= p.min, `${theme}/${colorMode}/${layout}/${accentColor}/${mode} ${p.fg} on ${p.bg}`);
      }
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
      assert.equal(loaded.appearance.overrides.light['--accent'], '#6a4a85');
      assert.equal(loaded.appearance.overrides.common['--font-size'], '15px');
      assert.equal(loaded.layout, 'studio'); assert.equal(loaded.colorMode, 'light'); assert.equal(loaded.accentColor, '#6a4a85'); assert.equal(loaded.textSize, 15);
      // a save from the old UI (no appearance field) keeps the appearance and the old fields
      const saved = (await core.call('preferences', [{ language: 'tr', motion: true, contextSize: 8192, layout: 'studio', colorMode: 'light', theme: 'custom', accentColor: '#6a4a85', textSize: 15 }])).value;
      assert.deepEqual(saved.appearance, loaded.appearance);
      // a save with a new appearance is validated: bad overrides are not stored
      const next = (await core.call('preferences', [{ appearance: { theme: 'reading', mode: 'dark', statusBar: true, overrides: { common: { '--radius': '10px', '--nope': '1px' }, dark: { '--accent': '#ffffff', '--text': '#101010' } } } }])).value;
      assert.equal(next.appearance.theme, 'reading');
      assert.equal(next.appearance.statusBar, true);
      assert.deepEqual(next.appearance.overrides.common, { '--radius': '10px' });
      assert.deepEqual(next.appearance.overrides.dark, { '--accent': '#ffffff' }, 'unreadable text and unknown token are dropped');
      assert.equal(next.appearance.overrides.light['--accent'], '#6a4a85', 'the other mode keeps its override');
      const onDisk = JSON.parse(fs.readFileSync(path.join(core.dataDir, 'desktop-preferences.json'), 'utf8'));
      assert.deepEqual(onDisk.appearance, next.appearance);
      assert.equal(onDisk.layout, 'studio'); assert.equal(onDisk.textSize, 15);
      // a partial save (statusBar only) keeps theme and overrides
      const partial = (await core.call('preferences', [{ appearance: { statusBar: false } }])).value;
      assert.equal(partial.appearance.theme, 'reading'); assert.deepEqual(partial.appearance.overrides, next.appearance.overrides);
      assert.equal(fs.existsSync(path.join(core.dataDir, 'desktop-preferences.json.tmp')), false, 'atomic write leaves no temp file');
      // second load: nothing re-migrated
      assert.deepEqual((await core.call('preferences', [])).value.appearance, partial.appearance);
    } finally { core.stop(); }
  });
  test('fresh data directory gets the default appearance', async () => {
    const core = await coreWith(null);
    try {
      const p = (await core.call('preferences', [])).value;
      assert.deepEqual(p.appearance, { theme: 'native', mode: 'dark', overrides: { common: {}, dark: {}, light: {} }, statusBar: false });
    } finally { core.stop(); }
  });
});
