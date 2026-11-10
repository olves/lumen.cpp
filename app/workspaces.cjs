'use strict';
// Workspaces (v1.1). A workspace groups conversations in the sidebar and is bound to a real folder on disk: the folder the agent
// works in, with the permission mode the user picked for it (permissions.cjs). Two sidecar files, chat files are never touched:
//   workspaces.json              {version:1, list:[{id, name, root, mode, created}]}
//   conversation-workspaces.json {chatId: workspaceId}
// The Default workspace always exists; its folder is Documents\Lumen (the real Documents folder, which may be in OneDrive), and
// every conversation without an entry belongs to it, so the chats of earlier versions need no migration. New workspaces get
// Documents\Lumen\<name> unless the user picks another folder. Removing a workspace moves its chats to Default and never deletes
// the folder. Folders are created only when needed (ensureFolder), never at startup.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DEFAULT_MODE, validMode } = require('./permissions.cjs');

const DEFAULT_ID = 'default', MAX = 100;
const validChat = id => typeof id === 'string' && /^[a-f0-9]{32}$/i.test(id);
const validId = id => id === DEFAULT_ID || (typeof id === 'string' && /^[a-f0-9]{12}$/.test(id));
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

function cleanName(value) {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!name || name.length > 60) throw Object.assign(Error('Give the workspace a name of 1-60 characters.'), { code: 'name' });
  return name;
}
// A name that can also be a folder name on Windows.
function folderName(name) {
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name) || RESERVED.test(name) || /[. ]$/.test(name) || name === '.' || name === '..')
    throw Object.assign(Error('That name cannot be a folder name on Windows. Avoid < > : " / \\ | ? * and a dot at the end.'), { code: 'name' });
  return name;
}

