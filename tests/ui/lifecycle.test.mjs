// Process lifecycle tests, both shells (LUMEN_SHELLS, default "electron,tauri"):
//   node --test tests/ui/lifecycle.test.mjs
// - Closing the window while a reply streams leaves no node.exe, lumen-host.exe or llama-server.exe of the test data folder.
// - Tauri only: a killed core (node.exe) is reported in the UI ('fatal') and restarted once; calls work again afterwards.
// Test data goes to <work>/ui-tests/lifecycle-<run>.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, workRoot } from '../harness/launch.mjs';
import { sleep } from '../harness/procs.mjs';
import { pickModel, prepareData } from './data.mjs';

const shells = (process.env.LUMEN_SHELLS || 'electron,tauri').split(',').map(s => s.trim()).filter(Boolean);
const runDir = path.join(workRoot, 'ui-tests', 'lifecycle-' + new Date().toISOString().replace(/[:.]/g, '-'));
const model = pickModel();
const NO_MODEL = model ? false : 'no installed model';
const NAMES = ['node.exe', 'lumen-host.exe', 'llama-server.exe'];

// Processes whose command line names the data folder: node core-host.cjs --data <dir>, lumen-host --bridge <dir>, and
// llama-server -m <dir>\models\... (the test model is linked under the data folder).
function processesOf(dataDir) {
  const ps = 'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress';
  const rows = [].concat(JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', maxBuffer: 64 << 20 }) || '[]'));
  const needle = dataDir.toLowerCase();
  return rows.filter(r => NAMES.includes(String(r.Name).toLowerCase()) && String(r.CommandLine || '').toLowerCase().includes(needle))
    .map(r => ({ pid: r.ProcessId, name: r.Name }));
}

const apps = [];
after(async () => { for (const app of apps) await app.stop().catch(() => {}); });
let counter = 0;
async function start(shell) {
  const dataDir = path.join(runDir, `${shell}-${++counter}`, 'data');
  prepareData(dataDir, model);
  const app = await launch({ shell, dataDir });
  apps.push(app);
  await app.cdp.waitFor('state.ready === true', 30000);
  return app;
}

for (const shell of shells) {
  describe(`lifecycle (${shell})`, () => {
    test('closing the window while a reply streams leaves no process of the data folder', { skip: NO_MODEL }, async () => {
      const app = await start(shell);
      const { cdp } = app;
      await cdp.type('#prompt', 'Count from 1 to 1000, one number per line, with no other text.');
      await cdp.click('#send');
      await cdp.waitFor("([...document.querySelectorAll('.message.assistant')].at(-1)?.querySelector('.message-body').textContent||'').length>=1", 120000);
      assert.equal(await cdp.evaluate('state.busy'), true, 'the reply is still streaming');
      const running = processesOf(app.dataDir);
      assert.ok(running.some(p => p.name.toLowerCase() === 'llama-server.exe'), 'llama-server runs before the close: ' + JSON.stringify(running));
      const closedAt = Date.now();
      await cdp.evaluate("window.lumen.window('close'); 0").catch(() => {}); // the title bar's close button
      let exitedMs = null;
      while (Date.now() - closedAt < 10000) {
        if (exitedMs === null && app.process.exitCode !== null) exitedMs = Date.now() - closedAt;
        await sleep(200);
      }
      if (exitedMs === null && app.process.exitCode !== null) exitedMs = Date.now() - closedAt;
      const left = processesOf(app.dataDir);
      console.log(`# ${shell}: app exited after ${exitedMs} ms; left after 10 s: ${JSON.stringify(left)}`);
      assert.notEqual(exitedMs, null, 'the app exited within 10 s');
      assert.deepEqual(left, [], 'no node/lumen-host/llama-server of this data folder 10 s after closing');
    });

    test('a killed core is reported and restarted', { skip: shell !== 'tauri' ? 'the Electron core runs inside the main process' : false }, async () => {
      const app = await start(shell);
      const { cdp } = app;
      await cdp.evaluate(`(() => { window.__toasts = []; const t = document.getElementById('toast');
        new MutationObserver(() => { if (!t.hidden && t.textContent) window.__toasts.push(t.textContent); }).observe(t, { childList: true, characterData: true, subtree: true, attributes: true }); })(); 0`);
      const before = processesOf(app.dataDir).filter(p => p.name.toLowerCase() === 'node.exe');
      assert.equal(before.length, 1, 'one core process: ' + JSON.stringify(before));
      execFileSync('taskkill.exe', ['/F', '/PID', String(before[0].pid)], { stdio: 'ignore' });
      const toasts = await cdp.waitFor('window.__toasts.length && window.__toasts', 15000);
      console.log(`# fatal notice: ${JSON.stringify(toasts)}`);
      assert.match(toasts.join(' | '), /core stopped unexpectedly\. Restarting it/);
      // Reconnected: a new core answers, and lumen-host is up again behind it.
      const prefs = await cdp.waitFor('window.lumen.preferences().then(p => p && p.layout, () => false)', 45000);
      assert.equal(prefs, 'desk');
      const boot = await cdp.evaluate("window.lumen.request('bootstrap').then(b => Array.isArray(b.chats), e => e.message)");
      assert.equal(boot, true, 'bootstrap through the restarted core');
      const now = processesOf(app.dataDir);
      const nodes = now.filter(p => p.name.toLowerCase() === 'node.exe');
      assert.equal(nodes.length, 1, JSON.stringify(now));
      assert.notEqual(nodes[0].pid, before[0].pid);
      assert.ok(now.some(p => p.name.toLowerCase() === 'lumen-host.exe'), 'lumen-host restarted');
      assert.deepEqual(cdp.errors, [], 'console errors: ' + cdp.errors.join(' | '));
    });
  });
}
