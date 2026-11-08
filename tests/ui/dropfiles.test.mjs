// Text and code files dropped on (or pasted into) the composer join the draft with the + menu's rules. The drop is built in the
// page with DataTransfer + DragEvent, the same objects a real drag delivers. No model is needed.
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/dropfiles.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
// A one-page PDF with real text (same shape as documents.test.mjs).
function pdf(text) {
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let out = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
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
    await drop([['movie.mp4', 'x']]);
    await app.cdp.waitFor("document.getElementById('toast').textContent.length > 0", 5000);
    assert.match(await lastToast(), /movie\.mp4/);
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
    assert.match(await lastToast(), /“clip.mp4” eklenemez/);
    await ev("(async () => { state.prefs = await api.preferences({ ...state.prefs, language: 'en' }); localize(); return 0; })()");
  });

  test('a dropped PNG becomes a photo of the draft', async () => {
    await reset();
    // A real PNG made in the page (canvas), dropped like a file from the desktop.
    await ev(`(async () => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 32; const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 32); g.fillStyle = '#000'; g.fillText('Hi', 10, 20);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'shot.png', { type: 'image/png' }));
      document.querySelector('.composer').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      return 0; })()`);
    await app.cdp.waitFor("document.querySelectorAll('#photo-attachments .photo-card').length === 1", 30000);
    assert.equal(await ev('draftPhotos.length'), 1);
    assert.deepEqual(await chips(), [], 'not added as a text file');
  });

  // The first toast of a document drop is the "Reading <name>…" progress line; the result replaces it.
  const readDone = "(t => t.length > 0 && !/…$/.test(t))(document.getElementById('toast').textContent)";
  test('a dropped PDF is read as a document of the conversation; the temporary copy is removed', async () => {
    await reset();
    await drop([['takvim.pdf', [...pdf('The library opens at eight on Tuesday.')]]]);
    await app.cdp.waitFor(readDone, 30000);
    const names = () => ev("api.documents('list', { chatId: state.chat.Id }).then(l => l.map(d => d.name))");
    assert.match(await lastToast(), /added|eklendi/i, await lastToast());
    assert.deepEqual(await names(), ['takvim.pdf']);
    const tempDrop = path.join(dataDir, 'temp', 'drop');
    assert.deepEqual(fs.existsSync(tempDrop) ? fs.readdirSync(tempDrop) : [], [], 'no temporary copy left');
    // A file that only claims to be a PDF is reported, not attached.
    await reset();
    await drop([['bozuk.pdf', 'not a pdf']]);
    await app.cdp.waitFor(readDone, 30000);
    assert.deepEqual(await names(), ['takvim.pdf']);
    assert.deepEqual(fs.existsSync(tempDrop) ? fs.readdirSync(tempDrop) : [], []);
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
