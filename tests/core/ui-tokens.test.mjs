// Component CSS uses tokens only: raw colours (#hex, rgb()/rgba()/hsl()) are allowed in app/ui/tokens.css alone, and every
// stylesheet that index.html links exists under app/ui/ (plus the vendored KaTeX CSS).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');
const ui = path.join(app, 'ui');
const RAW = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/;

test('app/ui component CSS has no raw colour values outside tokens.css', () => {
  const files = fs.readdirSync(ui).filter(f => f.endsWith('.css') && f !== 'tokens.css');
  assert.ok(files.length >= 9, 'component files present');
  const hits = [];
  for (const f of files) {
    const css = fs.readFileSync(path.join(ui, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    css.split('\n').forEach((line, i) => { const m = line.match(RAW); if (m) hits.push(`${f}:${i + 1} ${m[0]}`); });
  }
  assert.deepEqual(hits, []);
});

test('index.html links only app/ui stylesheets and the vendored KaTeX CSS; no legacy CSS remains in app/', () => {
  const html = fs.readFileSync(path.join(app, 'index.html'), 'utf8');
  const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(m => m[1]);
  assert.ok(links.length > 0);
  for (const href of links) {
    assert.ok(href === 'vendor/katex.min.css' || /^ui\/[a-z-]+\.css$/.test(href), href);
    assert.ok(fs.existsSync(path.join(app, href)), href);
  }
  assert.equal(links[1], 'ui/tokens.css', 'tokens load before the components');
  assert.deepEqual(fs.readdirSync(app).filter(f => f.endsWith('.css')), []);
});
