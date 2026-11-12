// Tauri bridge: the main window's initialization script (shell-tauri/src/window.rs embeds it). It defines window.lumen with exactly
// the surface of preload.cjs (Electron), so the UI runs unchanged:
//   invoke channels -> Tauri command lumen_call {channel, args}; errors read "Error invoking remote method '<channel>': Error: <msg>"
//   window(action)  -> Tauri command window_action (fire and forget, like ipcRenderer.send)
//   onChannel/onEvent -> the Tauri event 'lumen-event' {channel, payload}; onChannel keeps preload.cjs' allowlist
// It also gives the frameless window the drag behaviour Electron takes from CSS (-webkit-app-region): mousedown on a drag region
// starts dragging the window, a double click maximizes or restores it. No npm package and no window.__TAURI__ (withGlobalTauri is off): only __TAURI_INTERNALS__, as Tauri's own JS API uses it.
(() => {
  'use strict';
  if (window !== window.top || 'lumen' in window) return;
  const internals = () => window.__TAURI_INTERNALS__;
  const invoke = (command, args) => internals().invoke(command, args);
  const message = e => (typeof e === 'string' ? e : (e && e.message) || String(e));

  // Trailing undefined arguments are dropped: JSON would turn them into null, and the core's defaults (args={}) need them absent.
  function call(channel, ...args) {
    while (args.length && args[args.length - 1] === undefined) args.pop();
    return invoke('lumen_call', { channel, args }).then(
      r => (r && Object.prototype.hasOwnProperty.call(r, 'value') ? r.value : undefined),
      e => { throw new Error(`Error invoking remote method '${channel}': Error: ${message(e)}`); });
  }

  const subscribers = new Map(); // channel -> Set of callbacks
  let listening = false;
  function listen() {
    const tauri = internals();
    if (listening || !tauri || typeof tauri.transformCallback !== 'function') return;
    listening = true;
    // What @tauri-apps/api/event listen() does: the plugin:event|listen command with a registered callback.
    const handler = tauri.transformCallback(event => {
      const { channel, payload } = event.payload || {};
      const set = subscribers.get(channel);
      if (!set) return;
      for (const callback of [...set]) {
        try { callback(payload); } catch (error) { setTimeout(() => { throw error; }); }
      }
    });
    invoke('plugin:event|listen', { event: 'lumen-event', target: { kind: 'Any' }, handler }).catch(error => { listening = false; console.error('lumen-event listener failed', error); });
  }
  function subscribe(channel, callback) {
    if (!subscribers.has(channel)) subscribers.set(channel, new Set());
    const set = subscribers.get(channel);
    const entry = payload => callback(payload);
    set.add(entry);
    listen();
    return () => set.delete(entry);
  }
  listen();
  if (!listening) document.addEventListener('DOMContentLoaded', listen, { once: true });

  const CHANNELS = ['agent-event', 'browser-event', 'download-event', 'models-meta', 'update-event', 'engine-update-event', 'import-event', 'document-event', 'image-event'];
  const api = {
    photos: (action, args) => call('photos', action, args),
    vision: (action, args) => call('vision', action, args),
    drafts: (action, args) => call('drafts', action, args),
    modelsInfo: (action, args) => call('models-info', action, args),
    variants: (action, args) => call('variants', action, args),
    run: (action, args) => call('run', action, args),
    imports: (action, args) => call('imports', action, args),
    documents: (action, args) => call('documents', action, args),
    assistants: (action, args) => call('assistants', action, args),
    connections: (action, args) => call('connections', action, args),
    artifact: (action, args) => call('artifact', action, args),
    images: (action, args) => call('images', action, args),
    plugins: (action, args) => call('plugins', action, args),
    projects: (action, args) => call('projects', action, args),
    workspaces: (action, args) => call('workspaces', action, args),
    memory: (action, args) => call('memory', action, args),
    skills: (action, args) => call('skills', action, args),
    modelInfo: repo => call('model-info', repo),
    hub: (kind, query) => call('hub', kind, query),
    tools: (action, args) => call('tools', action, args),
    agent: (action, args) => call('agent', action, args),
    browser: (action, args) => call('browser', action, args),
    downloads: (action, args) => call('downloads', action, args),
    updates: (action, args) => call('updates', action, args),
    engineUpdate: (action, args) => call('engine-update', action, args),
    onChannel: (channel, callback) => {
      if (!CHANNELS.includes(channel)) throw Error('Unknown channel');
      return subscribe(channel, callback);
    },
    openModel: repo => call('open-model', repo),
    attachText: language => call('attach-text', language),
    request: (action, args) => call('engine', action, args),
    preferences: value => call('preferences', value),
    window: action => { invoke('window_action', { action }).catch(() => {}); },
    export: text => call('export', text),
    copy: text => call('copy', text),
    deleteChat: (id, title, language) => call('delete-chat', id, title, language),
    onEvent: callback => subscribe('engine-event', callback),
  };
  Object.defineProperty(window, 'lumen', { value: Object.freeze(api), enumerable: true, configurable: false, writable: false });

  // Window dragging. Electron reads -webkit-app-region from CSS; WebView2 ignores it, so the same CSS decides here: the nearest
  // element (from the target up) with app-region drag or no-drag wins. Form controls and links never drag.
  const region = el => {
    const style = getComputedStyle(el);
    return (style.getPropertyValue('app-region') || style.getPropertyValue('-webkit-app-region') || style.webkitAppRegion || '').trim();
  };
  // Fallback when the engine does not report app-region in computed styles: the drag regions of index.html (ui/c-shell.css).
  const FALLBACK_DRAG = '.titlebar, .design-window-bar', FALLBACK_NO_DRAG = '.window-controls, .design-window-bar > div';
  const supported = typeof CSS !== 'undefined' && (CSS.supports('app-region', 'drag') || CSS.supports('-webkit-app-region', 'drag'));
  function draggable(target) {
    for (let el = target; el && el.nodeType === 1; el = el.parentElement) {
      if (el.matches('button, input, select, textarea, a, [contenteditable=""], [contenteditable="true"]')) return false;
      const r = supported ? region(el) : (el.matches(FALLBACK_NO_DRAG) ? 'no-drag' : el.matches(FALLBACK_DRAG) ? 'drag' : '');
      if (r === 'drag') return true;
      if (r === 'no-drag') return false;
    }
    return false;
  }
  document.addEventListener('mousedown', event => {
    if (event.button !== 0 || !draggable(event.target)) return;
    if (event.detail === 2) { invoke('window_action', { action: 'maximize' }).catch(() => {}); return; }
    const current = internals() && internals().metadata && internals().metadata.currentWindow;
    if (current) invoke('plugin:window|start_dragging', { label: current.label }).catch(() => {});
  });
})();
