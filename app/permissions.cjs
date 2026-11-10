'use strict';
// Permission modes of the agent (v1.1). One pure decision per tool call: decide(mode, risk) -> {action, warn}.
//   mode:  'ask'          every change and every command asks (new workspaces start here)
//          'accept-edits' file changes inside the workspace folder run, commands ask
//          'plan'         read only: no change and no command anywhere
//          'auto'         file changes run; commands run when the classifier calls them harmless, otherwise ask
//          'full'         nothing asks, the folder's outside included (the composer shows a red badge)
//   risk:  {kind: 'read'|'write'|'exec', outside: boolean, harmless: boolean}
//          outside = the call touches a path outside the workspace folder; harmless = exec only, from execpolicy.cjs.
//   action: 'allow' | 'ask' | 'deny'; warn: 'outside' when the approval card must say the path is outside the folder.
// Rules decided by the user (9 and 11 Nov 2026): outside the folder every mode except Full asks each time, with a warning;
// Plan never writes or runs anything (outside included), and reading outside the folder asks with the warning.
// Auto's harmless test is a convenience filter, not a sandbox: anything it cannot prove read-only asks.
const MODES = ['ask', 'accept-edits', 'plan', 'auto', 'full'];
const DEFAULT_MODE = 'ask';
const validMode = mode => MODES.includes(mode);

function decide(mode, risk = {}) {
  if (!validMode(mode)) mode = DEFAULT_MODE;
  const kind = ['read', 'write', 'exec'].includes(risk.kind) ? risk.kind : 'exec';
  const outside = risk.outside === true;
  if (mode === 'full') return { action: 'allow', warn: null };
  if (outside) {
    if (mode === 'plan' && kind !== 'read') return { action: 'deny', warn: 'outside' };
    return { action: 'ask', warn: 'outside' };
  }
  if (kind === 'read') return { action: 'allow', warn: null };
  if (mode === 'plan') return { action: 'deny', warn: null };
  if (kind === 'write') return { action: mode === 'ask' ? 'ask' : 'allow', warn: null };
  // exec inside the folder
  if (mode === 'auto' && risk.harmless === true) return { action: 'allow', warn: null };
  return { action: 'ask', warn: null };
}

// Which tool groups a mode offers the model at all (Plan gets no writing or running tools, so it cannot even try).
function offers(mode) {
  if (!validMode(mode)) mode = DEFAULT_MODE;
  return { write: mode !== 'plan', exec: mode !== 'plan' };
}

module.exports = { MODES, DEFAULT_MODE, validMode, decide, offers };
