'use strict';
// Run settings per conversation (conversation-run.json): only what the user changed for that chat is stored; everything else
// comes from the defaults (Settings → Chat behavior plus the advanced sampling defaults in desktop-preferences.json "sampling").
// Sampling values left unset are not sent, so llama.cpp and the model keep their own defaults.
const fs = require('fs'), path = require('path');

const RESPONSE_TOKENS = [512, 1024, 2048, 4096];
const CREATIVITY = {precise: 0.2, balanced: 0.7, creative: 1.0};
// [key, min, max, integer]
const SAMPLING = [['temperature', 0, 2, false], ['topP', 0, 1, false], ['topK', 0, 500, true], ['minP', 0, 1, false],
  ['repeatPenalty', 0.5, 2, false], ['presencePenalty', -2, 2, false], ['frequencyPenalty', -2, 2, false], ['seed', -1, 2147483647, true]];
const ID = /^[a-fA-F0-9]{32}$/;

// Keeps valid known keys only; null/undefined removes a key ("use the default").
function clean(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [key, min, max, integer] of SAMPLING) {
    const v = input[key];
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw Error('Invalid ' + key + '.');
    out[key] = integer ? n : Math.round(n * 1000) / 1000;
  }
  if (typeof input.thinking === 'boolean') out.thinking = input.thinking;
  if (input.responseTokens !== undefined && input.responseTokens !== null) {
    if (!RESPONSE_TOKENS.includes(Number(input.responseTokens))) throw Error('Invalid response length.');
    out.responseTokens = Number(input.responseTokens);
  }
  return out;
}

function createRunSettings(dataDir) {
  const file = path.join(dataDir, 'conversation-run.json');
  let cache = null;
  function load() {
    if (cache) return cache;
    try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); cache = data && typeof data.chats === 'object' ? data : {version: 1, chats: {}}; }
    catch { cache = {version: 1, chats: {}}; }
    return cache;
  }
  function save() { const temp = file + '.tmp'; fs.writeFileSync(temp, JSON.stringify(cache)); fs.renameSync(temp, file); }
  function check(id) { if (typeof id !== 'string' || !ID.test(id)) throw Error('Invalid conversation ID.'); }

  // Defaults from the preferences: thinking, response length and creativity, plus prefs.sampling.
  function defaults(p) {
    const sampling = (() => { try { return clean(p.sampling); } catch { return {}; } })();
    delete sampling.thinking; delete sampling.responseTokens;
    return {
      thinking: p.thinking === true,
      responseTokens: RESPONSE_TOKENS.includes(p.responseTokens) ? p.responseTokens : 512,
      temperature: sampling.temperature ?? CREATIVITY[p.creativity] ?? 0.7,
      ...Object.fromEntries(Object.entries(sampling).filter(([k]) => k !== 'temperature')),
    };
  }
  function overrides(id) { return {...(load().chats[id] || {})}; }
  // What the next reply in this chat uses.
  function effective(id, p) { return {...defaults(p), ...(ID.test(id || '') ? overrides(id) : {})}; }
  function set(id, values) {
    check(id); const next = clean(values); load();
    if (Object.keys(next).length) cache.chats[id] = next; else delete cache.chats[id];
    save(); return overrides(id);
  }
  function reset(id) { check(id); load(); delete cache.chats[id]; save(); }
  function branch(from, to) { if (!ID.test(from || '') || !ID.test(to || '')) return; load(); if (cache.chats[from]) { cache.chats[to] = {...cache.chats[from]}; save(); } }
  function remove(id) { if (!ID.test(id || '')) return; load(); if (cache.chats[id]) { delete cache.chats[id]; save(); } }
  // The engine's request fields: temperature and the sampling object (only keys that are set).
  function request(settings) {
    const sampling = {};
    for (const [key] of SAMPLING) if (key !== 'temperature' && settings[key] !== undefined) sampling[key] = settings[key];
    return {temperature: settings.temperature, sampling};
  }
  return {defaults, overrides, effective, set, reset, branch, remove, request};
}

// Preferences "sampling": the advanced defaults for new chats ("Use for new chats").
function cleanDefaults(value) {
  const out = clean(value); delete out.thinking; delete out.responseTokens; return out;
}

module.exports = {createRunSettings, cleanDefaults, clean, RESPONSE_TOKENS, CREATIVITY, SAMPLING};
