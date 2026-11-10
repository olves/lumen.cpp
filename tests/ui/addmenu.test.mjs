// The + menu (v1.0.9): one "Add files" row instead of three (photos, text/code, documents), rows grouped under captions,
// one line per row (the hint moves to the tooltip), and the mode rows show when they are on. No model is needed.
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/addmenu.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, workRoot } from '../harness/launch.mjs';
import { prepareData } from './data.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `addmenu-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data');
let app;
const ev = expression => app.cdp.evaluate(expression);
const open = async () => { await ev("closeComposerMenus(); 0"); await app.cdp.click('#add-button'); await app.cdp.waitFor("!document.getElementById('add-menu').hidden", 5000); };
// Visible rows and captions in screen order, as the user reads them.
const layout = () => ev(`[...document.getElementById('add-menu').children].filter(n => n.offsetParent !== null)
  .map(n => n.classList.contains('menu-caption') ? '# ' + n.textContent : n.id)`);

describe(`+ menu (${shell})`, () => {
  before(async () => {
    prepareData(dataDir, null);
    app = await launch({ shell, dataDir });
    await app.cdp.waitFor('state.ready === true', 30000);
    await ev("setPage('chat'); 0");
  });
  after(async () => { await app?.stop(); });

  test('rows are grouped: add, modes, conversation', async () => {
    await open();
    assert.deepEqual(await layout(), ['# Add', 'attach-any', 'attach-project', '# Modes', 'use-research', 'use-tools',
      '# Conversation', 'use-skill', 'composer-instructions']);
    assert.equal(await ev("document.activeElement.id"), 'attach-any', 'the first row takes focus');
  });

  test('each row is one line; the hint is the tooltip', async () => {
    const rows = await ev(`[...document.querySelectorAll('#add-menu > button')].filter(b => b.offsetParent).map(b => ({
      id: b.id, h: Math.round(b.getBoundingClientRect().height), small: b.querySelector('small') ? getComputedStyle(b.querySelector('small')).display : 'none', title: b.title }))`);
    for (const r of rows) {
      assert.equal(r.small, 'none', r.id + ' shows no second line');
      assert.ok(r.h <= 40, r.id + ' is one line (' + r.h + ' px)');
      assert.ok(r.title.length > 0, r.id + ' has a tooltip');
    }
    const height = await ev("Math.round(document.getElementById('add-menu').getBoundingClientRect().height)");
    assert.ok(height < 420, 'menu is compact (' + height + ' px)');
  });

  test('"Add files" takes photos, text and documents through one picker', async () => {
    const input = await ev(`(() => { const i = document.getElementById('attach-any-input'); return i && { type: i.type, multiple: i.multiple, accept: i.accept }; })()`);
    assert.equal(input.type, 'file');
    assert.equal(input.multiple, true);
    for (const ext of ['.png', '.jpg', '.webp', '.txt', '.py', '.pdf', '.docx']) assert.ok(input.accept.split(',').includes(ext), ext + ' accepted');
    // Clicking the row opens the picker (the input's click); the files it returns go the drop path.
    const clicked = await ev(`(() => { let hit = false; const i = document.getElementById('attach-any-input'); const c = i.click; i.click = () => { hit = true; }; document.getElementById('attach-any').click(); i.click = c; return hit; })()`);
    assert.equal(clicked, true);
    assert.equal(await ev("document.getElementById('add-menu').hidden"), true, 'menu closes');
    await ev(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['print(1)\\n'], 'main.py')); const i = document.getElementById('attach-any-input');
      i.files = dt.files; i.dispatchEvent(new Event('change')); return 0; })()`);
    await app.cdp.waitFor("document.querySelectorAll('#attachments .attachment-chip').length === 1", 5000);
    assert.equal(await ev("document.getElementById('attach-any-input').value"), '', 'the input is cleared so the same file can be picked again');
    await ev("clearDraftFiles(); 0");
  });

  test('mode rows show when they are on', async () => {
    await ev("researchMode = true; renderToolChips(); 0");
    await open();
    assert.equal(await ev("document.getElementById('use-research').getAttribute('aria-checked')"), 'true');
    assert.equal(await ev("document.getElementById('use-tools').getAttribute('aria-checked')"), 'false');
    assert.equal(await ev("document.getElementById('use-research').getAttribute('role')"), 'menuitemcheckbox');
    await ev("researchMode = false; renderToolChips(); closeComposerMenus(); 0");
  });

  test('Turkish captions and tooltips', async () => {
    await ev("state.prefs.language = 'tr'; localize(); 0");
    await open();
    const l = await layout();
    assert.deepEqual(l.filter(x => x.startsWith('#')), ['# Ekle', '# Modlar', '# Sohbet']);
    assert.equal(await ev("document.querySelector('#attach-any strong').textContent"), 'Dosya ekle');
    assert.match(await ev("document.getElementById('attach-any').title"), /PDF/);
    await ev("state.prefs.language = 'en'; localize(); closeComposerMenus(); 0");
  });

  test('arrow keys move through the visible rows only', async () => {
    await open();
    const press = async key => { await ev(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true })); 0`); return ev('document.activeElement.id'); };
    const ids = [await press('ArrowDown'), await press('ArrowDown'), await press('ArrowUp'), await press('ArrowUp'), await press('ArrowUp')];
    assert.deepEqual(ids, ['attach-project', 'use-research', 'attach-project', 'attach-any', 'composer-instructions']);
    await ev("closeComposerMenus(); 0");
  });
});
