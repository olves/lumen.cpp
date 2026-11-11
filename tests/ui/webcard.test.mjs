// v1.2 web card: a message that wants the web while the web is off for it gets "Allow once / Turn on / Answer without the web"
// instead of a reply that pretends there is no internet (11 Nov 2026: DeepSeek in Lumen on "research re-library.org").
// A named page is read first, without planning. Scripted cloud model; the web is one local page.
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/webcard.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { launch, workRoot } from '../harness/launch.mjs';
import { prepareData } from './data.mjs';
import { cloudServer } from './mocks.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `webcard-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const js = v => JSON.stringify(v);
const web = [];
let app, cloud, server, base;
const ev = e => app.cdp.evaluate(e);
const chatCalls = () => cloud.requests.filter(r => r.path === '/v1/chat/completions');

function startWeb() {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'); web.push(url.pathname);
    if (url.pathname === '/lantern') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><html><head><title>Lantern guide</title></head><body><h1>Lantern guide</h1><p>The festival secret word is ZEPHYR-4711, and it changes every year.</p></body></html>'); }
    res.writeHead(404); res.end();
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; r(); }));
}
// The answer quotes the page when the request carries it; otherwise it says it has no page.
const script = body => /ZEPHYR-4711/.test(String(body.messages.at(-1)?.content || '')) ? { content: 'The secret word is ZEPHYR-4711 [S1].' } : { content: 'I answered without the web.' };
async function ask(text) { await app.cdp.type('#prompt', text); await app.cdp.click('#send'); }
const settled = n => app.cdp.waitFor(`document.querySelectorAll('.message.assistant').length >= ${n} && state.busy === false`, 60000);

describe(`web card (${shell})`, () => {
  before(async () => {
    await startWeb();
    cloud = await cloudServer({ model: 'mock-chat' }); cloud.setScript(script);
    prepareData(path.join(runDir, 'data'), null);
    app = await launch({ shell, dataDir: path.join(runDir, 'data'), env: { LUMEN_TEST_ALLOW_HOST: base.replace('http://', '') } });
    await app.cdp.waitFor('state.ready === true', 30000);
    await ev(`window.lumen.tools('update', {agent: {auto: false}, search: {enabled: true, provider: 'searxng', endpoint: ${js(base + '/')}}}).then(() => loadToolsConfig()).then(() => 0)`);
    await ev(`window.lumen.connections('cloud', {enabled: true, consented: true})`);
    await ev(`window.lumen.connections('provider', {provider: 'custom', base: ${js(cloud.base)}, label: 'Mock', key: ${js(cloud.key)}, models: ['mock-chat']})`);
    await ev(`window.lumen.request('models').then(m => { state.models = m; const s = document.getElementById('model-picker'); renderPickers(); s.value = 'cloud:custom/mock-chat'; s.dispatchEvent(new Event('change')); return loadConnections(); }).then(() => 0)`);
  });
  after(async () => { await app?.stop(); cloud?.close(); server?.closeAllConnections?.(); server?.close(); });

  test('cloud model, web off: a card instead of a reply, and nothing is sent', async () => {
    const before = chatCalls().length;
    await ask(`Read ${base}/lantern and tell me the secret word.`);
    await app.cdp.waitFor("!!document.querySelector('.web-card .web-once')", 10000);
    assert.match(await ev("document.querySelector('.web-card').textContent"), /Web research is off for cloud models/);
    assert.equal(chatCalls().length, before);
  });

  test('Allow once: the named page is read first (no search, no planner), the answer cites it, the setting stays off', async () => {
    await ev("document.querySelector('.web-card .web-once').click(); 0");
    await settled(1);
    assert.match(await ev("[...document.querySelectorAll('.message.assistant')].at(-1).querySelector('.message-body').textContent"), /ZEPHYR-4711/);
    assert.ok(web.includes('/lantern')); assert.ok(!web.includes('/search'));
    assert.ok(!chatCalls().some(r => /You plan work/.test(JSON.stringify(r.body.messages))), 'no planner call');
    assert.equal(await ev("window.lumen.connections('get').then(c => c.cloud.webResearch)"), false);
  });

  test('Answer without the web: a normal reply, no page read', async () => {
    const reads = web.length;
    await ask('Research the lantern festival please.');
    await app.cdp.waitFor("!!document.querySelector('.web-card .web-without')", 10000);
    await ev("document.querySelector('.web-card .web-without').click(); 0");
    await settled(2);
    assert.match(await ev("[...document.querySelectorAll('.message.assistant')].at(-1).querySelector('.message-body').textContent"), /without the web/);
    assert.equal(web.length, reads);
  });

  test('Turn on: the setting is saved and the message is researched', async () => {
    await ask(`Read ${base}/lantern again.`);
    await app.cdp.waitFor("!!document.querySelector('.web-card .web-always')", 10000);
    await ev("document.querySelector('.web-card .web-always').click(); 0");
    await settled(3);
    assert.equal(await ev("window.lumen.connections('get').then(c => c.cloud.webResearch)"), true);
    assert.match(await ev("[...document.querySelectorAll('.message.assistant')].at(-1).querySelector('.message-body').textContent"), /ZEPHYR-4711/);
  });

  test('web on but automatic research off: the bare domain of 11 Nov gets the Research card (Turkish)', async () => {
    await ev("state.prefs.language = 'tr'; localize(); 0");
    await ask("re-library.org'u araştır");
    await app.cdp.waitFor("!!document.querySelector('.web-card .web-once')", 10000);
    assert.match(await ev("document.querySelector('.web-card').textContent"), /Otomatik araştırma kapalı/);
    assert.equal(await ev("document.querySelector('.web-card .web-once').textContent"), 'Araştır');
    await ev("document.querySelector('.web-card').remove(); $('prompt').value = ''; state.prefs.language = 'en'; localize(); 0");
  });

  test('local model with web search off in Settings: the card names Settings → Search', async () => {
    await ev("window.lumen.tools('update', {search: {enabled: false}}).then(() => loadToolsConfig()).then(() => 0)");
    await ev(`(() => { const m = state.models.find(x => !x.Cloud && !x.Image); state.chat = fresh(m ? m.Name : state.chat.Model); if (m) $('model-picker').value = m.Name; upsert(state.chat); renderPickers(); renderMessages(); return 0; })()`);
    await ask(`Read ${base}/lantern.`);
    await app.cdp.waitFor("!!document.querySelector('.web-card')", 10000);
    assert.match(await ev("document.querySelector('.web-card').textContent"), /Settings → Search/);
    await ev("document.querySelector('.web-card').remove(); 0");
  });
});
