'use strict';
// Per-reply generation numbers, shown under each answer and used for "Continue": tokens generated, seconds from the first
// token to the last, seconds to the first token (includes loading the model), tokens per second, and whether the reply hit
// the response length (cut). Stored in conversation-stats.json as {chatId: {index: record}}; copied to branches and removed
// with the conversation like the other per-message sidecars. Nothing here is sent anywhere.
const fs = require('fs');
const path = require('path');

function createStatsStore(data) {
  const file = path.join(data, 'conversation-stats.json'); let cache = null;
  const validId = id => typeof id === 'string' && /^[a-f0-9]{32}$/i.test(id);
  const num = (v, max, digits = 1) => Number.isFinite(v) && v >= 0 ? Math.round(Math.min(v, max) * 10 ** digits) / 10 ** digits : null;
  function load() { if (cache) return cache; try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); if (!cache || typeof cache !== 'object' || Array.isArray(cache)) cache = {}; } catch { cache = {}; } return cache; }
  function save() { const temp = file + '.tmp'; fs.writeFileSync(temp, JSON.stringify(cache)); fs.renameSync(temp, file); }
  // Builds a record from timestamps (ms) and the token count the engine or provider reported.
  function measure({ started, first, last, tokens, limit, cut }) {
    const n = Number.isInteger(tokens) && tokens > 0 ? tokens : null;
    const span = first && last && last > first ? (last - first) / 1000 : null;
    return {
      tokens: n,
      seconds: num(span, 36000),
      firstTokenSeconds: first && started && first >= started ? num((first - started) / 1000, 36000) : null,
      perSecond: n && n > 1 && span && span > 0.05 ? num((n - 1) / span, 100000) : null,
      cut: cut === true || (cut !== false && !!n && Number.isInteger(limit) && limit > 0 && n >= limit),
    };
  }
  return {
    measure,
    record(chatId, index, value) {
      if (!validId(chatId) || !Number.isInteger(index) || index < 0 || index > 2000 || !value || typeof value !== 'object') throw Error('Invalid stats record.');
      const clean = { tokens: Number.isInteger(value.tokens) && value.tokens > 0 ? value.tokens : null, seconds: num(value.seconds, 36000), firstTokenSeconds: num(value.firstTokenSeconds, 36000), perSecond: num(value.perSecond, 100000), cut: value.cut === true };
      if (!clean.tokens && clean.seconds == null) return null;
      const all = load(); all[chatId] = { ...(all[chatId] || {}), [index]: clean }; save(); return clean;
    },
    remove(chatId, index) { const all = load(); if (all[chatId] && all[chatId][index]) { delete all[chatId][index]; save(); } },
    decorate(chat) {
      if (!chat || !validId(chat.Id) || !Array.isArray(chat.Messages)) return chat;
      const entry = load()[chat.Id]; if (!entry) return chat;
      return { ...chat, Messages: chat.Messages.map((m, i) => entry[i] && m.Role === 'assistant' ? { ...m, Stats: entry[i] } : m) };
    },
    branch(from, to, count) { const all = load(); if (!all[from]) return; const copy = {}; for (const [i, v] of Object.entries(all[from])) if (Number(i) < count) copy[i] = v; if (Object.keys(copy).length) { all[to] = copy; save(); } },
    forget(id) { const all = load(); if (all[id]) { delete all[id]; save(); } },
  };
}

module.exports = { createStatsStore };
