'use strict';
// Assistants (assistants.json): saved starting points for a conversation — instructions, an optional model, run settings and
// skills. Starting a chat with an assistant copies these into that chat (its instructions, run settings and skill
// selection), so changing the chat later never changes the assistant, and editing the assistant never rewrites old chats.
// conversation-assistants.json remembers which assistant a chat started from (shown as a chip; copied to branches).
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {clean} = require('./runsettings.cjs');

const ID = /^[a-f0-9]{12}$/, CHAT = /^[a-fA-F0-9]{32}$/;
const STARTERS = [
  {id: 'a0000000000a', name: 'Translator', description: 'Translates between Turkish and English, keeping tone and formatting.',
    instructions: 'You are a careful translator. If the text is Turkish, translate it into natural English; otherwise translate it into natural Turkish. Keep the meaning, tone, formatting, names and numbers. Reply with the translation only, unless the user asks a question about it.',
    run: {temperature: 0.2}},
  {id: 'a0000000000b', name: 'Writing editor', description: 'Improves clarity and flow without changing what you mean.',
    instructions: 'You are an editor. Improve the clarity, grammar and flow of the text the user gives you while keeping their meaning, voice and language. Return the edited text first, then at most three short notes on the most important changes.',
    run: {temperature: 0.4}},
  {id: 'a0000000000c', name: 'Study tutor', description: 'Explains step by step and checks understanding.',
    instructions: 'You are a patient tutor. Explain ideas step by step in the user\'s language, using small examples. Ask one short question at the end to check understanding. Today is {{current_date}}.',
    run: {temperature: 0.6, responseTokens: 1024}},
];
function short(text, n) { text = String(text || '').trim(); return text.length > n ? text.slice(0, n) : text; }

function sanitize(a) {
  if (!a || typeof a !== 'object') throw Error('Invalid assistant.');
  const name = short(String(a.name || '').replace(/\s+/g, ' '), 60);
  if (!name) throw Error('Give the assistant a name.');
  const instructions = String(a.instructions || '');
  if (instructions.length > 12000) throw Error('Instructions can be at most 12,000 characters.');
  const model = typeof a.model === 'string' && a.model.length <= 200 ? a.model : '';
  const skillIds = (Array.isArray(a.skillIds) ? a.skillIds : []).filter(id => typeof id === 'string' && id.length <= 80).slice(0, 4);
  // Tools the assistant asks for (an MCP server's tool, or Lumen's own create_image). Requests only: starting the assistant
  // offers to turn them on; it never turns them on by itself.
  const tools = (Array.isArray(a.tools) ? a.tools : []).filter(t => t && typeof t.server === 'string' && /^(lumen|[a-f0-9]{12})$/.test(t.server) && typeof t.name === 'string' && /^[A-Za-z0-9_.\-\/]{1,128}$/.test(t.name)).slice(0, 16).map(t => ({server: t.server, name: t.name}));
  const plugin = typeof a.plugin === 'string' && /^[a-z0-9][a-z0-9-]{1,39}$/.test(a.plugin) ? a.plugin : undefined;
  return {id: ID.test(a.id || '') ? a.id : crypto.randomBytes(6).toString('hex'), name, description: short(String(a.description || '').replace(/\s+/g, ' '), 200), instructions, model, run: clean(a.run || {}), skillIds, tools, ...(plugin ? {plugin} : {}),
    created: typeof a.created === 'string' ? a.created.slice(0, 40) : new Date().toISOString(), updated: new Date().toISOString()};
}

function createAssistants(dataDir) {
  const file = path.join(dataDir, 'assistants.json'), linkFile = path.join(dataDir, 'conversation-assistants.json');
  let cache = null, links = null;
  function load() {
    if (cache) return cache;
    try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); cache = Array.isArray(data?.assistants) ? data.assistants.map(a => { try { return {...sanitize(a), updated: a.updated || new Date().toISOString()}; } catch { return null; } }).filter(Boolean) : null; } catch { cache = null; }
    if (!cache) { cache = STARTERS.map(s => ({...sanitize(s), created: '2026-10-12T00:00:00.000Z', updated: '2026-10-12T00:00:00.000Z'})); save(); }
    return cache;
  }
  function save() { const temp = file + '.tmp'; fs.writeFileSync(temp, JSON.stringify({version: 1, assistants: cache}, null, 1)); fs.renameSync(temp, file); }
  function loadLinks() { if (links) return links; try { links = JSON.parse(fs.readFileSync(linkFile, 'utf8')); if (!links || typeof links !== 'object' || Array.isArray(links)) links = {}; } catch { links = {}; } return links; }
  function saveLinks() { const temp = linkFile + '.tmp'; fs.writeFileSync(temp, JSON.stringify(links)); fs.renameSync(temp, linkFile); }

  return {
    list() { return load().map(a => ({...a})); },
    get(id) { return load().find(a => a.id === id) || null; },
    upsert(input) {
      const next = sanitize(input); const list = load(); const i = list.findIndex(a => a.id === next.id);
      if (i >= 0) list[i] = {...next, created: list[i].created}; else { if (list.length >= 50) throw Error('At most 50 assistants.'); list.push(next); }
      save(); return next;
    },
    remove(id) { const list = load(); const i = list.findIndex(a => a.id === id); if (i < 0) throw Error('Assistant not found.'); list.splice(i, 1); save(); },
    // Which assistant a chat started from.
    link(chatId, id) { if (!CHAT.test(chatId || '')) throw Error('Invalid conversation ID.'); loadLinks(); if (id) links[chatId] = id; else delete links[chatId]; saveLinks(); },
    linked(chatId) { const id = loadLinks()[chatId]; const a = id && this.get(id); return a ? {id: a.id, name: a.name} : null; },
    decorate(chat) { if (!chat?.Id) return chat; const a = this.linked(chat.Id); return a ? {...chat, Assistant: a} : chat; },
    branch(from, to) { if (!CHAT.test(from || '') || !CHAT.test(to || '')) return; const l = loadLinks(); if (l[from]) { l[to] = l[from]; saveLinks(); } },
    forget(chatId) { const l = loadLinks(); if (l[chatId]) { delete l[chatId]; saveLinks(); } },
  };
}

module.exports = {createAssistants, sanitize, STARTERS};
