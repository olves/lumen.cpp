// Documents in a chat (+ -> Documents): a Turkish-named text file and a PDF with real text are read, chunked and handed to the model
// as numbered excerpts; the answer shows its sources; unsupported files are reported; removal and restart. Attaching a PDF with a
// Turkish path is also covered by platform.test.mjs (that test needs no model); this one adds retrieval with the real chat model.
// Real: the document pipeline (pdf.js worker, chunking, BM25), the UI, the chat model (needs one). Mock: none.
// The model's wording is not asserted (small models vary): the excerpt it was given is; whether it quoted the code is logged.
//   $env:LUMEN_SHELL='tauri'; node --test tests/ui/documents.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, workRoot } from '../harness/launch.mjs';
import { pickModel, prepareData } from './data.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `documents-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data'), filesDir = path.join(runDir, 'files');
const model = pickModel();
const NO_MODEL = model ? false : 'no installed model';
const NEEDLE = 'ÇINAR-4417';
const txt = path.join(filesDir, 'Şubat notları.txt'), pdfFile = path.join(filesDir, 'rapor.pdf'), bin = path.join(filesDir, 'ikili.dat');
let app;
const ev = e => app.cdp.evaluate(e);
const shot = n => app?.cdp.screenshot(path.join(runDir, n + '.png')).catch(() => {});

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

describe(`documents (${shell})`, () => {
  before(async () => {
    fs.mkdirSync(filesDir, { recursive: true });
    const filler = Array.from({ length: 40 }, (_, i) => `Paragraf ${i + 1}: Bu satır önemsiz bir dolgu metnidir ve kasanın şifresiyle ilgili değildir.`).join('\n\n');
    fs.writeFileSync(txt, `${filler}\n\nKasanın erişim kodu ${NEEDLE} olarak belirlendi. Kodu kimseyle paylaşmayın.\n\n${filler}`, 'utf8');
    fs.writeFileSync(pdfFile, pdf('The warehouse opens at nine on Monday.'));
    fs.writeFileSync(bin, Buffer.from([0, 1, 2, 3, 255, 254, 0, 0]));
    prepareData(dataDir, model);
    app = await launch({ shell, dataDir, env: { LUMEN_TEST_FILES: JSON.stringify([txt, pdfFile, bin]) } });
    await app.cdp.waitFor('state.ready === true', 30000);
  });
  after(async () => { await app?.stop(); });

  test('+ -> Documents reads the text file and the PDF; the unsupported file is not added', async () => {
    await ev("document.getElementById('attach-docs').click(); 0");
    await app.cdp.waitFor("!!document.querySelector('.docs-chip .project-chip-open')", 60000);
    const id = await ev('state.chat.Id');
    const listed = await ev(`window.lumen.documents('list', {chatId: ${JSON.stringify(id)}})`);
    assert.deepEqual(listed.map(d => [d.name, d.kind]).sort(), [['rapor.pdf', 'pdf'], ['Şubat notları.txt', 'txt']].sort());
    assert.match(await ev("document.querySelector('.docs-chip').textContent"), /2/);
    // The binary file was not added: the chip counts two documents. (The refusal text is shown as a toast.)
    await shot('attached');
  });

  test('the documents dialog lists both files', async () => {
    await ev("document.querySelector('.docs-chip .project-chip-open').click(); 0");
    await app.cdp.waitFor("document.querySelector('#docs-dialog')?.open", 5000);
    const names = await ev("[...document.querySelectorAll('#docs-dialog .docs-row strong')].map(n => n.textContent).sort()");
    assert.deepEqual(names, ['Şubat notları.txt', 'rapor.pdf'].sort());
    await shot('dialog');
    await ev("document.querySelector('#docs-dialog .icon-button').click(); 0");
  });

  test('a question is answered with the excerpt that holds the code', { skip: NO_MODEL, timeout: 600000 }, async () => {
    await app.cdp.type('#prompt', 'Kasanın erişim kodu nedir? Yalnızca kodu yaz.');
    await app.cdp.click('#send');
    await app.cdp.waitFor("document.querySelectorAll('.message.assistant').length >= 1", 120000);
    await app.cdp.waitFor('state.busy === false', 480000);
    const last = await ev('state.chat.Messages.at(-1)');
    assert.ok(last.DocSources?.length >= 1, 'the answer lists document sources: ' + JSON.stringify(last.DocSources));
    const withCode = last.DocSources.find(s => s.excerpt.includes(NEEDLE));
    assert.ok(withCode, 'one of the excerpts given to the model holds the code');
    assert.equal(withCode.name, 'Şubat notları.txt');
    await app.cdp.waitFor("!!document.querySelector('.message.assistant .doc-sources')", 10000);
    await shot('answer');
    const answer = await ev("document.querySelector('.message.assistant .message-body').textContent");
    console.log('# the model ' + (answer.includes(NEEDLE) ? 'quoted' : 'did not quote') + ' the code: ' + answer.slice(0, 80).replace(/\n/g, ' '));
    // The source row opens the excerpt.
    await ev("document.querySelector('.message.assistant .doc-source .source-open').click(); 0");
    await app.cdp.waitFor("document.querySelector('#docs-dialog')?.open && !!document.querySelector('#docs-dialog .doc-excerpt')", 5000);
    await ev("document.querySelector('#docs-dialog .icon-button').click(); 0");
  });

  test('the documents and the sources survive a restart', { skip: NO_MODEL }, async () => {
    await app.stop();
    app = await launch({ shell, dataDir, env: { LUMEN_TEST_FILES: JSON.stringify([txt]) } });
    await app.cdp.waitFor('state.ready === true', 30000);
    await app.cdp.click('.history-item');
    await app.cdp.waitFor("!!document.querySelector('.message.assistant .doc-sources')", 15000);
    await app.cdp.waitFor("!!document.querySelector('.docs-chip')", 15000);
  });

  test('removing a document leaves the other one', async () => {
    const id = await ev('state.chat.Id');
    const left = await ev(`window.lumen.documents('list', {chatId: ${JSON.stringify(id)}})`);
    const target = left.find(d => d.kind === 'txt');
    const after = await ev(`window.lumen.documents('remove', {chatId: ${JSON.stringify(id)}, id: ${JSON.stringify(target.id)}})`);
    assert.deepEqual(after.map(d => d.name), ['rapor.pdf']);
  });

  test('no console errors', async () => { assert.deepEqual(app.cdp.errors, []); });
});
