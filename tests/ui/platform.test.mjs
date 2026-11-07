// Platform services through the real UI (Task 6): clipboard text and image, a document with a Turkish path, chat export through
// the save dialog (test hook), and an API key that survives switching shells. Shell chosen with LUMEN_SHELL (default electron).
//   $env:LUMEN_SHELL='tauri'; node --test tests/ui/platform.test.mjs
// The key test always uses both shells: LUMEN_SHELL=tauri runs Electron -> Tauri -> Electron, LUMEN_SHELL=electron the reverse.
// The clipboard tests write the Windows clipboard (read back with PowerShell, independent of the shell). What was on it before is
// restored afterwards: an image (kept in <run>/clipboard-backup.png), text, or an empty clipboard.
// No model is needed: the conversation is seeded. Test data goes to <work>/ui-tests/platform-<shell>-<run>.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { launch, workRoot } from '../harness/launch.mjs';
import { prepareData } from './data.mjs';
import { electronSecret } from '../fixtures/electron-secret.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const other = shell === 'tauri' ? 'electron' : 'tauri';
const runDir = path.join(workRoot, 'ui-tests', `platform-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data');
const filesDir = path.join(runDir, 'files');
const saveDir = path.join(runDir, 'saved');
const turkishPdf = path.join(filesDir, 'Şubat raporu.pdf');

// ---------- Windows clipboard, read with PowerShell (STA for Windows Forms) ----------
function ps(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' + script], { encoding: 'utf8' });
}
const clipboardText = () => ps('Add-Type -AssemblyName System.Windows.Forms;[Console]::Out.Write([Windows.Forms.Clipboard]::GetText())');
const clipboardImage = () => ps("Add-Type -AssemblyName System.Windows.Forms;$i=[Windows.Forms.Clipboard]::GetImage();if($i){[Console]::Out.Write(\"$($i.Width)x$($i.Height)\")}else{[Console]::Out.Write('none')}");
const setClipboardText = text => ps(`Add-Type -AssemblyName System.Windows.Forms;[Windows.Forms.Clipboard]::SetText([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(text, 'utf8').toString('base64')}')))`);

// ---------- Fixtures ----------
function png(width, height) {
  const crcOf = buf => zlib.crc32(buf) >>> 0;
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crcOf(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const o = y * (width * 4 + 1) + 1 + x * 4; raw[o] = x % 256; raw[o + 1] = y % 256; raw[o + 2] = 160; raw[o + 3] = 255; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// A one-page PDF with real text (pdf.js reads it), xref offsets computed.
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
const CHAT_ID = crypto.randomBytes(16).toString('hex');
const REPLY = 'Kopyalanacak yanıt: Şubat ğüşiöç İı 😀 — copy ok';
const IMAGE = { width: 640, height: 384 };
function seed(dir) {
  prepareData(dir, null);
  fs.mkdirSync(path.join(dir, 'chats'), { recursive: true });
  const chat = { Id: CHAT_ID, Title: 'Platform test', Model: 'Test model', SystemPrompt: '', Updated: new Date().toISOString(),
    Messages: [{ Role: 'user', Content: 'Merhaba', Interrupted: false }, { Role: 'assistant', Content: REPLY, Interrupted: false }] };
  fs.writeFileSync(path.join(dir, 'chats', CHAT_ID + '.json'), '﻿' + JSON.stringify(chat), 'utf8');
  const image = png(IMAGE.width, IMAGE.height), sha = crypto.createHash('sha256').update(image).digest('hex');
  fs.mkdirSync(path.join(dir, 'generated'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'generated', sha + '.png'), image);
  fs.writeFileSync(path.join(dir, 'conversation-generated.json'), JSON.stringify({ [CHAT_ID]: { 1: { images: [{ sha, ...IMAGE }], prompt: 'test picture', negative: '', model: 'test', label: 'Test image', engine: 'local', shape: 'landscape', steps: 4, seed: 1, seconds: 1 } } }));
  return sha;
}

// Clipboard backup: {kind:'image'|'text'|'empty'|'other', text?}. 'other' (files, HTML only...) cannot be put back and is left alone.
function backupClipboard(file) {
  const kind = ps(`Add-Type -AssemblyName System.Windows.Forms,System.Drawing;$c=[Windows.Forms.Clipboard];if($c::ContainsImage()){$i=$c::GetImage();$i.Save('${file.replace(/'/g, "''")}',[Drawing.Imaging.ImageFormat]::Png);$i.Dispose();[Console]::Out.Write('image')}elseif($c::ContainsText()){[Console]::Out.Write('text')}elseif(-not ($d=$c::GetDataObject()) -or $d.GetFormats().Count -eq 0){[Console]::Out.Write('empty')}else{[Console]::Out.Write('other')}`);
  return kind === 'text' ? { kind, text: clipboardText() } : { kind };
}
function restoreClipboard(backup, file) {
  if (backup.kind === 'image') ps(`Add-Type -AssemblyName System.Windows.Forms,System.Drawing;$i=[Drawing.Image]::FromFile('${file.replace(/'/g, "''")}');[Windows.Forms.Clipboard]::SetImage($i);$i.Dispose()`);
  else if (backup.kind === 'text') setClipboardText(backup.text);
  else if (backup.kind === 'empty') ps('Add-Type -AssemblyName System.Windows.Forms;[Windows.Forms.Clipboard]::Clear()');
}

let app, savedClipboard = null;
const clipboardBackupFile = path.join(runDir, 'clipboard-backup.png');
const shot = name => app?.cdp.screenshot(path.join(runDir, name + '.png')).catch(() => {});

describe(`platform (${shell})`, () => {
  before(async () => {
    seed(dataDir);
    fs.mkdirSync(filesDir, { recursive: true }); fs.mkdirSync(saveDir, { recursive: true });
    fs.writeFileSync(turkishPdf, pdf('Lumen test belgesi: Subat raporu, 2026.'));
    try { savedClipboard = backupClipboard(clipboardBackupFile); } catch {}
    app = await launch({ shell, dataDir, env: { LUMEN_TEST_FILES: JSON.stringify([turkishPdf]), LUMEN_TEST_SAVE_DIR: saveDir } });
    await app.cdp.waitFor('state.ready === true', 30000);
    // Open the seeded conversation from the history list.
    await app.cdp.waitFor("[...document.querySelectorAll('#history .history-item')].some(b => b.title === 'Platform test')", 15000);
    await app.cdp.evaluate("[...document.querySelectorAll('#history .history-item')].find(b => b.title === 'Platform test').click(); 0");
    await app.cdp.waitFor(`state.chat?.Id === '${CHAT_ID}' && document.querySelectorAll('.message.assistant').length === 1`, 15000);
  });
  after(async () => {
    await app?.stop();
    if (savedClipboard) { try { restoreClipboard(savedClipboard, clipboardBackupFile); } catch {} }
  });

  // No plugin init script reaches the page: alert/confirm stay the browser's own (tauri-plugin-dialog would replace them, and its
  // async confirm would always be truthy in the browser panel).
  test('no dialog plugin script in the page', async () => {
    const r = await app.cdp.evaluate("({alert: String(window.alert), confirm: String(window.confirm), prompt: String(window.prompt), async: window.confirm.constructor.name})");
    assert.match(r.alert, /\[native code\]/);
    assert.match(r.confirm, /\[native code\]/);
    assert.match(r.prompt, /\[native code\]/);
    assert.equal(r.async, 'Function');
  });

  test('copy text', async () => {
    setClipboardText('sentinel-before-copy');
    await app.cdp.evaluate("document.querySelector('.message.assistant .message-actions button').click(); 0");
    let text = '';
    for (let i = 0; i < 25 && text !== REPLY; i++) { await new Promise(r => setTimeout(r, 200)); text = clipboardText(); }
    assert.equal(text, REPLY);
  });

  test('copy generated image', async () => {
    setClipboardText('sentinel-before-image');
    await app.cdp.waitFor("!!document.querySelector('.gen-actions')", 10000);
    await app.cdp.evaluate("document.querySelectorAll('.gen-actions button')[1].click(); 0");
    let size = 'none';
    for (let i = 0; i < 25 && size === 'none'; i++) { await new Promise(r => setTimeout(r, 200)); size = clipboardImage(); }
    assert.equal(size, `${IMAGE.width}x${IMAGE.height}`);
    assert.deepEqual(app.cdp.errors, [], 'console errors: ' + app.cdp.errors.join(' | '));
  });

  // clipboard.read -> image.normalize (long side 1600, 'best') -> image.thumbnail (160): the photo path of Ctrl+V.
  test('paste a photo', async () => {
    const source = path.join(filesDir, 'paste-source.png');
    fs.writeFileSync(source, png(2000, 1000));
    ps(`Add-Type -AssemblyName System.Windows.Forms,System.Drawing;$i=[Drawing.Image]::FromFile('${source.replace(/'/g, "''")}');[Windows.Forms.Clipboard]::SetImage($i);$i.Dispose()`);
    const items = await app.cdp.evaluate("window.lumen.photos('paste', {language: 'en'})");
    assert.equal(items.length, 1);
    const size = file => { const b = fs.readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
    assert.deepEqual(size(path.join(dataDir, 'images', items[0].id + '.png')), [1600, 800]);
    assert.deepEqual(size(path.join(dataDir, 'images', items[0].id + '-thumb.png')), [160, 80]);
    const left = fs.existsSync(path.join(dataDir, 'temp', 'clipboard')) ? fs.readdirSync(path.join(dataDir, 'temp', 'clipboard')) : [];
    assert.deepEqual(left, [], 'the clipboard temp file was removed');
  });

  test('attach document with Turkish path', async () => {
    const { cdp } = app;
    await cdp.evaluate("document.getElementById('attach-docs').click(); 0"); // "+ → Documents"; the test hook answers the dialog
    await cdp.waitFor("!!document.querySelector('.docs-chip .project-chip-open')", 60000);
    assert.equal(await cdp.evaluate("document.querySelector('.docs-chip .project-chip-open').title"), 'Şubat raporu.pdf');
    const listed = await cdp.evaluate(`window.lumen.documents('list', {chatId: '${CHAT_ID}'})`);
    assert.deepEqual(listed.map(d => [d.name, d.kind, d.pages]), [['Şubat raporu.pdf', 'pdf', 1]]);
    await shot('document');
  });

  test('export chat', async () => {
    const target = path.join(saveDir, 'lumen-chat.md');
    await app.cdp.evaluate("document.getElementById('export-chat').click(); 0");
    for (let i = 0; i < 50 && !fs.existsSync(target); i++) await new Promise(r => setTimeout(r, 100));
    const text = fs.readFileSync(target, 'utf8');
    assert.match(text, /^# Platform test/);
    assert.ok(text.includes(REPLY), 'the reply is in the export');
  });

  // Task 10: the Tauri build only checks for updates (note in both languages, no download/install button); Electron keeps them.
  test('updates section: check-only note (Tauri) / full mode (Electron)', async () => {
    const { cdp } = app;
    await cdp.click('[data-page="settings"]');
    await cdp.waitFor("!!document.querySelector('#update-section') && !!document.querySelector('#update-status')", 10000);
    const setLanguage = async code => {
      const index = await cdp.evaluate(`[...document.querySelector('#language').options].findIndex(o=>o.value==='${code}')`);
      await cdp.click(`#language + .segmented button:nth-child(${index + 1})`);
      await cdp.waitFor(`state.prefs.language==='${code}'`, 5000);
    };
    const section = () => cdp.evaluate("({text: document.querySelector('#update-box').textContent, mode: updateState?.mode, download: document.querySelector('#update-download').hidden, install: document.querySelector('#update-install').hidden, version: document.querySelector('#update-version').textContent})");
    await setLanguage('en');
    let r = await section();
    if (shell === 'tauri') {
      assert.equal(r.mode, 'check-only');
      assert.match(r.text, /This preview build can't install updates./);
      assert.equal(r.download, true);
      assert.equal(r.install, true);
      await setLanguage('tr');
      r = await section();
      assert.match(r.text, /Bu önizleme sürümü güncellenemez./);
      assert.equal(r.download, true);
      assert.equal(r.install, true);
      await setLanguage('en');
    } else {
      assert.notEqual(r.mode, 'check-only');
      assert.doesNotMatch(r.text, /preview build/);
    }
  });
});

// ---------- An API key saved in one shell opens in the other (Electron safeStorage format, spec §7) ----------
describe(`secret survives shell switch (${other} -> ${shell} -> ${other})`, () => {
  const keyDir = path.join(runDir, 'switch', 'data');
  // Electron's userData in tests (tests/harness/launch.mjs); the Tauri test build is given the same folder.
  const profile = keyDir + '-profile';
  const FIRST = 'tvly-first-' + crypto.randomBytes(6).toString('hex');
  const SECOND = 'tvly-second-' + crypto.randomBytes(6).toString('hex');
  let current;
  after(async () => { await current?.stop(); });

  async function openSearchSettings(name) {
    current = await launch({ shell: name, dataDir: keyDir });
    await current.cdp.waitFor('state.ready === true', 30000);
    await current.cdp.evaluate("openSettings('search'); 0");
    await current.cdp.waitFor("!document.getElementById('search-panel').hidden && !!toolsConfig", 15000);
    if (await current.cdp.evaluate("document.getElementById('search-provider').value") !== 'tavily') {
      await current.cdp.evaluate("const s=document.getElementById('search-provider');s.value='tavily';s.onchange(); 0");
      await current.cdp.waitFor("toolsConfig.search.provider === 'tavily' && !document.getElementById('search-key-row').hidden", 10000);
    }
    return current.cdp;
  }
  async function saveKey(cdp, key) {
    await cdp.evaluate(`document.getElementById('search-key').value=${JSON.stringify(key)};document.getElementById('search-key-form').requestSubmit(); 0`);
    await cdp.waitFor("toolsConfig.search.keys.tavily === true && !document.getElementById('search-key-clear').hidden", 10000);
  }
  const stored = () => JSON.parse(fs.readFileSync(path.join(keyDir, 'tools-settings.json'), 'utf8')).keys.tavily;
  const isStored = cdp => cdp.evaluate("toolsConfig.encryption === true && toolsConfig.search.keys.tavily === true && document.getElementById('search-key-status').textContent === t('keyStored')");

  test('saved in one shell, read and changed in the other, opened again in the first', async () => {
    seed(keyDir);
    let cdp = await openSearchSettings(other);
    await saveKey(cdp, FIRST);
    await current.stop(); current = null;
    const first = stored();
    assert.equal(Buffer.from(first, 'base64').subarray(0, 3).toString(), 'v10');
    const localState = fs.readFileSync(path.join(profile, 'Local State'), 'utf8');
    const key = JSON.parse(localState).os_crypt.encrypted_key;
    assert.equal(Buffer.from(key, 'base64').subarray(0, 5).toString(), 'DPAPI');
    assert.equal(electronSecret('decrypt', first, profile).value, FIRST, 'Electron safeStorage opens the first value');

    cdp = await openSearchSettings(shell);
    assert.equal(await isStored(cdp), true, `${shell} shows the key saved by ${other} as stored`);
    await saveKey(cdp, SECOND);
    await current.stop(); current = null;
    const second = stored();
    assert.notEqual(second, first);
    assert.equal(Buffer.from(second, 'base64').subarray(0, 3).toString(), 'v10');
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'Local State'), 'utf8')).os_crypt.encrypted_key, key, 'the shared key was kept');
    assert.equal(electronSecret('decrypt', second, profile).value, SECOND, `Electron safeStorage opens the value written by ${shell}`);

    cdp = await openSearchSettings(other);
    assert.equal(await isStored(cdp), true, `${other} shows the changed key as stored`);
    assert.equal(stored(), second, 'opening settings does not rewrite the key');
  });
});
