// Web research with a cloud model: off by default (the old "use a local model" toast), turned on in Settings → Cloud models
// ("Allow web research with cloud models"), then a research run plans, searches and reads pages with the cloud model and the
// answer cites the page. The cloud model is a scripted mock; the web is a local SearXNG stand-in and one page.
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/cloudresearch.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { launch, workRoot } from '../harness/launch.mjs';
import { prepareData } from './data.mjs';
import { cloudServer } from './mocks.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `cloudresearch-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const js = v => JSON.stringify(v);
const web = [];
let app, cloud, server, base;
const ev = e => app.cdp.evaluate(e);

function startWeb() {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'); web.push(url.pathname);
    if (url.pathname === '/search') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ results: [{ title: 'Lantern guide', url: `${base}/lantern`, content: 'The Lantern Festival of Marlow.' }] })); }
    if (url.pathname === '/lantern') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><html><head><title>Lantern guide</title></head><body><h1>Lantern guide</h1><p>The festival secret word is ZEPHYR-4711, and visitors who say it at the gate receive a paper lantern for free.</p><p>The Lantern Festival of Marlow is held every year on the first Saturday of October in the old harbour town.</p></body></html>'); }
    res.writeHead(404); res.end();
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; r(); }));
}
// The scripted cloud model: a plan, then search → read → finish for the one task, then the cited answer.
function script(body) {
  const system = body.messages.find(m => m.role === 'system')?.content || '';
  const turns = body.messages.filter(m => m.role === 'assistant').length;
  if (/You plan work/.test(system)) return { content: JSON.stringify({ mode: 'research', tasks: [{ title: 'Secret word', goal: 'Find the festival secret word' }] }) };
  if (/research subagent/.test(system)) return { content: JSON.stringify([{ action: 'web_search', query: 'Marlow lantern festival secret word' }, { action: 'read_page', url: `${base}/lantern` }, { action: 'finish', result: 'The secret word is ZEPHYR-4711 [S1].' }][Math.min(turns, 2)]) };
  return { content: 'The secret word is ZEPHYR-4711 [S1].' };
}

describe(`web research with a cloud model (${shell})`, () => {
  before(async () => {
    await startWeb();
    cloud = await cloudServer({ model: 'mock-chat' });
    cloud.setScript(script);
    prepareData(path.join(runDir, 'data'), null);
    app = await launch({ shell, dataDir: path.join(runDir, 'data'), env: { LUMEN_TEST_ALLOW_HOST: base.replace('http://', '') } });
    await app.cdp.waitFor('state.ready === true', 30000);
    await ev(`window.lumen.tools('update', {agent: {maxSubtasks: 1, maxToolCalls: 3}, search: {enabled: true, provider: 'searxng', endpoint: ${js(base + '/')}}}).then(() => loadToolsConfig()).then(() => 0)`);
    await ev(`window.lumen.connections('cloud', {enabled: true, consented: true})`);
    await ev(`window.lumen.connections('provider', {provider: 'custom', base: ${js(cloud.base)}, label: 'Mock', key: ${js(cloud.key)}, models: ['mock-chat']})`);
    await ev(`window.lumen.request('models').then(m => { state.models = m; const s = document.getElementById('model-picker'); renderPickers(); s.value = 'cloud:custom/mock-chat'; s.dispatchEvent(new Event('change')); return 0; })`);
    await app.cdp.waitFor("state.chat?.Model === 'cloud:custom/mock-chat'", 5000);
  });
  after(async () => { await app?.stop(); cloud?.close(); server?.closeAllConnections?.(); server?.close(); });

  test('off by default: research with a cloud model asks for a local model and sends nothing', async () => {
    assert.equal(await ev("connectionsState?.cloud?.webResearch ?? false"), false);
    await ev('researchMode = true; renderToolChips(); 0');
    await app.cdp.type('#prompt', 'What is the secret word of the Marlow lantern festival?');
    await app.cdp.click('#send');
    await app.cdp.waitFor("/local model|yerel model/i.test(document.getElementById('toast').textContent)", 5000);
    assert.equal(cloud.requests.filter(r => r.path === '/v1/chat/completions').length, 0);
    assert.equal(web.length, 0);
  });

  test('Settings → Cloud models has the switch, off, with a note on what is sent', async () => {
    await ev("openSettings('cloud'); 0");
    await app.cdp.waitFor("!!document.getElementById('cloud-web-research')", 10000);
    assert.equal(await ev("document.getElementById('cloud-web-research').checked"), false);
    assert.match(await ev("document.getElementById('cloud-web-research').closest('.setting-row').textContent"), /pages|sayfa/i);
    await app.cdp.click('#cloud-web-research + span');
    await app.cdp.waitFor('connectionsState.cloud.webResearch === true', 5000);
    await ev("setPage('chat'); 0");
  });

  test('when on, the cloud model researches the web and the answer cites the page it read', async () => {
    await ev('researchMode = true; renderToolChips(); 0');
    await app.cdp.click('#send');
    await app.cdp.waitFor("document.querySelectorAll('.message.assistant').length > 0 && state.busy === false", 60000);
    assert.match(await ev("[...document.querySelectorAll('.message.assistant')].at(-1).textContent"), /ZEPHYR-4711/);
    assert.ok(web.includes('/search') && web.includes('/lantern'), 'searched and read the page: ' + web.join(','));
    const sent = cloud.requests.filter(r => r.path === '/v1/chat/completions');
    assert.ok(sent.some(r => JSON.stringify(r.body.messages).includes('ZEPHYR-4711')), 'the page text went to the cloud model');
  });
});
