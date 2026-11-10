// exec.cjs + lumen-exec.exe (real PowerShell) + execpolicy.cjs: running approved commands and Auto mode's harmless filter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { execHelper } from '../harness/exechelper.mjs';
const require = createRequire(import.meta.url);
const { createExec, cleanEnv, clip } = require('../../app/exec.cjs');

const helper = execHelper();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-exec-'));
fs.writeFileSync(path.join(root, 'a.txt'), 'merhaba\n');
const exec = createExec({ helper, env: { ...process.env, DEEPSEEK_API_KEY: 'sk-secret-value', MY_TOKEN: 't', LUMEN_TEST_X: '1' } });
// Each test pings its own loopback address, so other processes (parallel test files) never change the count.
const pingCount = ip => Number(spawnSync('powershell', ['-NoProfile', '-Command', `@(Get-CimInstance Win32_Process -Filter "Name='PING.EXE'" | Where-Object { $_.CommandLine -like '*${ip}*' }).Count`], { encoding: 'utf8' }).stdout.trim() || 0);
const settle = async ip => { for (let i = 0; i < 20 && pingCount(ip) > 0; i++) await new Promise(r => setTimeout(r, 250)); return pingCount(ip); };

test('runs in the folder, keeps Turkish text, returns the exit code and plain error lines', async () => {
  const r = await exec.run({ command: 'Get-Location | Select-Object -ExpandProperty Path; Write-Output "çğışöü"; Write-Error "olmadı"; exit 4', cwd: root });
  assert.equal(r.code, 4);
  assert.match(r.output, new RegExp(path.basename(root)));
  assert.match(r.output, /çğışöü/);
  assert.match(r.output, /\[err\].*olmadı/);
  assert.doesNotMatch(r.output, /CLIXML|<Objs/);
});

test('keys, tokens and Lumen internals are not in the environment', async () => {
  assert.equal(cleanEnv({ A: '1', DEEPSEEK_API_KEY: 'x', GITHUB_TOKEN: 'y', LUMEN_TEST_FILES: 'z', ELECTRON_RUN_AS_NODE: '1' }).A, '1');
  assert.deepEqual(Object.keys(cleanEnv({ DEEPSEEK_API_KEY: 'x', GITHUB_TOKEN: 'y', LUMEN_TEST_FILES: 'z', ELECTRON_RUN_AS_NODE: '1' })), []);
  const r = await exec.run({ command: 'Get-ChildItem env: | ForEach-Object { $_.Name }', cwd: root });
  assert.doesNotMatch(r.output, /DEEPSEEK_API_KEY|MY_TOKEN|LUMEN_TEST_X/);
  assert.match(r.output, /SystemRoot/i);
});

test('a timeout ends the command and everything it started', async () => {
  const r = await exec.run({ command: 'Start-Process -WindowStyle Hidden ping -ArgumentList "-n","60","127.0.0.21"; ping -n 60 127.0.0.21 | Out-Null', cwd: root, timeoutMs: 4000 });
  assert.equal(r.timedOut, true);
  assert.equal(await settle('127.0.0.21'), 0, 'no ping left running');
});

test('stopping through the signal ends the tree', async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 2500);
  const r = await exec.run({ command: 'ping -n 60 127.0.0.22', cwd: root, signal: controller.signal });
  assert.equal(r.stopped, true);
  assert.equal(await settle('127.0.0.22'), 0);
});

test('a finished command leaves nothing behind (processes it started end with it)', async () => {
  const r = await exec.run({ command: 'Start-Process -WindowStyle Hidden ping -ArgumentList "-n","60","127.0.0.23"; "started"', cwd: root });
  assert.equal(r.code, 0); assert.match(r.output, /started/);
  assert.equal(await settle('127.0.0.23'), 0);
});

