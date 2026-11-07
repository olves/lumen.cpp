// The local OpenAI-compatible API (Settings -> Connections -> Local API): off by default, key required, own addresses only, models
// and chat completions (plain and streamed) answered by the real installed model, stops when turned off.
// Real: the app, the API server, the chat model (needs one). Nothing is mocked; the client is this test.
//   $env:LUMEN_SHELL='tauri'; node --test tests/ui/localapi.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { launch, workRoot } from '../harness/launch.mjs';
import { freePort } from '../harness/procs.mjs';
import { pickModel, prepareData } from './data.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `localapi-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data');
const model = pickModel();
const NO_MODEL = model ? false : 'no installed model';
let app, port, token;
const ev = e => app.cdp.evaluate(e);

// A raw HTTP request, so the Host header and the method are exactly what the test says.
const raw = (method, pathname, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) } }, res => {
    const parts = []; res.on('data', d => parts.push(d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(parts).toString('utf8') }));
  });
  req.on('error', reject); req.setTimeout(240000, () => req.destroy(new Error('timeout')));
  req.end(body ? JSON.stringify(body) : undefined);
});
const auth = () => ({ authorization: 'Bearer ' + token });

describe(`local API (${shell})`, () => {
  before(async () => {
    prepareData(dataDir, model);
    app = await launch({ shell, dataDir });
    await app.cdp.waitFor('state.ready === true', 30000);
    port = await freePort();
  });
  after(async () => { await app?.stop(); });

  test('off by default: nothing listens', async () => {
    const view = await ev("window.lumen.connections('get')");
    assert.equal(view.api.enabled, false);
    // The port the test will use later has no listener while the setting is off.
    await assert.rejects(() => raw('GET', '/v1/models'));
  });

  test('turning it on creates a key and starts the server', async () => {
    const view = await ev(`window.lumen.connections('api', {enabled: true, port: ${port}})`);
    assert.equal(view.api.enabled, true);
    token = view.api.token;
    assert.match(token, /^lumen-[A-Za-z0-9_-]{20,}$/);
    // The settings page shows the address.
    await app.cdp.waitFor(`(async () => (await window.lumen.connections('get')).api.enabled)()`, 5000);
    const r = await raw('GET', '/v1/models', { headers: { host: `127.0.0.1:${port}`, ...auth() } });
    assert.equal(r.status, 200);
  });

  test('the key is required; the Host must be this computer; no CORS', async () => {
    let r = await raw('GET', '/v1/models');
    assert.equal(r.status, 401);
    assert.equal(JSON.parse(r.text).error.code, 'invalid_api_key');
    r = await raw('GET', '/v1/models', { headers: { authorization: 'Bearer lumen-wrong' } });
    assert.equal(r.status, 401);
    r = await raw('GET', '/v1/models', { headers: { ...auth(), host: 'evil.example:' + port } });
    assert.equal(r.status, 403, 'a rebinding Host is refused even with the key');
    r = await raw('OPTIONS', '/v1/chat/completions', { headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    assert.equal(r.status, 403);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
    r = await raw('GET', '/v1/nothing', { headers: auth() });
    assert.equal(r.status, 404);
  });

  test('GET /v1/models lists the installed local models only', async () => {
    const r = await raw('GET', '/v1/models', { headers: auth() });
    assert.equal(r.status, 200);
    const body = JSON.parse(r.text);
    assert.equal(body.object, 'list');
    const installed = await ev("window.lumen.request('models').then(m => m.filter(x => x.Installed && !x.Cloud).map(x => x.Name))");
    assert.deepEqual(body.data.map(x => x.id).sort(), installed.sort());
    assert.ok(body.data.length >= 1);
  });

  test('malformed requests are refused with 400', async () => {
    for (const body of [{}, { model: 'nope', messages: [] }, { model: 'x', messages: [{ role: 'tool', content: 'a' }] },
      { model: 'x', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }] }]) {
      const r = await raw('POST', '/v1/chat/completions', { headers: auth(), body });
      assert.ok(r.status >= 400 && r.status < 500, `${JSON.stringify(body).slice(0, 60)} -> ${r.status} ${r.text.slice(0, 120)}`);
    }
    const bad = await raw('POST', '/v1/chat/completions', { headers: { ...auth(), 'content-type': 'application/json' } });
    assert.ok(bad.status >= 400);
  });

  test('chat completion with the real model', { skip: NO_MODEL, timeout: 300000 }, async () => {
    const name = (JSON.parse((await raw('GET', '/v1/models', { headers: auth() })).text)).data[0].id;
    const r = await raw('POST', '/v1/chat/completions', { headers: auth(), body: { model: name, max_tokens: 24, temperature: 0, messages: [{ role: 'user', content: 'Say hello in one short sentence.' }] } });
    assert.equal(r.status, 200, r.text.slice(0, 300));
    const body = JSON.parse(r.text);
    assert.equal(body.choices[0].message.role, 'assistant');
    assert.ok(body.choices[0].message.content.trim().length > 0, 'the model answered');
    assert.ok(body.usage?.completion_tokens > 0, 'usage is reported');
  });

  test('streamed chat completion ends with [DONE]', { skip: NO_MODEL, timeout: 300000 }, async () => {
    const name = (JSON.parse((await raw('GET', '/v1/models', { headers: auth() })).text)).data[0].id;
    const r = await raw('POST', '/v1/chat/completions', { headers: auth(), body: { model: name, stream: true, max_tokens: 24, messages: [{ role: 'user', content: 'Count: one, two, three.' }] } });
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/event-stream/);
    const events = r.text.split(/\n\n/).map(b => b.replace(/^data: /, '').trim()).filter(Boolean);
    assert.equal(events.at(-1), '[DONE]');
    const text = events.slice(0, -1).map(e => JSON.parse(e).choices?.[0]?.delta?.content || '').join('');
    assert.ok(text.trim().length > 0, 'streamed text arrived');
  });

  test('the app still chats while the API is on', { skip: NO_MODEL, timeout: 300000 }, async () => {
    await app.cdp.type('#prompt', 'Hi');
    await app.cdp.click('#send');
    await app.cdp.waitFor("document.querySelectorAll('.message.assistant').length >= 1", 120000);
    await app.cdp.waitFor('state.busy === false', 240000);
    assert.ok((await ev("document.querySelector('.message.assistant .message-body').textContent")).length > 0);
  });

  test('turning it off stops the server', async () => {
    const view = await ev("window.lumen.connections('api', {enabled: false})");
    assert.equal(view.api.enabled, false);
    await assert.rejects(() => raw('GET', '/v1/models', { headers: auth() }));
  });

  test('no console errors', async () => { assert.deepEqual(app.cdp.errors, []); });
});
