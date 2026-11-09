'use strict';
// Connections in <data>/connections.json: cloud model providers, MCP servers and the local API server. All of them are off
// until the user turns them on. Secrets (provider keys, MCP access tokens, the local API token) are encrypted with platform.secrets
// (Electron safeStorage, DPAPI on Windows), stay in the main process and are never shown to the renderer except the local API token,
// which is the user's own key for their own computer.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');

// OpenAI-compatible chat endpoints. Anthropic and Google offer OpenAI-compatible endpoints for their models.
const PROVIDERS = {
  openai: {label: 'OpenAI', base: 'https://api.openai.com/v1', keyHint: 'sk-…', site: 'platform.openai.com'},
  anthropic: {label: 'Anthropic', base: 'https://api.anthropic.com/v1', keyHint: 'sk-ant-…', site: 'console.anthropic.com'},
  gemini: {label: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', keyHint: 'AIza…', site: 'aistudio.google.com'},
  openrouter: {label: 'OpenRouter', base: 'https://openrouter.ai/api/v1', keyHint: 'sk-or-…', site: 'openrouter.ai'},
  groq: {label: 'Groq', base: 'https://api.groq.com/openai/v1', keyHint: 'gsk_…', site: 'console.groq.com'},
  mistral: {label: 'Mistral', base: 'https://api.mistral.ai/v1', keyHint: '', site: 'console.mistral.ai'},
  deepseek: {label: 'DeepSeek', base: 'https://api.deepseek.com', keyHint: 'sk-…', site: 'platform.deepseek.com'},
  custom: {label: 'Custom', base: '', keyHint: '', site: ''},
};
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:\/@+-]{0,127}$/;
// Custom (OpenAI-compatible) providers: "custom" (the first, kept for saved chats) and added ones custom2 … custom9.
const MAX_CUSTOM = 9;
const isCustom = id => /^custom([2-9])?$/.test(String(id || ''));
const knownProvider = id => Object.prototype.hasOwnProperty.call(PROVIDERS, id) || isCustom(id);
const SERVER_ID = /^[a-f0-9]{12}$/;
const TOOL_NAME = /^[A-Za-z0-9_.\-\/]{1,128}$/;
const API_PORT = 11500;

const loopback = host => host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
// https anywhere; plain http only on this computer (a local server the user runs).
function endpoint(raw, what) {
  let u; try { u = new URL(String(raw || '').trim()); } catch { throw Error('Enter a valid ' + what + ' address.'); }
  if (u.username || u.password) throw Error('Do not put a user name or password in the address.');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback(u.hostname))) throw Error('Use an https address (plain http only for this computer).');
  u.hash = ''; return u.href.replace(/\/+$/, '').slice(0, 500);
}
function short(text, n) { text = String(text || '').replace(/\s+/g, ' ').trim(); return text.length > n ? text.slice(0, n - 1) + '…' : text; }

