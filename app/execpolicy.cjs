'use strict';
// Which commands Auto mode may run without asking (v1.1). Input: the syntax tree summary of lumen-exec.exe --parse
// ({errors, commands:[{name, dynamic, op, args:[{k:'s'|'p'|'x', v, arg?, type?}]}], redirections, methods, flags}).
// Output: {harmless, outside, reasons[]}.
//   harmless: every command in the line is on the read-only list below, with only constant arguments that stay inside the
//             workspace folder; no file redirection, no .NET method call, no function/class definition, no dynamic command name.
//   outside:  some argument is a path outside the workspace folder (absolute, UNC, or "..") — the approval card warns.
// This is a convenience filter, not a sandbox (the user was told so): whatever it cannot prove read-only asks. The bypass list
// in tests/core/execpolicy.test.mjs started from a DeepSeek draft (11 Nov 2026) and was checked by hand.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ALIASES = {
  gci: 'get-childitem', ls: 'get-childitem', dir: 'get-childitem', cat: 'get-content', type: 'get-content', gc: 'get-content',
  sls: 'select-string', gl: 'get-location', pwd: 'get-location', echo: 'write-output', write: 'write-output', '%': 'foreach-object',
  foreach: 'foreach-object', '?': 'where-object', where: 'where-object', select: 'select-object', sort: 'sort-object',
  measure: 'measure-object', gi: 'get-item', rvpa: 'resolve-path', ft: 'format-table', fl: 'format-list', fw: 'format-wide',
  gm: 'get-member', gu: 'get-unique', compare: 'compare-object', diff: 'compare-object', group: 'group-object', h: 'get-history',
  history: 'get-history', gv: 'get-variable', gal: 'get-alias', gdr: 'get-psdrive', gcm: 'get-command',
};
// Read or format only, in every parameter combination we allow (provider paths and -Stream are refused below).
const CMDLETS = new Set(['get-childitem', 'get-content', 'select-string', 'get-item', 'get-itemproperty', 'test-path', 'resolve-path', 'get-location',
  'split-path', 'join-path', 'get-date', 'get-filehash', 'measure-object', 'select-object', 'sort-object', 'where-object', 'foreach-object',
  'group-object', 'compare-object', 'get-unique', 'get-member', 'format-table', 'format-list', 'format-wide', 'out-string', 'out-null',
  'write-output', 'write-host', 'write-verbose', 'write-warning', 'write-information', 'convertto-json', 'convertfrom-json', 'convertto-csv',
  'convertfrom-csv', 'get-command', 'get-help', 'get-alias', 'get-variable', 'get-culture', 'get-uiculture', 'get-host', 'get-psdrive',
  'get-history', 'get-random', 'get-executionpolicy']);
// Cmdlets whose script block arguments are fine because every command inside them is checked too.
const BLOCK_OK = new Set(['foreach-object', 'where-object', 'select-object', 'sort-object', 'group-object', 'measure-object', 'format-table', 'format-list', 'compare-object']);
const PARAMS_FORBIDDEN = { 'get-content': ['stream', 'wait', 'tail'], 'select-string': [], 'get-childitem': [], 'get-help': ['online', 'showwindow'], 'get-command': [] };
const EXES = new Set(['where', 'whoami', 'hostname', 'tree', 'findstr']);
const VERSION_ONLY = new Set(['node', 'npm', 'npx', 'python', 'python3', 'py', 'pip', 'pip3', 'dotnet', 'cargo', 'rustc', 'go', 'java', 'javac', 'ruby', 'php', 'gcc', 'clang', 'cmake', 'ninja', 'yarn', 'pnpm', 'deno', 'bun', 'git', 'tsc', 'rg']);
// Flags only: a bare word ("node version") would run a script of that name. `go version` is a subcommand, allowed by name.
const VERSION_ARGS = new Set(['--version', '-v', '-V', '-version']);
const GIT_READ = new Set(['status', 'log', 'show', 'diff', 'branch', 'tag', 'remote', 'rev-parse', 'ls-files', 'ls-tree', 'describe', 'merge-base', 'show-ref', 'rev-list', 'shortlog', 'blame', 'grep']);
const GIT_FORBID = /^(-c|-C|--config-env|--exec-path|--paginate|-p|--output|--ext-diff|--textconv|--use-textconv|--open-files-in-pager|-O|--no-index|--filters|--remerge-diff|--git-dir|--work-tree)(=|$)/;
// branch/tag/remote change state with any argument except these listing flags.
const GIT_LIST_ONLY = { branch: /^(-a|--all|-r|--remotes|-v|-vv|--list|--show-current|--contains|--merged|--no-merged|--sort=.*|--format=.*)$/, tag: /^(-l|--list|--sort=.*|--contains|--merged|--format=.*|-n\d*)$/, remote: /^(-v|--verbose|show|get-url)$/ };

const lower = s => String(s || '').toLowerCase();
const exeName = name => lower(path.basename(String(name || '').replace(/\\/g, '/'))).replace(/\.(exe|cmd|bat|com)$/, '');
const looksLikePath = v => /^[a-z]:[\\/]?|^\\\\|^\/\/|^\.\.?([\\/]|$)|^~|[\\/]/i.test(v);
const providerPath = v => /^[a-z][a-z0-9]+::?/i.test(v) && !/^[a-z]:[\\/]?/i.test(v) || /^(env|hklm|hkcu|cert|variable|function|alias|wsman|registry)::?/i.test(v);

