// v1.2 document types: Excel .xlsx and PowerPoint .pptx (zip + XML, built here in memory), and a scanned PDF read by Windows OCR
// through the real lumen-image-ocr.exe --pdf (tests/fixtures/scanned.pdf: one page that is only a picture of text).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ocrHelper } from '../harness/ocrhelper.mjs';
const { createDocuments } = createRequire(import.meta.url)('../../app/documents.cjs');
const here = path.dirname(fileURLToPath(import.meta.url));

// A minimal zip writer (deflated entries, CRC-32) so the tests need no Office files.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), data = zlib.deflateRawSync(raw), n = Buffer.from(name), crc = crc32(raw);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data); centrals.push(central, n); offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(centrals), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-doctypes-'));
  return { base, file: (name, data) => { const f = path.join(base, name); fs.writeFileSync(f, data); return f; } };
}

test('xlsx: one page per sheet with its name, shared and inline strings, numbers, empty cells kept in place', async () => {
  const s = setup(), docs = createDocuments(s.base);
  const xlsx = zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Sales" sheetId="1"/><sheet name="Notes &amp; plans" sheetId="2"/></sheets></workbook>',
    'xl/sharedStrings.xml': '<sst><si><t>Product</t></si><si><t>Price</t></si><si><r><t>Lan</t></r><r><t>tern</t></r></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>12.5</v></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Ship in May</t></is></c><c r="B1" t="b"><v>1</v></c></row></sheetData></worksheet>',
  });
  const d = await docs.add(s.file('book.xlsx', xlsx));
  assert.equal(d.kind, 'xlsx'); assert.equal(d.pages, 2);
  const stored = JSON.parse(fs.readFileSync(path.join(s.base, 'documents', d.id + '.json'), 'utf8'));
  assert.equal(stored.pages[0], 'Sheet: Sales\nProduct\tPrice\nLantern\t\t12.5');
  assert.equal(stored.pages[1], 'Sheet: Notes & plans\nShip in May\tTRUE');
});

test('pptx: one page per slide, with its notes', async () => {
  const s = setup(), docs = createDocuments(s.base);
  const slide = (...ps) => `<p:sld><p:cSld><p:spTree>${ps.map(t => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join('')}</p:spTree></p:cSld></p:sld>`;
  const pptx = zip({ 'ppt/slides/slide1.xml': slide('Quarterly plan', 'Grow by 10%'), 'ppt/slides/slide2.xml': slide('Risks'), 'ppt/notesSlides/notesSlide2.xml': slide('Say it slowly', '2') });
  const d = await docs.add(s.file('deck.pptx', pptx));
  const stored = JSON.parse(fs.readFileSync(path.join(s.base, 'documents', d.id + '.json'), 'utf8'));
  assert.deepEqual(stored.pages, ['Slide 1\nQuarterly plan\nGrow by 10%', 'Slide 2\nRisks\nNotes: Say it slowly']);
});

test('a scanned PDF (no text layer) is read with Windows OCR and marked as OCR', { timeout: 120000 }, async () => {
  const s = setup(), docs = createDocuments(s.base, { ocrHelper: ocrHelper() });
  const d = await docs.add(path.join(here, '..', 'fixtures', 'scanned.pdf'), { language: 'en' });
  assert.equal(d.ocr, true);
  const stored = JSON.parse(fs.readFileSync(path.join(s.base, 'documents', d.id + '.json'), 'utf8'));
  assert.match(stored.pages[0], /Invoice number 4471/); assert.match(stored.pages[0], /Marlow Lantern Society/);
});

test('without the OCR helper a scanned PDF still says it has no text', async () => {
  const s = setup(), docs = createDocuments(s.base);
  await assert.rejects(docs.add(path.join(here, '..', 'fixtures', 'scanned.pdf')), /no-text/);
});