function createConnections(data, secrets) {
  const file = path.join(data, 'connections.json');
  let cache = null;
  // platform.secrets is async (a shell may have to ask another process); every call is awaited.
  const canEncrypt = async () => { try { return !!(await secrets.available()); } catch { return false; } };
  const encrypt = async text => { if (!await canEncrypt()) throw Error('Secure storage is not available on this system, so the secret was not saved.'); return secrets.encrypt(text); };
  const decrypt = async value => { if (!value || !await canEncrypt()) return ''; try { return await secrets.decrypt(value); } catch { return ''; } };

  function sanitize(v = {}) {
    const c = v.cloud || {}, m = v.mcp || {}, a = v.api || {};
    const providers = {};
    for (const [id, p] of Object.entries(c.providers || {})) {
      if (!knownProvider(id) || !p || typeof p !== 'object') continue;
      const models = (Array.isArray(p.models) ? p.models : []).filter(x => typeof x === 'string' && MODEL_ID.test(x)).slice(0, 24);
      let base = ''; if (isCustom(id) && p.base) { try { base = endpoint(p.base, 'provider'); } catch {} }
      providers[id] = {models: [...new Set(models)], ...(isCustom(id) ? {base, label: short(p.label || 'Custom', 40)} : {})};
    }
    const keys = Object.fromEntries(Object.entries(c.keys || {}).filter(([k, x]) => knownProvider(k) && typeof x === 'string' && x.length < 8192));
    const servers = (Array.isArray(m.servers) ? m.servers : []).filter(s => s && SERVER_ID.test(s.id || '')).slice(0, 12).map(s => {
      let url = ''; try { url = endpoint(s.url, 'server'); } catch {}
      const tools = (Array.isArray(s.tools) ? s.tools : []).filter(t => t && TOOL_NAME.test(t.name || '')).slice(0, 64).map(t => ({
        name: t.name, title: short(t.title || '', 80), description: short(t.description || '', 600),
        inputSchema: t.inputSchema && typeof t.inputSchema === 'object' && JSON.stringify(t.inputSchema).length <= 16000 ? t.inputSchema : {type: 'object'},
        readOnly: t.readOnly === true, enabled: t.enabled === true, ask: t.ask !== false,
      }));
      return {id: s.id, name: short(s.name || 'Server', 60), url, enabled: s.enabled === true, token: typeof s.token === 'string' && s.token.length < 8192 ? s.token : '',
        tools, checked: typeof s.checked === 'string' ? s.checked.slice(0, 40) : '', serverName: short(s.serverName || '', 80), error: short(s.error || '', 300)};
    }).filter(s => s.url);
    const port = Number(a.port);
    return {
      version: 1,
      cloud: {enabled: c.enabled === true, consented: c.consented === true, webResearch: c.webResearch === true, providers, keys},
      mcp: {servers},
      api: {enabled: a.enabled === true, port: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : API_PORT, token: typeof a.token === 'string' && a.token.length < 8192 ? a.token : ''},
    };
  }
  function read() { if (cache) return cache; let stored = {}; try { stored = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {} cache = sanitize(stored); return cache; }
  function write() { const temp = file + '.tmp'; fs.writeFileSync(temp, JSON.stringify(cache, null, 1)); fs.renameSync(temp, file); }
  function server(id) { const s = read().mcp.servers.find(x => x.id === id); if (!s) throw Error('Unknown server.'); return s; }

  // Cloud model names as they appear in the model list and in saved chats: "cloud:<provider>/<model id>".
  const cloudName = (provider, model) => 'cloud:' + provider + '/' + model;
  function parseCloud(name) { const m = /^cloud:([a-z]+[0-9]?)\/(.+)$/.exec(String(name || '')); return m && knownProvider(m[1]) && MODEL_ID.test(m[2]) ? {provider: m[1], model: m[2]} : null; }
  function providerLabel(id) { const c = read().cloud.providers[id]; return isCustom(id) ? (c?.label || 'Custom') : PROVIDERS[id]?.label || id; }
  function baseOf(id) { return isCustom(id) ? read().cloud.providers[id]?.base || '' : PROVIDERS[id]?.base || ''; }
  // Built-in providers in their fixed order, then the added custom ones.
  function providerIds(c) { return [...Object.keys(PROVIDERS), ...Object.keys(c.cloud.providers).filter(id => isCustom(id) && id !== 'custom').sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)))]; }

  return {
    PROVIDERS, cloudName, parseCloud, providerLabel, baseOf, isCustom,
    // Renderer view: whether secrets exist, never their values (except the local API token, see above).
    async public() {
      const v = this.summary();
      return {encryption: await canEncrypt(), ...v, api: {...v.api, token: await decrypt(read().api.token)}};
    },
    // The same view without anything that needs the secret store (no encryption flag, no API token); synchronous.
    summary() {
      const c = read();
      return {
        cloud: {enabled: c.cloud.enabled, consented: c.cloud.consented, webResearch: c.cloud.webResearch, providers: Object.fromEntries(providerIds(c).map(id => { const p = PROVIDERS[id] || PROVIDERS.custom; return [id, {label: isCustom(id) ? (c.cloud.providers[id]?.label || 'Custom') : p.label, site: p.site, keyHint: p.keyHint,
          key: !!c.cloud.keys[id], models: c.cloud.providers[id]?.models || [], ...(isCustom(id) ? {base: c.cloud.providers[id]?.base || '', custom: true, removable: id !== 'custom'} : {})}]; }))},
        mcp: {servers: c.mcp.servers.map(s => ({id: s.id, name: s.name, url: s.url, enabled: s.enabled, token: !!s.token, checked: s.checked, serverName: s.serverName, error: s.error,
          tools: s.tools.map(t => ({name: t.name, title: t.title, description: t.description, readOnly: t.readOnly, enabled: t.enabled, ask: t.ask}))}))},
        api: {enabled: c.api.enabled, port: c.api.port},
      };
    },
    // ----- cloud -----
    cloudModels() {
      const c = read(); if (!c.cloud.enabled) return [];
      const out = [];
      for (const [id, p] of Object.entries(c.cloud.providers)) {
        if (!c.cloud.keys[id] && !isCustom(id)) continue; if (isCustom(id) && !p.base) continue;
        for (const model of p.models) out.push({name: cloudName(id, model), provider: id, providerLabel: providerLabel(id), model});
      }
      return out;
    },
    cloudKey(id) { return decrypt(read().cloud.keys[id]); },
    async setCloud(patch) {
      const c = read();
      if (typeof patch.enabled === 'boolean') c.cloud.enabled = patch.enabled;
      if (patch.consented === true) c.cloud.consented = true;
      // Web research with cloud models: search results and page text go to the provider, so it is a separate, explicit choice.
      if (typeof patch.webResearch === 'boolean') c.cloud.webResearch = patch.webResearch;
      cache = sanitize(c); write(); return this.public();
    },
    async setCloudProvider(id, patch) {
      if (!knownProvider(id)) throw Error('Unknown provider.');
      const c = read(); const current = c.cloud.providers[id] || {models: []};
      const next = {...current};
      if (Array.isArray(patch.models)) {
        const bad = patch.models.find(x => typeof x !== 'string' || !MODEL_ID.test(x.trim()));
        if (bad !== undefined) throw Error('Invalid model ID: ' + short(bad, 60));
        next.models = [...new Set(patch.models.map(x => x.trim()))].slice(0, 24);
      }
      if (isCustom(id)) { if (patch.base !== undefined) next.base = patch.base ? endpoint(patch.base, 'provider') : ''; if (patch.label !== undefined) next.label = short(patch.label, 40) || (id === 'custom' ? 'Custom' : 'Custom ' + id.slice(6)); }
      c.cloud.providers = {...c.cloud.providers, [id]: next};
      if (typeof patch.key === 'string') {
        const key = patch.key.trim();
        if (!key) delete c.cloud.keys[id];
        else { if (key.length > 1024 || /\s/.test(key)) throw Error('Enter a valid API key.'); c.cloud.keys[id] = await encrypt(key); }
      }
      cache = sanitize(c); write(); return this.public();
    },
    // Adds an empty custom provider slot (custom2 … custom9) and returns its id.
    async addCustomProvider() {
      const c = read();
      let n = 2; while (n <= MAX_CUSTOM && c.cloud.providers['custom' + n]) n++;
      if (n > MAX_CUSTOM) throw Error('You can add up to ' + MAX_CUSTOM + ' custom providers.');
      const id = 'custom' + n;
      c.cloud.providers = {...c.cloud.providers, [id]: {models: [], base: '', label: 'Custom ' + n}};
      cache = sanitize(c); write(); return id;
    },
    removeCustomProvider(id) {
      if (!isCustom(id) || id === 'custom') throw Error('This provider cannot be removed.');
      const c = read(); const providers = {...c.cloud.providers}; delete providers[id]; c.cloud.providers = providers; delete c.cloud.keys[id];
      cache = sanitize(c); write();
    },
    // ----- MCP -----
    servers() { return Promise.all(read().mcp.servers.map(async s => ({...s, token: await decrypt(s.token)}))); },
    async server(id) { const s = server(id); return {...s, token: await decrypt(s.token)}; },
    async addServer({name, url, token}) {
      const c = read(); if (c.mcp.servers.length >= 12) throw Error('At most 12 servers.');
      const clean = endpoint(url, 'server');
      if (c.mcp.servers.some(s => s.url === clean)) throw Error('That server is already added.');
      const entry = {id: crypto.randomBytes(6).toString('hex'), name: short(name || new URL(clean).hostname, 60), url: clean, enabled: true, token: token && String(token).trim() ? await encrypt(String(token).trim().slice(0, 4096)) : '', tools: [], checked: '', serverName: '', error: ''};
      c.mcp.servers.push(entry); cache = sanitize(c); write(); return entry.id;
    },
    // Async only because of the token; without one, every change is applied before the first await.
    async updateServer(id, patch) {
      const c = read(); const s = c.mcp.servers.find(x => x.id === id); if (!s) throw Error('Unknown server.');
      if (typeof patch.enabled === 'boolean') s.enabled = patch.enabled;
      if (typeof patch.name === 'string' && patch.name.trim()) s.name = short(patch.name, 60);
      if (typeof patch.token === 'string') s.token = patch.token.trim() ? await encrypt(patch.token.trim().slice(0, 4096)) : '';
      if (Array.isArray(patch.tools)) { // discovered tools: keep the user's choices for tools that still exist
        const before = new Map(s.tools.map(t => [t.name, t]));
        s.tools = patch.tools.map(t => ({...t, enabled: before.get(t.name)?.enabled === true, ask: before.get(t.name)?.ask !== false}));
      }
      if (patch.tool && typeof patch.tool.name === 'string') {
        const t = s.tools.find(x => x.name === patch.tool.name); if (!t) throw Error('Unknown tool.');
        if (typeof patch.tool.enabled === 'boolean') t.enabled = patch.tool.enabled;
        if (typeof patch.tool.ask === 'boolean') t.ask = patch.tool.ask;
      }
      if (patch.checked !== undefined) s.checked = String(patch.checked || '');
      if (patch.serverName !== undefined) s.serverName = String(patch.serverName || '');
      if (patch.error !== undefined) s.error = String(patch.error || '');
      cache = sanitize(c); write(); return this.public();
    },
    removeServer(id) { const c = read(); c.mcp.servers = c.mcp.servers.filter(s => s.id !== id); write(); return this.summary(); },
    // Tools the model may use: enabled tools of enabled servers.
    activeTools() {
      const out = [];
      for (const s of read().mcp.servers) if (s.enabled) for (const t of s.tools) if (t.enabled) out.push({server: s.id, serverName: s.name, ...t});
      return out;
    },
    // ----- local API -----
    async api() { const a = read().api; return {enabled: a.enabled, port: a.port, token: await decrypt(a.token)}; },
    async setApi(patch) {
      const c = read();
      if (typeof patch.enabled === 'boolean') c.api.enabled = patch.enabled;
      if (patch.port !== undefined) { const p = Number(patch.port); if (!Number.isInteger(p) || p < 1024 || p > 65535) throw Error('Use a port between 1024 and 65535.'); c.api.port = p; }
      if (patch.newToken === true || (c.api.enabled && !await decrypt(c.api.token))) c.api.token = await encrypt('lumen-' + crypto.randomBytes(24).toString('base64url'));
      cache = sanitize(c); write(); return this.public();
    },
  };
}

module.exports = {createConnections, PROVIDERS, endpoint, API_PORT};
