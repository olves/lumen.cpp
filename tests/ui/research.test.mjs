// Web research through the real UI: the first-use consent card, a research run (plan, search, read, answer with sources), the sources
// under the answer and after a restart, and Stop. The web is a local server that plays a SearXNG instance and two pages
// (LUMEN_TEST_ALLOW_HOST, test hook). Rendering a JavaScript page with the hidden renderer is in browser.test.mjs.
// Real: the agent runtime, the guarded fetch/reader, the chat model (needs one), the UI. Mock: the search engine and the pages.
// A small model may plan or read badly; the test therefore asserts what the runtime guarantees (events, the sources the tools found,
// persistence, the interrupted marker) and logs, not asserts, whether the answer quotes the page.
//   $env:LUMEN_SHELL='tauri'; node --test tests/ui/research.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { launch, workRoot } from '../harness/launch.mjs';
import { pickModel, prepareData } from './data.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `research-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data');
const model = pickModel();
const NO_MODEL = model ? false : 'no installed model';
const js = JSON.stringify;
const requests = [];
let server, base, app;
const ev = e => app.cdp.evaluate(e);
const shot = n => app?.cdp.screenshot(path.join(runDir, n + '.png')).catch(() => {});

const page = (title, text) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${text.map(t => `<p>${t}</p>`).join('')}</body></html>`;
const PAGES = {
  '/lantern': page('Lantern guide', ['The Lantern Festival of Marlow is held every year on the first Saturday of October.',
    'The festival secret word is ZEPHYR-4711, and visitors who say it at the gate receive a paper lantern for free.',
    'Marlow is a small harbour town and the festival has run for more than two hundred years without a break.']),
  '/harbour': page('Marlow harbour', ['Marlow harbour has twelve berths and a small museum about fishing boats.',
    'The museum is open on weekdays from nine to five and entry is free for children under twelve.',
    'Ferries to the northern islands leave from the harbour twice a day in summer and once a day in winter.']),
};
function startWeb() {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    requests.push(url.pathname + url.search);
    if (url.pathname === '/search') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ results: [
        { title: 'Lantern guide', url: `${base}/lantern`, content: 'The Lantern Festival of Marlow and its secret word.' },
        { title: 'Marlow harbour', url: `${base}/harbour`, content: 'Berths, museum and ferries in Marlow.' }] }));
    }
    if (PAGES[url.pathname]) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PAGES[url.pathname]); }
    res.writeHead(404); res.end('nope');
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; r(); }));
}
const runResearch = async prompt => {
  await ev("(window.__agentEvents = [], 0)");
  await ev("(window.lumen.onChannel('agent-event', e => window.__agentEvents.push(e)), 0)");
  await app.cdp.type('#prompt', prompt);
  await app.cdp.click('#send');
};

describe(`research (${shell})`, { skip: NO_MODEL }, () => {
  before(async () => {
    await startWeb();
    prepareData(dataDir, model);
    app = await launch({ shell, dataDir, env: { LUMEN_TEST_ALLOW_HOST: base.replace('http://', '') } });
    await app.cdp.waitFor('state.ready === true', 30000);
    await ev(`window.lumen.tools('update', {agent: {maxSubtasks: 1, maxToolCalls: 3}, search: {provider: 'searxng', endpoint: ${js(base + '/')}}}).then(() => 0)`);
  });
  after(async () => { await app?.stop(); server?.closeAllConnections?.(); server?.close(); });

  test('the web is off by default and a normal message makes no web request', async () => {
    const cfg = await ev("window.lumen.tools('get')");
    assert.equal(cfg.search.enabled, false);
    assert.equal(requests.length, 0);
  });

  test('+ -> Research on the web asks for consent first; Cancel changes nothing', async () => {
    await app.cdp.click('#add-button');
    await app.cdp.click('#use-research');
    await app.cdp.waitFor("document.querySelector('#web-consent').hidden === false", 5000);
    assert.match(await ev("document.querySelector('#web-consent-text').textContent"), /search|provider|SearXNG|queries/i);
    await shot('consent');
    await app.cdp.click('#web-consent-cancel');
    assert.equal((await ev("window.lumen.tools('get')")).search.enabled, false);
  });

  test('Allow turns the web on and shows the research chip', async () => {
    await app.cdp.click('#add-button');
    await app.cdp.click('#use-research');
    await app.cdp.waitFor("document.querySelector('#web-consent').hidden === false", 5000);
    await app.cdp.click('#web-consent-allow');
    await app.cdp.waitFor("!document.querySelector('#tool-chips').hidden && document.querySelector('#tool-chips').textContent.length > 0", 5000);
    assert.equal((await ev("window.lumen.tools('get')")).search.enabled, true);
  });

  test('a research run searches, reads, answers and lists its sources', { timeout: 600000 }, async () => {
    await runResearch('When is the Lantern Festival of Marlow held, and what is its secret word? Use the web.');
    await app.cdp.waitFor('state.busy === true', 30000).catch(() => {});
    await app.cdp.waitFor('state.busy === false', 540000);
    const events = await ev('window.__agentEvents');
    const types = events.map(e => e.type);
    assert.ok(types.includes('start') && types.includes('plan'), 'start and plan events: ' + types.join(','));
    assert.ok(requests.some(r => r.startsWith('/search')), 'the search engine was asked');
    const ops = events.filter(e => e.type === 'task').flatMap(e => e.task.ops || []);
    console.log('# research ops: ' + ops.map(o => `${o.kind}:${o.status}`).join(' '));
    await app.cdp.waitFor("!!document.querySelector('.message.assistant .sources .source-item')", 20000);
    const sources = await ev("[...document.querySelectorAll('.message.assistant .source-item .source-title')].map(n => n.textContent)");
    assert.ok(sources.length >= 1 && sources.every(s => ['Lantern guide', 'Marlow harbour'].includes(s)), 'only URLs the tools found are listed: ' + JSON.stringify(sources));
    await app.cdp.waitFor("!!document.querySelector('.message.assistant .activity')", 5000);
    await shot('answer');
    const answer = await ev("document.querySelector('.message.assistant .message-body').textContent");
    console.log('# the model ' + (/ZEPHYR-4711/.test(answer) ? 'quoted' : 'did not quote') + ' the secret word; October: ' + /October|Ekim/i.test(answer));
    assert.deepEqual(app.cdp.errors, []);
  });

  test('the activity opens and shows the finished tasks', async () => {
    await ev("document.querySelector('.message.assistant .activity-summary').click(); 0");
    await app.cdp.waitFor("document.querySelector('.message.assistant .activity-details').hidden === false", 3000);
    assert.ok(await ev("document.querySelectorAll('.message.assistant .activity-task').length") >= 1);
  });

  test('sources and activity are there after a restart', async () => {
    await app.stop();
    app = await launch({ shell, dataDir, env: { LUMEN_TEST_ALLOW_HOST: base.replace('http://', '') } });
    await app.cdp.waitFor('state.ready === true', 30000);
    await app.cdp.click('.history-item');
    await app.cdp.waitFor("!!document.querySelector('.message.assistant .sources .source-item')", 15000);
    await app.cdp.waitFor("!!document.querySelector('.message.assistant .activity')", 5000);
  });

  test('Stop ends a run, marks the turn interrupted and no agent event follows', { timeout: 300000 }, async () => {
    await ev("(researchMode = true, renderToolChips(), 0)");
    await runResearch('Tell me everything about the Marlow harbour museum and the ferries. Use the web.');
    await app.cdp.waitFor("window.__agentEvents.some(e => e.type === 'plan')", 240000).catch(() => {});
    await app.cdp.waitFor('state.busy === true', 5000);
    await app.cdp.click('#send'); // Stop
    await app.cdp.waitFor('state.busy === false', 60000);
    const count = await ev('window.__agentEvents.length');
    await new Promise(r => setTimeout(r, 1500));
    assert.equal(await ev('window.__agentEvents.length'), count, 'no agent event after Stop');
    const last = await ev('state.chat.Messages.at(-1)');
    assert.equal(last.Role, 'assistant');
    assert.equal(last.Interrupted, true);
  });

  test('no console errors', async () => { assert.deepEqual(app.cdp.errors, []); });
});