function createWorkspaces({ dataDir, documentsDir }) {
  const listFile = path.join(dataDir, 'workspaces.json'), mapFile = path.join(dataDir, 'conversation-workspaces.json');
  let state = null, map = null;
  const read = (file, fallback) => {
    let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return fallback; }
    try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback; }
    // A damaged file is kept next to the new one instead of being overwritten silently.
    catch { try { fs.copyFileSync(file, file + '.damaged'); } catch {} return fallback; }
  };
  const write = (file, value) => { const temp = file + '.tmp'; fs.writeFileSync(temp, JSON.stringify(value, null, 1)); fs.renameSync(temp, file); };
  const lumenFolder = () => path.join(documentsDir(), 'Lumen');

  function load() {
    if (state) return state;
    const raw = read(listFile, {});
    const list = (Array.isArray(raw.list) ? raw.list : []).filter(w => w && validId(w.id) && w.id !== DEFAULT_ID && typeof w.root === 'string' && path.isAbsolute(w.root) && typeof w.name === 'string' && w.name.trim())
      .slice(0, MAX).map(w => ({ id: w.id, name: w.name.slice(0, 60), root: w.root, mode: validMode(w.mode) ? w.mode : DEFAULT_MODE, created: typeof w.created === 'string' ? w.created : '' }));
    const stored = (Array.isArray(raw.list) ? raw.list : []).find(w => w?.id === DEFAULT_ID) || {};
    const def = { id: DEFAULT_ID, name: typeof stored.name === 'string' && stored.name.trim() ? stored.name.slice(0, 60) : '', root: typeof stored.root === 'string' && path.isAbsolute(stored.root) ? stored.root : null, mode: validMode(stored.mode) ? stored.mode : DEFAULT_MODE, created: '' };
    return state = { list: [def, ...list] };
  }
  const loadMap = () => { if (map) return map; const raw = read(mapFile, {}); map = {}; for (const [chat, id] of Object.entries(raw)) if (validChat(chat) && validId(id)) map[chat] = id; return map; };
  const save = () => write(listFile, { version: 1, list: load().list });
  const saveMap = () => write(mapFile, loadMap());
  const find = id => { const w = load().list.find(x => x.id === id); if (!w) throw Object.assign(Error('Workspace not found.'), { code: 'missing' }); return w; };
  const view = w => ({ id: w.id, name: w.name, root: w.id === DEFAULT_ID && !w.root ? lumenFolder() : w.root, mode: w.mode, created: w.created, isDefault: w.id === DEFAULT_ID, exists: fs.existsSync(w.id === DEFAULT_ID && !w.root ? lumenFolder() : w.root) });

  function list() { return load().list.map(view); }
  function get(id) { return view(find(validId(id) ? id : DEFAULT_ID)); }
  function of(chatId) { const id = validChat(chatId) ? loadMap()[chatId] : null; return view(load().list.find(w => w.id === id) || load().list[0]); }
  function assignments() { const ids = new Set(load().list.map(w => w.id)); return Object.fromEntries(Object.entries(loadMap()).filter(([, id]) => ids.has(id) && id !== DEFAULT_ID)); }

  function create({ name, root } = {}) {
    const clean = cleanName(name), s = load();
    if (s.list.length > MAX) throw Error('Too many workspaces.');
    if (s.list.some(w => w.id !== DEFAULT_ID && w.name.toLowerCase() === clean.toLowerCase())) throw Object.assign(Error('A workspace with this name already exists.'), { code: 'exists' });
    let folder;
    if (root) {
      if (typeof root !== 'string' || !path.isAbsolute(root)) throw Error('Choose a folder.');
      folder = fs.realpathSync.native(root);
      if (!fs.statSync(folder).isDirectory()) throw Error('Choose a folder.');
      if (path.parse(folder).root === folder) throw Object.assign(Error('A whole drive cannot be a workspace; choose a folder.'), { code: 'drive' });
    } else {
      folder = path.join(lumenFolder(), folderName(clean));
      fs.mkdirSync(folder, { recursive: true });
    }
    const w = { id: crypto.randomBytes(6).toString('hex'), name: clean, root: folder, mode: DEFAULT_MODE, created: new Date().toISOString() };
    s.list.push(w); save(); return view(w);
  }
  function rename(id, name) { const w = find(id), clean = cleanName(name); if (load().list.some(x => x !== w && x.id !== DEFAULT_ID && x.name.toLowerCase() === clean.toLowerCase())) throw Object.assign(Error('A workspace with this name already exists.'), { code: 'exists' }); w.name = clean; save(); return view(w); }
  function setMode(id, mode) { if (!validMode(mode)) throw Error('Invalid mode.'); const w = find(id); w.mode = mode; save(); return view(w); }
  function remove(id) {
    if (id === DEFAULT_ID) throw Object.assign(Error('The Default workspace cannot be removed.'), { code: 'default' });
    const s = load(), w = find(id); s.list = s.list.filter(x => x !== w); save();
    const m = loadMap(); let moved = 0; for (const [chat, ws] of Object.entries(m)) if (ws === id) { delete m[chat]; moved++; } if (moved) saveMap();
    return { removed: id, moved, folderKept: w.root };
  }
  function assign(chatId, id) {
    if (!validChat(chatId)) throw Error('Invalid conversation.');
    find(id); const m = loadMap();
    if (id === DEFAULT_ID) delete m[chatId]; else m[chatId] = id;
    saveMap(); return of(chatId);
  }
  // The workspace folder, created when it does not exist yet (only Default and Lumen-made folders are created; a folder the user
  // picked that disappeared is reported, not recreated).
  function ensureFolder(id) {
    const w = find(id), v = view(w);
    if (fs.existsSync(v.root)) return v.root;
    if (w.id === DEFAULT_ID && !w.root || path.dirname(v.root).toLowerCase() === lumenFolder().toLowerCase()) { fs.mkdirSync(v.root, { recursive: true }); return v.root; }
    throw Object.assign(Error('The workspace folder was not found: ' + v.root), { code: 'missing-folder' });
  }
  function branch(from, to) { const m = loadMap(); if (validChat(to) && m[from]) { m[to] = m[from]; saveMap(); } }
  function forget(chatId) { const m = loadMap(); if (m[chatId]) { delete m[chatId]; saveMap(); } }

  return { list, get, of, assignments, create, rename, setMode, remove, assign, ensureFolder, branch, forget, DEFAULT_ID };
}

// The user's real Documents folder (it may have been moved, e.g. into OneDrive). Windows keeps it in the registry as
// "Personal" under User Shell Folders, often with %USERPROFILE% in it.
function documentsFolder(env = process.env) {
  if (process.platform === 'win32') {
    try {
      const out = require('node:child_process').execFileSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', 'Personal'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      const m = /Personal\s+REG_(?:EXPAND_)?SZ\s+(.+)/.exec(out);
      if (m) { const value = m[1].trim().replace(/%([^%]+)%/g, (all, name) => env[name] ?? env[Object.keys(env).find(k => k.toLowerCase() === name.toLowerCase())] ?? all); if (path.isAbsolute(value)) return value; }
    } catch {}
  }
  return path.join(env.USERPROFILE || require('node:os').homedir(), 'Documents');
}

module.exports = { createWorkspaces, documentsFolder, DEFAULT_ID };
