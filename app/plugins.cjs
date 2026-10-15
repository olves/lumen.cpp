'use strict';
// Plugins: a package, not a permission. A plugin (a folder with plugin.json, a single plugin.json, or an https address of
// one) bundles skills, assistants and MCP server addresses. Installing always shows a review first; nothing is saved
// before the user confirms. Servers are added with every tool off; an assistant can only *ask* for tools, and the user
// turns them on (each call still asks for approval unless the user chose "Always allow"). Skills stay instructions only.
// Lumen never starts programs for a plugin and never runs scripts from it. plugins.json records what each plugin added.
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');

const ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const LIMITS = {file: 262144, skills: 12, servers: 8, assistants: 12, tools: 16};
const KNOWN = ['lumenPlugin', 'id', 'name', 'version', 'description', 'author', 'homepage', 'skills', 'servers', 'assistants'];
function short(text, n) { text = String(text || '').replace(/\s+/g, ' ').trim(); return text.length > n ? text.slice(0, n - 1) + '…' : text; }

// Reads plugin.json text into a draft. `folder` (optional) is the plugin folder for skill paths; skills given as paths are
// imported with the skill folder importer (SKILL.md + text references; scripts are listed as not imported).
async function parsePlugin(text, {folder = null, origin = '', skills, connections}) {
  let j; try { j = JSON.parse(text); } catch { throw Error('plugin.json is not valid JSON.'); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw Error('plugin.json must be an object.');
  if (j.lumenPlugin !== 1) throw Error('Not a Lumen plugin: plugin.json needs "lumenPlugin": 1.');
  if (!ID.test(String(j.id || ''))) throw Error('The plugin id must be 2–40 lowercase letters, digits or dashes.');
  const name = short(j.name, 60); if (!name) throw Error('The plugin needs a name.');
  const notes = Object.keys(j).filter(k => !KNOWN.includes(k)).map(k => `"${k}" is not used by Lumen.`);
  let homepage = ''; if (j.homepage) { try { const u = new URL(String(j.homepage)); if (u.protocol === 'https:') homepage = u.href.slice(0, 300); } catch {} }
  const draft = {id: j.id, name, version: short(j.version || '', 20), description: short(j.description || '', 400), author: short(j.author || '', 80), homepage, origin: short(origin, 300), skills: [], servers: [], assistants: [], notes};
  // Skills
  const list = Array.isArray(j.skills) ? j.skills : [];
  if (list.length > LIMITS.skills) notes.push(`Only the first ${LIMITS.skills} skills are used.`);
  for (const s of list.slice(0, LIMITS.skills)) {
    try {
      if (typeof s?.path === 'string') {
        if (!folder) { notes.push(`Skill folder "${short(s.path, 60)}" needs the plugin folder; install the folder instead of the file.`); continue; }
        const root = await fsp.realpath(folder), dir = await fsp.realpath(path.resolve(root, s.path)).catch(() => null);
        if (!dir || !(dir === root || dir.startsWith(root + path.sep))) { notes.push(`Skill folder "${short(s.path, 60)}" is outside the plugin.`); continue; }
        const d = await skills.importFolder(dir); draft.skills.push({...d, source: {type: 'plugin', origin: j.id}});
      } else if (s && typeof s === 'object') {
        const d = skills.validate({name: s.name, description: s.description, instructions: s.instructions, references: s.references, source: {type: 'plugin', origin: j.id}});
        const extra = Object.keys(s).filter(k => !['name', 'description', 'instructions', 'references'].includes(k));
        if (extra.some(k => /tool|permission/i.test(k))) d.unsupported = [...(d.unsupported || []), 'Skills cannot grant tools or permissions; "' + extra.join('", "') + '" ignored.'];
        draft.skills.push(d);
      }
    } catch (error) { notes.push(`A skill was not imported: ${short(error.message, 160)}`); }
  }
  // Servers (addresses only; never commands)
  const servers = Array.isArray(j.servers) ? j.servers : [];
  for (const s of servers.slice(0, LIMITS.servers)) {
    if (!s || typeof s !== 'object') continue;
    if (s.command || s.args) { notes.push(`Server "${short(s.name || s.id, 40)}" asks Lumen to start a program; Lumen never does. Run it yourself and use its address.`); if (!s.url) continue; }
    let url; try { url = require('./connections.cjs').endpoint(s.url, 'server'); } catch (error) { notes.push(`Server "${short(s.name || s.id, 40)}": ${error.message}`); continue; }
    const key = String(s.id || '').match(/^[a-z0-9-]{1,40}$/)?.[0]; if (!key) { notes.push('A server without a valid id was skipped.'); continue; }
    draft.servers.push({key, name: short(s.name || key, 60), url, tools: (Array.isArray(s.tools) ? s.tools : []).filter(t => typeof t === 'string' && /^[A-Za-z0-9_.\-\/]{1,128}$/.test(t)).slice(0, 32)});
  }
  // Assistants (tools are requests, resolved against the plugin's servers or Lumen's own create_image)
  const assistants = Array.isArray(j.assistants) ? j.assistants : [];
  for (const a of assistants.slice(0, LIMITS.assistants)) {
    if (!a || typeof a !== 'object' || !short(a.name, 60)) continue;
    const tools = [];
    for (const t of (Array.isArray(a.tools) ? a.tools : []).slice(0, LIMITS.tools)) {
      if (t?.builtin === 'create_image') tools.push({builtin: 'create_image'});
      else if (typeof t?.server === 'string' && typeof t?.tool === 'string' && draft.servers.some(s => s.key === t.server) && /^[A-Za-z0-9_.\-\/]{1,128}$/.test(t.tool)) tools.push({server: t.server, tool: t.tool});
      else notes.push(`Assistant "${short(a.name, 40)}" asks for an unknown tool; skipped.`);
    }
    draft.assistants.push({name: short(a.name, 60), description: short(a.description || '', 200), instructions: String(a.instructions || '').slice(0, 12000), model: '', run: a.run && typeof a.run === 'object' ? a.run : {},
      skillNames: (Array.isArray(a.skills) ? a.skills : []).filter(x => typeof x === 'string').slice(0, 4), tools});
  }
  if (!draft.skills.length && !draft.servers.length && !draft.assistants.length) throw Error('The plugin has no skills, servers or assistants Lumen can use.');
  return draft;
}

function createPlugins({dataDir, skills, skillStore, assistants, connections, mcp, log = () => {}}) {
  const file = path.join(dataDir, 'plugins.json'); let cache = null; const drafts = new Map();
  function load() { if (cache) return cache; try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); cache = Array.isArray(j?.plugins) ? j.plugins : []; } catch { cache = []; } return cache; }
  function save() { const t = file + '.tmp'; fs.writeFileSync(t, JSON.stringify({version: 1, plugins: cache}, null, 1)); fs.renameSync(t, file); }
  function view(p) { return {...p, skills: p.skills.map(id => skillStore.list().find(s => s.id === id)).filter(Boolean).map(s => ({id: s.id, name: s.name})),
    assistants: p.assistants.map(id => assistants.get(id)).filter(Boolean).map(a => ({id: a.id, name: a.name, tools: a.tools || []})),
    servers: p.servers.map(id => connections.public().mcp.servers.find(s => s.id === id)).filter(Boolean).map(s => ({id: s.id, name: s.name, url: s.url, tools: s.tools.length, on: s.tools.filter(t => t.enabled).length}))}; }

  return {
    list: () => load().map(view),
    // A draft for review; kept in the main process so the renderer only confirms it by id.
    async draft(text, options) {
      const d = await parsePlugin(text, {...options, skills, connections});
      const token = crypto.randomBytes(8).toString('hex'); drafts.clear(); drafts.set(token, d);
      const existing = load().find(p => p.id === d.id);
      return {token, ...d, skills: d.skills.map(s => ({name: s.name, description: s.description, references: (s.references || []).length, unsupported: s.unsupported || []})), update: existing ? {from: existing.version} : null};
    },
    async install(token) {
      const d = drafts.get(token); if (!d) throw Error('The review expired. Choose the plugin again.'); drafts.delete(token);
      const old = load().find(p => p.id === d.id);
      // Skills: replace this plugin's earlier skills by name, add new ones.
      const skillIds = [], byName = new Map();
      const previous = old ? skillStore.list().filter(s => old.skills.includes(s.id)) : [];
      for (const s of d.skills) { const prev = previous.find(x => x.name === s.name); const saved = skillStore.upsert({...s, id: prev?.id}); skillIds.push(saved.id ?? skillStore.list().find(x => x.name === s.name && x.source?.origin === d.id)?.id); byName.set(s.name, skillIds.at(-1)); }
      if (old) for (const s of previous) if (!skillIds.includes(s.id)) skillStore.remove(s.id);
      // Servers: reuse a connection with the same address (keeps the user's tool choices), otherwise add one with tools off.
      const serverIds = [], byKey = new Map();
      for (const s of d.servers) {
        let id = connections.public().mcp.servers.find(x => x.url === s.url)?.id;
        if (!id) { id = connections.addServer({name: s.name, url: s.url}); try { const r = await mcp.listTools(connections.server(id)); connections.updateServer(id, {tools: r.tools, serverName: r.serverName, checked: new Date().toISOString(), error: ''}); } catch (error) { connections.updateServer(id, {error: error.message, checked: new Date().toISOString()}); } }
        serverIds.push(id); byKey.set(s.key, id);
      }
      if (old) for (const id of old.servers) if (!serverIds.includes(id) && !load().some(p => p.id !== d.id && p.servers.includes(id))) { mcp.forget(id); connections.removeServer(id); }
      // Assistants
      const assistantIds = [], previousA = old ? old.assistants.map(id => assistants.get(id)).filter(Boolean) : [];
      for (const a of d.assistants) {
        const prev = previousA.find(x => x.name === a.name);
        const tools = a.tools.map(t => t.builtin ? {server: 'lumen', name: t.builtin} : {server: byKey.get(t.server), name: t.tool}).filter(t => t.server);
        const saved = assistants.upsert({id: prev?.id, name: a.name, description: a.description, instructions: a.instructions, model: '', run: a.run, skillIds: a.skillNames.map(n => byName.get(n)).filter(Boolean), tools, plugin: d.id});
        assistantIds.push(saved.id);
      }
      if (old) for (const a of previousA) if (!assistantIds.includes(a.id)) assistants.remove(a.id);
      const entry = {id: d.id, name: d.name, version: d.version, description: d.description, author: d.author, homepage: d.homepage, origin: d.origin, installed: new Date().toISOString(), skills: skillIds, servers: serverIds, assistants: assistantIds};
      cache = [...load().filter(p => p.id !== d.id), entry]; save(); log('[plugins] installed ' + d.id + ' ' + d.version);
      return view(entry);
    },
    remove(id) {
      const p = load().find(x => x.id === id); if (!p) throw Error('Plugin not found.');
      for (const a of p.assistants) { try { assistants.remove(a); } catch {} }
      for (const s of p.skills) { try { skillStore.remove(s); } catch {} }
      for (const sid of p.servers) if (!load().some(x => x.id !== id && x.servers.includes(sid))) { try { mcp.forget(sid); connections.removeServer(sid); } catch {} }
      cache = load().filter(x => x.id !== id); save(); return cache.map(view);
    },
  };
}

module.exports = {createPlugins, parsePlugin, LIMITS};
