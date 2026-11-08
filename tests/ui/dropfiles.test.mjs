// Text and code files dropped on (or pasted into) the composer join the draft with the + menu's rules. The drop is built in the
// page with DataTransfer + DragEvent, the same objects a real drag delivers. No model is needed.
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/dropfiles.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, workRoot } from '../harness/launch.mjs';
import { prepareData } from './data.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `drop-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data');
let app;
const ev = expression => app.cdp.evaluate(expression);
// files: [[name, content]] where content is a string or an array of byte values.
const drop = (files, type = 'drop') => ev(`(() => {
  const dt = new DataTransfer();
  for (const [name, content] of ${JSON.stringify(files)}) dt.items.add(new File([Array.isArray(content) ? new Uint8Array(content) : content], name));
  const target = ${type === 'paste' ? "document.getElementById('prompt')" : "document.querySelector('.composer')"};
  if (${JSON.stringify(type)} === 'paste') { const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); target.dispatchEvent(e); return e.defaultPrevented; }
  const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }); target.dispatchEvent(over);
  const highlighted = target.classList.contains('drop-target');
  const e = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }); target.dispatchEvent(e);
  return { over: over.defaultPrevented, highlighted, dropped: e.defaultPrevented, after: target.classList.contains('drop-target') };
})()`);
const chips = () => ev("[...document.querySelectorAll('#attachments .attachment-chip span')].map(s => s.textContent)");
const lastToast = () => ev("document.getElementById('toast').textContent");
const reset = () => ev("clearDraftFiles(); document.getElementById('toast').textContent = ''; document.getElementById('toast').hidden = true; 0");

describe(`composer file drop (${shell})`, () => {
  before(async () => {
    prepareData(dataDir, null);
    app = await launch({ shell, dataDir });
    await app.cdp.waitFor('state.ready === true', 30000);
    await ev("setPage('chat'); 0");
  });
  after(async () => { await app?.stop(); });

  test('a dropped code file joins the draft and the message', async () => {
    await reset();
    const r = await drop([['notes.md', '# Hello\nçalışma notu'], ['main.py', 'print(1)\n']]);
    assert.deepEqual(r, { over: true, highlighted: true, dropped: true, after: false });
    await app.cdp.waitFor("document.querySelectorAll('#attachments .attachment-chip').length === 2", 5000);
    assert.deepEqual(await chips(), ['notes.md', 'main.py']);
    const text = await ev("composeText()");
    assert.match(text, /--- File: notes\.md ---\n# Hello\nçalışma notu\n--- End file ---/);
    assert.match(text, /--- File: main\.py ---/);
  });

  test('unsupported, binary and too many files are refused with a message', async () => {
    await reset();
    await drop([['photo.png', [137, 80, 78, 71]]]);
    await app.cdp.waitFor("document.getElementById('toast').textContent.length > 0", 5000);
    assert.match(await lastToast(), /photo\.png/);
    assert.deepEqual(await chips(), []);
    await reset();
    await drop([['data.txt', [104, 105, 0, 1]]]);
    await app.cdp.waitFor("document.getElementById('toast').textContent.length > 0", 5000);
    assert.match(await lastToast(), /Only text and code files/);
    await reset();
    await drop([['bad.txt', [0xff, 0xfe, 0x41]]]);
    await app.cdp.waitFor("document.getElementById('toast').textContent.length > 0", 5000);
    assert.match(await lastToast(), /Only text and code files/, 'invalid UTF-8');
    await reset();
    await drop(Array.from({ length: 6 }, (_, i) => [`f${i}.txt`, 'x']));
    await app.cdp.waitFor("document.getElementById('toast').textContent.length > 0", 5000);
    assert.match(await lastToast(), /up to 5 files/);
    assert.deepEqual(await chips(), []);
  });

  test('a pasted text file is added; Turkish message', async () => {
    await reset();
    assert.equal(await drop([['query.sql', 'select 1;']], 'paste'), true);
    await app.cdp.waitFor("document.querySelectorAll('#attachments .attachment-chip').length === 1", 5000);
    await reset();
    await ev("(async () => { state.prefs = await api.preferences({ ...state.prefs, language: 'tr' }); localize(); return 0; })()");
    await drop([['clip.mp4', 'x']]);
    await app.cdp.waitFor("document.getElementById('toast').textContent.length > 0", 5000);
    assert.match(await lastToast(), /bırakılarak eklenemez/);
    await ev("(async () => { state.prefs = await api.preferences({ ...state.prefs, language: 'en' }); localize(); return 0; })()");
  });

  test('nothing is added while a reply runs', async () => {
    await reset();
    await ev("setBusy(true, 'send'); 0");
    const r = await drop([['late.txt', 'x']]);
    await ev("setBusy(false); 0");
    assert.equal(r.highlighted, false);
    await new Promise(res => setTimeout(res, 300));
    assert.deepEqual(await chips(), []);
  });
});
