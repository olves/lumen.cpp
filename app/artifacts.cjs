'use strict';
// Artifact preview: an HTML or SVG code block from a reply, shown in its own window. The page runs in a separate in-memory
// session ("lumen-artifact"): sandboxed renderer, no preload, no Node, and no network at all — every request other than the
// page itself is cancelled, and the page's CSP only allows inline code and data:/blob: media. It cannot navigate, open
// windows, download files or ask for permissions. Nothing is written to disk.

const MAX_CHARS = 2000000;
const CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; worker-src blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

function documentFor(kind, code, {dark}) {
  if (kind === 'svg') {
    const bg = dark ? '#1c1c1b' : '#ffffff';
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:${bg}}body{display:grid;place-items:center}svg{max-width:100%;max-height:100vh;height:auto}</style></head><body>${code}</body></html>`;
  }
  // A fragment gets a minimal document around it; a full document is used as it is.
  if (/<html[\s>]|<!doctype/i.test(code)) return code;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${code}</body></html>`;
}

// The window itself belongs to the shell: platform.artifact.open(html, kind, {title, dark}) (electron/artifact-window.cjs).
function createArtifacts({platform}) {
  function open({code, kind, title, dark}) {
    if (typeof code !== 'string' || !code.trim() || code.length > MAX_CHARS) throw Error('Nothing to preview.');
    if (!['html', 'svg'].includes(kind)) throw Error('Only HTML and SVG can be previewed.');
    return Promise.resolve(platform.artifact.open(documentFor(kind, code, {dark: dark === true}), kind, {title, dark: dark === true}));
  }
  function close() { return platform.artifact.close(); }
  return {open, close, CSP};
}

module.exports = {createArtifacts, documentFor, CSP};