test('long output is cut to its first and last part', async () => {
  const c = clip('x'.repeat(50000));
  assert.equal(c.truncated, true); assert.ok(c.text.length < 17000); assert.match(c.text, /characters left out/);
  const r = await exec.run({ command: '1..20000 | ForEach-Object { "line $_" }', cwd: root });
  assert.equal(r.truncated, true); assert.match(r.output, /line 1\n/); assert.match(r.output, /line 20000/);
});

test('background job: start, read new output, stop', async () => {
  const job = exec.start({ command: '1..1000 | ForEach-Object { "tick $_"; Start-Sleep -Milliseconds 100 }', cwd: root });
  await new Promise(r => setTimeout(r, 2500));
  const first = exec.read(job.id);
  assert.equal(first.running, true); assert.match(first.output, /tick 1/);
  const second = exec.read(job.id);
  assert.doesNotMatch(second.output, /tick 1\n/, 'only new output');
  assert.equal(exec.list().length, 1);
  const stopped = await exec.stop(job.id);
  assert.equal(stopped.running, false);
});

// Auto mode. Harmless = runs without asking. Bypass cases started from a DeepSeek draft (11 Nov 2026), checked by hand.
const harmless = [
  'Get-ChildItem', 'gci -Recurse src', 'ls', 'Get-Content a.txt', 'cat .\\a.txt | Select-String merhaba', 'sls -Path *.txt -Pattern x',
  'Get-ChildItem | Where-Object { $_.Length -gt 10 } | Sort-Object Name | Select-Object -First 3', 'Test-Path a.txt', 'pwd',
  'git status', 'git log --oneline -5', 'git diff HEAD~1', 'git branch', 'git branch -a', 'node --version', 'npm -v', 'Get-Content a.txt > $null',
  'Get-ChildItem | Measure-Object | ForEach-Object { $_.Count }', 'where.exe node', 'Get-FileHash a.txt',
];
const asks = [
  ['rm -r foo', 'not-listed'], ['del foo.txt', 'not-listed'], ['gci | % { ri $_ }', 'not-listed'], ['Get-ChildItem | ForEach-Object { Remove-Item $_ }', 'not-listed'],
  ["Select-Object @{n='x';e={Remove-Item $_}}", 'not-listed'], ['& $cmd foo', 'dynamic-command'], ["& ('Remove' + '-Item') foo", 'dynamic-command'],
  ['. .\\script.ps1', 'dot-source'], ["iex 'Remove-Item foo'", 'not-listed'], ['powershell -EncodedCommand SQBFAFgA', 'not-listed'],
  ['Write-Output $(Remove-Item foo)', 'not-listed'], ['echo hi > out.txt', 'redirection'], ['Get-Date >> log.txt', 'redirection'],
  ['Get-Process 2> err.txt', 'redirection'], ['Get-ChildItem *> all.txt', 'redirection'], ['Get-Content Env:PATH', 'provider-path'],
  ['Get-Content -Path HKLM:\\SAM', 'provider-path'], ['Get-Content -Stream Zone.Identifier a.txt', 'param-stream'],
  ['Select-String -Path \\\\server\\share\\x.txt -Pattern x', 'outside-path'], ['Get-ChildItem -Recurse C:\\', 'outside-path'],
  ['Get-Content ..\\..\\secret.txt', 'outside-path'], ["[IO.File]::WriteAllText('x.txt','pwn')", 'method-call'],
  ["[System.Diagnostics.Process]::Start('calc.exe')", 'method-call'], ['Get-ChildItem | ForEach-Object { $_.Delete() }', 'method-call'],
  ['git -c core.pager=calc.exe log', 'git-global-option'], ['git log --ext-diff', 'git-option'], ['git show --textconv HEAD:a', 'git-option'],
  ['git diff --output=out.patch', 'git-option'], ['git branch -D main', 'git-branch-change'], ['git checkout main', 'git-checkout'],
  ['git push', 'git-push'], ['cmd /c del a.txt', 'not-listed'], ['Invoke-Item .\\x.lnk', 'not-listed'], ["& 'C:\\Windows\\System32\\calc.exe'", 'path-command'],
  ['npm install', 'not-listed'], ['node script.js', 'not-listed'], ['function Get-ChildItem { Remove-Item x }; Get-ChildItem', 'defines-function'],
  ['Get-Content $path', 'dynamic-argument'], ['Get-ChildItem -Path $env:USERPROFILE', 'dynamic-argument'], ['Start-Process notepad', 'not-listed'],
  ['Get-Content a.txt | Out-File b.txt', 'not-listed'], ['Get-Content a.txt | Set-Content b.txt', 'not-listed'], ['Get-Help Get-Item -Online', 'param-online'],
];

