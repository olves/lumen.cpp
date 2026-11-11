// v1.2 in the real app: a scanned PDF (only a picture of text) is read with Windows OCR when attached, the documents dialog says so,
// and the answer is grounded on the OCR text. Real: lumen-image-ocr.exe --pdf, the document pipeline, the chat model (if installed).
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/scanned.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, workRoot } from '../harness/launch.mjs';
import { ocrHelper } from '../harness/ocrhelper.mjs';
import { pickModel, prepareData } from './data.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `scanned-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data'), scan = path.join(runDir, 'taranmış fatura.pdf');
const model = pickModel();
let app;
const ev = e => app.cdp.evaluate(e);

describe(`scanned PDF (${shell})`, () => {
  before(async () => {
    ocrHelper();
    fs.mkdirSync(runDir, { recursive: true });
    fs.copyFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'scanned.pdf'), scan);
    prepareData(dataDir, model);
    app = await launch({ shell, dataDir, env: { LUMEN_TEST_FILES: JSON.stringify([scan]) } });
    await app.cdp.waitFor('state.ready === true', 30000);
  });
  after(async () => { await app?.stop(); });

  test('attaching it reads the page with OCR; the dialog says "read with OCR"', async () => {
    await ev("document.getElementById('attach-docs').click(); 0");
    await app.cdp.waitFor("!!document.querySelector('.docs-chip .project-chip-open')", 120000);
    const [doc] = await ev("window.lumen.documents('list', {chatId: state.chat.Id})");
    assert.equal(doc.ocr, true); assert.equal(doc.kind, 'pdf');
    await ev("document.querySelector('.docs-chip .project-chip-open').click(); 0");
    await app.cdp.waitFor("document.querySelector('#docs-dialog')?.open", 5000);
    assert.match(await ev("document.querySelector('#docs-dialog').textContent"), /read with OCR/);
    await ev("document.querySelector('#docs-dialog .icon-button').click(); 0");
  });

  test('a question is answered from the OCR text', { skip: model ? false : 'no installed model', timeout: 600000 }, async () => {
    await app.cdp.type('#prompt', 'What is the total amount on the invoice? Answer with the amount only.');
    await app.cdp.click('#send');
    await app.cdp.waitFor("state.busy === false && state.chat.Messages.at(-1)?.Role === 'assistant'", 480000);
    const last = await ev('state.chat.Messages.at(-1)');
    console.log('# reply:', String(last.Content).replace(/\s+/g, ' ').slice(0, 120));
    assert.ok((last.DocSources || []).some(s => /1250 EUR/.test(s.excerpt)), 'the excerpt given to the model holds the total');
  });
});
