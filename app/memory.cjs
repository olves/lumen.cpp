'use strict';
// Lasting memory (v1.2, ROADMAP-v1.2.md M6-E): short facts the user asked Lumen to remember, added only after the user approves
// them, shown and edited in Settings → Memory. memory.json {version:1, items:[{id, text, created}]}, at most MAX items of TEXT
// characters. promptText() is what the model gets (core: always for local models, for cloud models only when the user allows).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX = 60, TEXT = 300, PROMPT_CHARS = 3000;
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

function createMemory(dataDir) {
  const file = path.join(dataDir, 'memory.json');
  let items = null;
  const load = () => {
    if (items) return items;
    try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); items = Array.isArray(v?.items) ? v.items.filter(x => x && /^[a-f0-9]{8}$/.test(x.id) && typeof x.text === 'string' && x.text.trim()).slice(0, MAX) : []; }
    catch { items = []; }
    return items;
  };
  const save = () => { const temp = file + '.tmp'; fs.writeFileSync(temp, JSON.stringify({ version: 1, items: load() }, null, 1)); fs.renameSync(temp, file); };
  const check = text => { const t = clean(text); if (!t) throw Object.assign(Error('Write something to remember.'), { code: 'empty' }); if (t.length > TEXT) throw Object.assign(Error(`A memory can be at most ${TEXT} characters.`), { code: 'long' }); return t; };

  return {
    list: () => load().map(x => ({ ...x })),
    add(text) {
      const t = check(text), all = load();
      // Case-insensitive in both languages: Turkish lower-cases "I" to "ı", English to "i".
      const fold = s => s.toLocaleLowerCase('tr-TR').replace(/ı/g, 'i');
      const same = all.find(x => fold(x.text) === fold(t));
      if (same) return { ...same, duplicate: true };
      if (all.length >= MAX) throw Object.assign(Error(`Memory is full (${MAX} items). Remove one first.`), { code: 'full' });
      const item = { id: crypto.randomBytes(4).toString('hex'), text: t, created: new Date().toISOString() };
      all.push(item); save(); return { ...item };
    },
    update(id, text) { const item = load().find(x => x.id === id); if (!item) throw Error('Memory not found.'); item.text = check(text); save(); return { ...item }; },
    remove(id) { const all = load(), i = all.findIndex(x => x.id === id); if (i >= 0) { all.splice(i, 1); save(); } return i >= 0; },
    clear() { items = []; save(); },
    // Oldest first (stable for provider caches until the list changes), cut at PROMPT_CHARS.
    promptText() {
      const all = load(); if (!all.length) return '';
      let out = 'The user asked Lumen to remember these about them (use them when relevant; never mention this list unless asked):';
      for (const x of all) { const line = '\n- ' + x.text; if (out.length + line.length > PROMPT_CHARS) break; out += line; }
      return out;
    },
  };
}

// "Remember: …", "Remember that …", "Bunu hatırla: …", "Hatırla: …", "…, bunu hatırla" -> the fact, or null.
function rememberRequest(text) {
  const s = clean(text);
  let m = /^(?:please\s+)?remember(?:\s+that)?\s*[:,-]?\s+(.{3,})$/i.exec(s) || /^(?:lütfen\s+)?(?:bunu\s+)?hatırla(?:r\s+mısın)?\s*[:,-]\s*(.{3,})$/i.exec(s);
  if (m) return m[1].replace(/[.!]+$/, '').slice(0, TEXT);
  m = /^(.{3,}?)[,.]?\s+(?:bunu\s+)?(?:lütfen\s+)?hatırla[.!]?$/i.exec(s);
  return m ? m[1].slice(0, TEXT) : null;
}

module.exports = { createMemory, rememberRequest, MAX, TEXT };
