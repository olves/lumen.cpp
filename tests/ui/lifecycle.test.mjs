// Process lifecycle tests, both shells (LUMEN_SHELLS, default "electron,tauri"):
//   node --test tests/ui/lifecycle.test.mjs
// - Closing the window while a reply streams leaves no node.exe, lumen-host.exe or llama-server.exe of the test data folder.
// - Tauri only: a killed core (node.exe) is reported in the UI ('fatal') and restarted once; calls work again afterwards.
// Test data goes to <work>/ui-tests/lifecycle-<run>.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { launch, workRoot, SHELLS } from '../harness/launch.mjs';
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
async function start(shell, env = {}) {
  const dataDir = path.join(runDir, `${shell}-${++counter}`, 'data');
  prepareData(dataDir, model);
  const app = await launch({ shell, dataDir, env });
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

    // The browser panel used the dead core's proxy (its port, token and realm die with it): after the restart it must load through
    // the new core's proxy. A platform request still pending when the core died (here browser.waitIdle on a page that never finishes)
    // is answered later; that answer must not reach the new core (core-host logs every platform-result it cannot match).
    test('a killed core resets the browser panel; late platform answers never reach the new core', { skip: shell !== 'tauri' ? 'Tauri only' : false, timeout: 180000 }, async () => {
      const requests = [];
      const held = [];
      const server = http.createServer((req, res) => {
        requests.push({ path: req.url, connection: req.headers.connection });
        if (req.url === '/slow') { held.push(res); return; } // never answered while the test runs
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(`<!doctype html><title>${req.url}</title><p>${req.url}</p>`);
      });
      await new Promise(r => server.listen(0, '127.0.0.1', r));
      const base = `http://127.0.0.1:${server.address().port}`;
      try {
        const app = await start(shell, { LUMEN_TEST_ALLOW_HOST: base.slice(7) });
        const { cdp } = app;
        const loaded = (url, ms = 30000) => cdp.waitFor(`(s => s.url === ${JSON.stringify(url)} && !s.loading)(browserState)`, ms);
        await cdp.evaluate(`openBrowser(${JSON.stringify(base + '/page1')}).then(() => 0)`);
        await loaded(base + '/page1');
        assert.ok(requests.some(r => r.path === '/page1' && r.connection === 'close'), 'page1 came through the proxy');
        // A load that never ends, and a settle (browser.waitIdle, 15 s) waiting on it in the shell.
        await cdp.evaluate(`openBrowser(${JSON.stringify(base + '/slow')}); 0`);
        for (let i = 0; i < 100 && !requests.some(r => r.path === '/slow'); i++) await sleep(100);
        assert.ok(requests.some(r => r.path === '/slow'), 'the slow page was requested');
        await cdp.evaluate(`window.lumen.browser('settle', {ms: 15000}).catch(() => 0); 0`);
        await sleep(1000);
        const log = path.join(app.dataDir, 'desktop-core.log');
        const offset = fs.existsSync(log) ? fs.statSync(log).size : 0;
        const killedAt = Date.now();
        const node = processesOf(app.dataDir).filter(p => p.name.toLowerCase() === 'node.exe');
        assert.equal(node.length, 1, JSON.stringify(node));
        execFileSync('taskkill.exe', ['/F', '/PID', String(node[0].pid)], { stdio: 'ignore' });
        assert.equal(await cdp.waitFor('window.lumen.preferences().then(p => p && p.layout, () => false)', 45000), 'desk', 'the restarted core answers');
        // The old waitIdle ends 15 s after it began; give its answer time to be (not) delivered to the new core.
        const wait = 18000 - (Date.now() - killedAt);
        if (wait > 0) await sleep(wait);
        const since = fs.readFileSync(log).subarray(offset).toString('utf8');
        assert.doesNotMatch(since, /platform-result for an unknown request/, 'no answer of the dead core reached the new one');
        // The panel works again, through the new core's proxy.
        const before = requests.length;
        await cdp.evaluate(`openBrowser(${JSON.stringify(base + '/page2')}).then(() => 0, e => String(e))`);
        await loaded(base + '/page2');
        const page2 = requests.slice(before).filter(r => r.path === '/page2');
        assert.ok(page2.length && page2.every(r => r.connection === 'close'), 'page2 came through the new proxy: ' + JSON.stringify(page2));
        assert.equal((await cdp.evaluate("window.lumen.browser('state')")).url, base + '/page2');
      } finally {
        for (const res of held) res.destroy();
        server.close();
      }
    });

    // A data folder held by a running Lumen: a second Lumen on it says so and exits at once (no silent wait, no restart loop).
    test('a second Lumen on a held data folder exits at once with the reason', { timeout: 120000 }, async () => {
      const app = await start(shell);
      const def = SHELLS[shell];
      const t0 = Date.now();
      const second = spawn(def.exe, ['--ui-check', `--test-data=${app.dataDir}`, `--user-data-dir=${app.dataDir}-profile-second`], { stdio: 'ignore' });
      const code = await Promise.race([new Promise(r => second.on('exit', c => r(c))), sleep(20000).then(() => 'running')]);
      if (code === 'running') second.kill();
      const ms = Date.now() - t0;
      console.log(`# ${shell}: the second instance exited with ${code} after ${ms} ms`);
      assert.equal(code, 1, 'the second instance exits with an error');
      assert.ok(ms < 15000, `it exits at once (${ms} ms), not after the 45 s start timeout`);
      const reason = fs.readFileSync(path.join(app.dataDir, 'desktop-startup-error.log'), 'utf8');
      assert.match(reason, /already running with this data folder/);
      // The first one is untouched.
      assert.equal(await app.cdp.evaluate('window.lumen.preferences().then(p => p.layout)'), 'desk');
    });

    // Tauri: when the main window's WebView2 guards (permission requests, new windows) cannot be registered, the app closes.
    test('the main window fails closed when it cannot be hardened', { skip: shell !== 'tauri' ? 'Tauri only' : false, timeout: 120000 }, async () => {
      const dataDir = path.join(runDir, `${shell}-${++counter}`, 'data');
      prepareData(dataDir, model);
      const t0 = Date.now();
      const child = spawn(SHELLS[shell].exe, ['--ui-check', `--test-data=${dataDir}`, `--user-data-dir=${dataDir}-profile`], { stdio: 'ignore', env: { ...process.env, LUMEN_MAIN_FAIL_HARDEN: '1' } });
      const code = await Promise.race([new Promise(r => child.on('exit', c => r(c))), sleep(60000).then(() => 'running')]);
      if (code === 'running') child.kill();
      console.log(`# exited with ${code} after ${Date.now() - t0} ms`);
      assert.equal(code, 1);
      assert.match(fs.readFileSync(path.join(dataDir, 'renderer.log'), 'utf8'), /"type":"harden-failed","window":"main"/);
      assert.match(fs.readFileSync(path.join(dataDir, 'desktop-startup-error.log'), 'utf8'), /could not be secured/);
      for (let i = 0; i < 50 && processesOf(dataDir).length; i++) await sleep(200);
      assert.deepEqual(processesOf(dataDir), [], 'no core left behind');
    });
  });
}