test('Auto: read-only commands are harmless', async () => {
  for (const command of harmless) { const r = await exec.classify(command, root); assert.equal(r.harmless, true, command + ' → ' + r.reasons.join(',')); }
});
test('Auto: everything else asks, for the expected reason', async () => {
  for (const [command, reason] of asks) {
    const r = await exec.classify(command, root);
    assert.equal(r.harmless, false, command);
    assert.ok(r.reasons.some(x => x.startsWith(reason)), `${command} → ${r.reasons.join(',')} (expected ${reason})`);
  }
});
test('outside paths are flagged even for commands that ask anyway', async () => {
  assert.equal((await exec.classify('Remove-Item C:\\Windows\\x', root)).outside, true);
  assert.equal((await exec.classify('Get-Content .\\a.txt', root)).outside, false);
  assert.equal((await exec.classify('Copy-Item a.txt ..\\b.txt', root)).outside, true);
});

// Review findings (DeepSeek v4-pro, 11 Nov 2026), each checked by hand and fixed.
test('review: a bare "version" argument is not a version flag', async () => {
  for (const command of ['node version', 'npx version', 'python version']) assert.equal((await exec.classify(command, root)).harmless, false, command);
  assert.equal((await exec.classify('go version', root)).harmless, true);
});
test('review: a command given by path is never matched by its base name', async () => {
  for (const command of [String.raw`C:\Users\Public\evil\node.exe --version`, String.raw`.\git.exe status`, String.raw`Microsoft.PowerShell.Management\Remove-Item x`]) {
    const r = await exec.classify(command, root); assert.equal(r.harmless, false, command); assert.ok(r.reasons.includes('path-command'), command);
  }
  assert.equal((await exec.classify(String.raw`C:\Users\Public\evil\node.exe --version`, root)).outside, true);
});
test('review: ~ is the home folder, not a folder inside the workspace', async () => {
  for (const command of [String.raw`Get-Content ~\AppData\Roaming\secret.txt`, 'Get-ChildItem ~']) { const r = await exec.classify(command, root); assert.equal(r.outside, true, command); assert.equal(r.harmless, false, command); }
});
test('review: a junction inside the folder that points outside is outside', async () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-junction-target-'));
  fs.writeFileSync(path.join(target, 'secret.txt'), 's');
  fs.symlinkSync(target, path.join(root, 'j'), 'junction');
  const r = await exec.classify(String.raw`Get-Content .\j\secret.txt`, root);
  assert.equal(r.outside, true); assert.equal(r.harmless, false);
});
test('review: credentials are removed by name and by value', () => {
  const out = cleanEnv({ AZURE_STORAGE_CONNECTION_STRING: 'DefaultEndpointsProtocol=https;AccountKey=abc', DATABASE_URL: 'postgres://u:p@h/db', GH_PAT: 'x', SOMETHING: 'https://user:pw@host/x', PATH: String.raw`C:\Windows`, PATHEXT: '.EXE', HOME_URL: 'https://example.com' });
  assert.deepEqual(Object.keys(out).sort(), ['HOME_URL', 'PATH', 'PATHEXT']);
});
test('list arguments of plain words are constants (Select-Object -Property Name,Length)', async () => {
  assert.equal((await exec.classify('Get-ChildItem | Select-Object -Property Name,Length', root)).harmless, true);
});