// Inside the folder after PowerShell's "~" (home) and after following junctions and symbolic links of the part that exists
// (review 11 Nov: a junction in the folder pointing out, or ~\AppData, looked inside).
function real(p) {
  let probe = p;
  while (!fs.existsSync(probe)) { const up = path.dirname(probe); if (up === probe) return p; probe = up; }
  try { return path.join(fs.realpathSync.native(probe), path.relative(probe, p)); } catch { return p; }
}
function insideRoot(value, root) {
  if (!root) return true;
  let text = String(value).replace(/[*?]+.*$/, '') || '.';
  if (/^\\\\|^\/\//.test(text)) return false;
  if (/^~([\\/]|$)/.test(text)) text = path.join(os.homedir(), text.slice(1));
  const full = real(path.resolve(root, text)), a = full.toLowerCase(), b = real(path.resolve(root)).toLowerCase();
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
}

// Numbers and lists of plain words (-First 3, -Property Name,Length) are constants too.
const constant = a => a.k === 'x' && (a.type === 'ConstantExpressionAst' || a.type === 'ArrayLiteralAst' && /^[\w .,'"-]*$/.test(a.v));

function classify(parsed, { root } = {}) {
  const reasons = [];
  let outside = false;
  if (!parsed || !Array.isArray(parsed.commands)) return { harmless: false, outside: false, reasons: ['unreadable'] };
  if (parsed.errors?.length) reasons.push('parse-error');
  if (parsed.redirections?.some(r => r.kind === 'file' && !/^\$null$/i.test(String(r.target).trim()))) reasons.push('redirection');
  if (parsed.methods?.length) reasons.push('method-call');
  for (const f of parsed.flags || []) reasons.push('defines-' + f);
  if (!parsed.commands.length && !reasons.length) reasons.push('no-command');
  for (const c of parsed.commands) {
    // Outside detection runs on every string argument, harmless or not, so the card can warn.
    for (const a of c.args || []) {
      const values = a.k === 's' ? [a.v] : a.k === 'p' && a.arg ? [String(a.arg).replace(/^['"]|['"]$/g, '')] : [];
      for (const v of values) if (looksLikePath(v) && !insideRoot(v, root)) { outside = true; reasons.push('outside-path'); }
    }
    if (c.dynamic || !c.name) { reasons.push('dynamic-command'); continue; }
    if (c.op === '.') { reasons.push('dot-source'); continue; }
    // A command given by path (C:\x\node.exe, .\git.exe, Module\Cmdlet) is never matched by its base name.
    if (/[\\/:]/.test(c.name)) { if (looksLikePath(c.name) && !insideRoot(c.name, root)) outside = true; reasons.push('path-command'); continue; }
    const name = lower(c.name), cmdlet = ALIASES[name] || name;
    if (CMDLETS.has(cmdlet)) {
      for (const a of c.args || []) {
        if (a.k === 'x' && !(a.type === 'ScriptBlockExpressionAst' && BLOCK_OK.has(cmdlet)) && !constant(a)) { reasons.push('dynamic-argument'); break; }
        if (a.k === 'p' && (PARAMS_FORBIDDEN[cmdlet] || []).includes(lower(a.v))) { reasons.push('param-' + lower(a.v)); break; }
        if (a.k === 'p' && a.arg && !/^['"]?[\w .\\/:*?-]*['"]?$/.test(a.arg)) { reasons.push('dynamic-argument'); break; }
        const v = a.k === 's' ? a.v : a.k === 'p' && a.arg ? String(a.arg).replace(/^['"]|['"]$/g, '') : '';
        if (v && providerPath(v)) { reasons.push('provider-path'); break; }
        if (v && /^\\\\|^\/\//.test(v)) { reasons.push('network-path'); break; }
      }
      continue;
    }
    const exe = exeName(c.name);
    if (!EXES.has(exe) && !VERSION_ONLY.has(exe) && exe !== 'git') { reasons.push('not-listed:' + (ALIASES[name] || name)); continue; }
    const strings = (c.args || []).map(a => a.k === 's' ? a.v : a.k === 'p' ? '-' + a.v : constant(a) ? a.v : null);
    if (strings.includes(null)) { reasons.push('dynamic-argument'); continue; }
    if (EXES.has(exe)) continue;
    if (VERSION_ONLY.has(exe) && strings.length === 1 && (VERSION_ARGS.has(strings[0]) || exe === 'go' && strings[0] === 'version')) continue;
    if (exe === 'git') { const why = gitReason(strings); if (why) reasons.push(why); continue; }
    reasons.push('not-listed:' + (ALIASES[name] || name));
  }
  return { harmless: reasons.length === 0, outside, reasons: [...new Set(reasons)] };
}

function gitReason(args) {
  const sub = args.find(a => !a.startsWith('-'));
  const before = args.slice(0, args.indexOf(sub));
  if (!sub || before.length) return 'git-global-option';
  if (!GIT_READ.has(sub)) return 'git-' + sub;
  const rest = args.slice(args.indexOf(sub) + 1);
  if (rest.some(a => GIT_FORBID.test(a))) return 'git-option';
  const only = GIT_LIST_ONLY[sub];
  if (only && rest.some(a => !only.test(a) && !(sub === 'remote' && rest[0] === 'show' || sub === 'remote' && rest[0] === 'get-url'))) return 'git-' + sub + '-change';
  return null;
}

module.exports = { classify, insideRoot };
