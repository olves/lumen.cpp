'use strict';
// Coding agent state on disk. conversation-coding.json: per chat {allowEdits, entries (the agent transcript, codecontext.cjs
// shape), tasks [{taskId, msg, files, totals, cost, undone}]}; copied to branches up to the branch point and removed with the
// chat like the other sidecars. coding-settings.json: prices (per million tokens), task limits, deeper thinking, and the
// providers the user agreed may receive project files.
const fs = require('fs');
const path = require('path');

// tools (v1.1 built-in plugins): which agent tools are offered at all; the mode still decides what asks.
const TOOL_KEYS = ['commands', 'background', 'instructions'];
const DEFAULTS = { prices: {}, taskMoney: 0.2, taskTokens: 3000000, maxSteps: 40, deepThinking: false, consented: [], tools: { commands: true, background: true, instructions: true } };
const validId = id => typeof id === 'string' && /^[a-f0-9]{32}$/i.test(id);
const num = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;

function createCodingStore(dataDir) {
  const chatsFile = path.join(dataDir, 'conversation-coding.json'), settingsFile = path.join(dataDir, 'coding-settings.json');
  let chats = null;
  const read = (file, fallback) => { try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback; } catch { return fallback; } };
  const write = (file, value) => { const temp = file + '.tmp'; fs.writeFileSync(temp, JSON.stringify(value)); fs.renameSync(temp, file); };
  const load = () => chats ??= read(chatsFile, {});
  const save = () => write(chatsFile, chats);
  const blank = () => ({ allowEdits: false, entries: [], tasks: [] });
  const entry = chatId => { if (!validId(chatId)) throw Error('Invalid conversation.'); const all = load(); return all[chatId] ??= blank(); };

  function settings() { const saved = read(settingsFile, {}); return { ...DEFAULTS, ...saved, tools: { ...DEFAULTS.tools, ...(saved.tools && typeof saved.tools === 'object' ? saved.tools : {}) } }; }
  function saveSettings(patch = {}) {
    const next = settings();
    if ('taskMoney' in patch) { if (!num(patch.taskMoney, 0, 1000)) throw Error('Invalid task money limit.'); next.taskMoney = patch.taskMoney; }
    if ('taskTokens' in patch) { if (!num(patch.taskTokens, 0, 1e9)) throw Error('Invalid task token limit.'); next.taskTokens = Math.round(patch.taskTokens); }
    if ('maxSteps' in patch) { if (!num(patch.maxSteps, 1, 1e6)) throw Error('Invalid step limit.'); next.maxSteps = Math.min(100, Math.round(patch.maxSteps)); }
    if ('deepThinking' in patch) next.deepThinking = patch.deepThinking === true;
    if ('tools' in patch) { if (!patch.tools || typeof patch.tools !== 'object') throw Error('Invalid tools.'); for (const k of TOOL_KEYS) if (k in patch.tools) next.tools[k] = patch.tools[k] === true; }
    if ('consented' in patch) { if (!Array.isArray(patch.consented)) throw Error('Invalid consent list.'); next.consented = [...new Set(patch.consented.map(String))].slice(0, 30); }
    if ('prices' in patch) {
      const prices = {};
      for (const [key, p] of Object.entries(patch.prices || {})) {
        if (!/^[a-z0-9-]{1,40}\/[\w.:-]{1,120}$/i.test(key) || !p || ![p.input, p.output, p.cachedInput ?? p.input].every(v => num(v, 0, 10000))) throw Error('Invalid price for ' + key + '.');
        prices[key] = { input: p.input, cachedInput: p.cachedInput ?? p.input, output: p.output, currency: /^[A-Z]{3}$/.test(p.currency) ? p.currency : 'USD' };
      }
      next.prices = prices;
    }
    write(settingsFile, next); return next;
  }

  return {
    settings, saveSettings,
    get(chatId) { return validId(chatId) ? JSON.parse(JSON.stringify(load()[chatId] || blank())) : blank(); },
    setAllowEdits(chatId, on) { entry(chatId).allowEdits = on === true; save(); },
    appendEntries(chatId, list) { entry(chatId).entries.push(...list); save(); },
    replaceEntries(chatId, list) { entry(chatId).entries = list; save(); },
    addTask(chatId, task) { const e = entry(chatId); e.tasks.push({ undone: false, ...task }); e.tasks = e.tasks.slice(-200); save(); },
    markUndone(chatId, taskId) { const t = entry(chatId).tasks.find(x => x.taskId === taskId); if (t) { t.undone = true; save(); } },
    branch(from, to, count) {
      const all = load(); if (!all[from] || !validId(to)) return;
      const src = all[from];
      all[to] = { allowEdits: src.allowEdits, entries: src.entries.filter(e => !Number.isInteger(e.msg) || e.msg < count), tasks: src.tasks.filter(t => t.msg < count) };
      save();
    },
    forget(chatId) { const all = load(); if (all[chatId]) { delete all[chatId]; save(); } },
  };
}

module.exports = { createCodingStore, DEFAULTS };
