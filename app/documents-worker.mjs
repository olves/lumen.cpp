// PDF text extraction off the main thread with pdf.js (vendor/pdfjs, Apache-2.0). Input: {file}. Output: {pages:[text], title}
// or {error}. Fonts are not loaded and scripts in the PDF are never run; only the text layer is read.
import {parentPort, workerData} from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_PAGES = 2000, MAX_CHARS = 4_000_000;
try {
  const pdfjs = await import(pathToFileURL(path.join(here, 'vendor', 'pdfjs', 'pdf.mjs')).href);
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(here, 'vendor', 'pdfjs', 'pdf.worker.mjs')).href;
  const data = new Uint8Array(fs.readFileSync(workerData.file));
  const task = pdfjs.getDocument({data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false, verbosity: 0}), doc = await task.promise;
  if (doc.numPages > MAX_PAGES) throw Error('too-many-pages');
  const pages = []; let chars = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i), content = await page.getTextContent();
    let text = '';
    for (const item of content.items) { if (typeof item.str !== 'string') continue; text += item.str; if (item.hasEOL) text += '\n'; else if (item.str && !/\s$/.test(item.str)) text += ' '; }
    text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
    chars += text.length; if (chars > MAX_CHARS) throw Error('too-much-text');
    pages.push(text); page.cleanup();
  }
  let title = null; try { title = (await doc.getMetadata())?.info?.Title || null; } catch {}
  await task.destroy();
  parentPort.postMessage({pages, title});
} catch (e) {
  const message = String(e?.message || e);
  parentPort.postMessage({error: /password/i.test(message) ? 'password' : /too-many-pages|too-much-text/.test(message) ? message : 'unreadable', detail: message.slice(0, 300)});
}
