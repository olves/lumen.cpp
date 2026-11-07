// tests/harness/procs.mjs: the identity comparison of the kill script must not depend on the culture (Turkish Windows lower-cases
// "I" to a dotless "ı"), and paths with a capital I must still match their lower-cased identity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { identity, KILL_SCRIPT, IDENTITY_MATCH } from '../harness/procs.mjs';

const BS = '\\';
const winPath = (...parts) => parts.join(BS);

test('the kill script has no culture-sensitive ToLower', () => {
  assert.doesNotMatch(KILL_SCRIPT, /ToLower\(/i);
  assert.ok(KILL_SCRIPT.includes(IDENTITY_MATCH));
});

test('identity lower-cases a path with a capital I the invariant way', () => {
  assert.equal(identity({ ExecutablePath: winPath('C:', 'Program Files', 'Lumen', 'Itest.exe') }), winPath('c:', 'program files', 'lumen', 'itest.exe'));
  assert.equal(identity({ Name: 'LUMEN-HOST.EXE' }), 'lumen-host.exe');
});

test('the comparison matches a capital I under the Turkish culture', () => {
  const p = winPath('C:', 'Program Files', 'Lumen', 'Itest INDEX.exe');
  const head = `[Threading.Thread]::CurrentThread.CurrentCulture=[Globalization.CultureInfo]'tr-TR';$id='${p}';$e=@{id='${identity({ ExecutablePath: p })}'};`;
  const run = tail => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', head + tail], { encoding: 'utf8' });
  assert.equal(run(`[Console]::Out.Write(${IDENTITY_MATCH})`), 'True');
  // For contrast: the old ToLower() comparison fails under tr-TR for the same path.
  assert.equal(run('[Console]::Out.Write($id.ToLower() -eq $e.id)'), 'False');
});
