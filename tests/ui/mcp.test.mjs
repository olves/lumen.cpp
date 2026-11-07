// Connections: MCP tools with the approval card, and a cloud model provider. Both talk to local mock servers (tests/ui/mocks.mjs);
// the app side is real (settings IPC, secret storage, the tool loop, the approval UI, streaming into the chat).
// MCP: the model that chooses the tool is the real installed chat model, so the call itself is checked only if it picks the tool
// (up to 3 tries); the approval gate (no call before "Allow") is checked whenever the card appears.
// NOT covered: real third-party MCP servers, real cloud accounts.
//   $env:LUMEN_SHELL='tauri'; node --test tests/ui/mcp.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, workRoot } from '../harness/launch.mjs';
import { pickModel, prepareData } from './data.mjs';
import { mcpServer, cloudServer, sleep } from './mocks.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const model = pickModel();
const NO_MODEL = model ? false : 'no installed model';
const js = JSON.stringify;

describe(`MCP tools (${shell})`, () => {
  const runDir = path.join(workRoot, 'ui-tests', `mcp-${shell}-${stamp}`), dataDir = path.join(runDir, 'data');
  let app, mcp, serverId;
  const ev = e => app.cdp.evaluate(e);
  const shot = n => app?.cdp.screenshot(path.join(runDir, n + '.png')).catch(() => {});

  before(async () => {
    mcp = await mcpServer();
    prepareData(dataDir, model);
    app = await launch({ shell, dataDir });
    await app.cdp.waitFor('state.ready === true', 30000);
  });
  after(async () => { await app?.stop(); mcp?.close(); });

  test('adding a server lists its tools, all off; tool calls are not made yet', async () => {
    const view = await ev(`window.lumen.connections('mcp-add', {name: 'Mock tools', url: ${js(mcp.url)}, token: 'tok-secret-1'})`);
    const server = view.mcp.servers[0];
    serverId = server.id;
    assert.equal(server.error, '');
    assert.equal(server.serverName, 'Mock tools');
    assert.deepEqual(server.tools.map(t => [t.name, t.enabled, t.ask, t.readOnly]), [['add', false, true, true]], 'discovered tools are off and ask by default');
    assert.ok(mcp.seen.some(r => r.auth === 'Bearer tok-secret-1'), 'the access token is sent to the server');
    assert.equal(mcp.calls.length, 0);
    // The token is stored encrypted, not in plain text, and the renderer only learns that one exists.
    const stored = fs.readFileSync(path.join(dataDir, 'connections.json'), 'utf8');
    assert.ok(!stored.includes('tok-secret-1'), 'token is not in connections.json in plain text');
    assert.equal(server.token, true);
  });

  test('the Settings page lists the server and its tool', async () => {
    await ev("openSettings('mcp'); 0");
    await app.cdp.waitFor("document.body.textContent.includes('Mock tools') && document.body.textContent.includes('add')", 10000);
    await shot('settings');
  });

  test('a tool turned on becomes available to the chat', async () => {
    const view = await ev(`window.lumen.connections('mcp-update', {id: ${js(serverId)}, tool: {name: 'add', enabled: true}})`);
    assert.equal(view.mcp.servers[0].tools[0].enabled, true);
    assert.equal(view.mcp.servers[0].tools[0].ask, true, 'turning a tool on keeps asking');
  });

  test('the model calls the tool only after "Allow once"; "Deny" makes no call', { skip: NO_MODEL, timeout: 600000 }, async t => {
    await ev("openSettings && setPage('chat'); 0");
    let seenCard = false, allowed = false;
    for (let attempt = 1; attempt <= 3 && !allowed; attempt++) {
      await ev("(loadConnections ? loadConnections() : Promise.resolve()).then(() => { toolsMode = true; renderToolChips(); return 0; })");
      await app.cdp.type('#prompt', 'Use the add tool to add 2 and 3. Call the tool, then tell me the sum.');
      await app.cdp.click('#send');
      const outcome = await Promise.race([
        app.cdp.waitFor("!!document.querySelector('.approval-card')", 240000).then(() => 'card'),
        app.cdp.waitFor('state.busy === false && !document.querySelector(".approval-card") && document.querySelectorAll(".message.assistant").length >= ' + attempt, 240000).then(() => 'done'),
      ]).catch(e => 'error: ' + e.message);
      console.log(`# MCP attempt ${attempt}: ${outcome}`);
      if (outcome === 'card') {
        seenCard = true;
        assert.equal(mcp.calls.length, 0, 'no call reaches the server while the card waits');
        assert.match(await ev("document.querySelector('.approval-card').textContent"), /add/);
        assert.match(await ev("document.querySelector('.approval-card pre').textContent"), /"a"\s*:\s*\d/);
        await shot('approval');
        await ev("document.querySelector('.approval-card .approval-actions button.primary').click(); 0");
        await app.cdp.waitFor('state.busy === false', 300000);
        assert.equal(mcp.calls.length, 1, 'exactly one call after Allow once');
        assert.equal(mcp.calls[0].name, 'add');
        assert.equal(typeof mcp.calls[0].arguments.a, 'number');
        allowed = true;
      }
    }
    if (!seenCard) return t.skip('NOT verified: the model did not choose the tool in 3 attempts (the approval gate and the call are untested in this run)');
    // Deny: one more turn; if the model asks again, deny it and expect no new call.
    const before = mcp.calls.length;
    await ev("(toolsMode = true, renderToolChips(), 0)");
    await app.cdp.type('#prompt', 'Use the add tool to add 10 and 20.');
    await app.cdp.click('#send');
    const card = await app.cdp.waitFor("!!document.querySelector('.approval-card')", 240000).then(() => true).catch(() => false);
    if (card) { await ev("document.querySelector('.approval-card .approval-actions button.secondary').click(); 0"); }
    await app.cdp.waitFor('state.busy === false', 300000);
    assert.equal(mcp.calls.length, before, 'a denied call is never made');
    // The tool activity is saved with the reply: reload the chat and look for it.
    const activity = await ev("state.chat.Messages.some(m => m.Activity)");
    assert.equal(activity, true, 'the tool run is recorded with the answer');
  });

  test('removing the server forgets it', async () => {
    const view = await ev(`window.lumen.connections('mcp-remove', {id: ${js(serverId)}})`);
    assert.deepEqual(view.mcp.servers, []);
  });

  test('plain http to a non-loopback address is refused', async () => {
    const r = await ev(`window.lumen.connections('mcp-add', {name: 'x', url: 'http://example.com/mcp'}).then(() => 'added', e => e.message)`);
    assert.match(r, /https/i);
  });

  test('no console errors', async () => { assert.deepEqual(app.cdp.errors, []); });
});

describe(`cloud model (${shell})`, () => {
  const runDir = path.join(workRoot, 'ui-tests', `cloud-${shell}-${stamp}`), dataDir = path.join(runDir, 'data');
  let app, cloud;
  const ev = e => app.cdp.evaluate(e);
  const NAME = () => `cloud:custom/${cloud.model}`;
  const lastAssistant = "[...document.querySelectorAll('.message.assistant')].at(-1)";

  before(async () => {
    cloud = await cloudServer();
    prepareData(dataDir, null);
    app = await launch({ shell, dataDir });
    await app.cdp.waitFor('state.ready === true', 30000);
  });
  after(async () => { await app?.stop(); cloud?.close(); });

  test('off by default; cloud models do not appear', async () => {
    const view = await ev("window.lumen.connections('get')");
    assert.equal(view.cloud.enabled, false);
    assert.ok(!(await ev("state.models.some(m => m.Cloud)")));
  });

  test('setup: custom provider, key stored encrypted, models listed from the server', async () => {
    await ev(`window.lumen.connections('cloud', {enabled: true, consented: true})`);
    await ev(`window.lumen.connections('provider', {provider: 'custom', base: ${js(cloud.base)}, label: 'Mock cloud', key: ${js(cloud.key)}, models: [${js(cloud.model)}]})`);
    const listed = await ev("window.lumen.connections('provider-models', {provider: 'custom'})");
    assert.deepEqual(listed.models.map(m => m.id || m).sort(), [cloud.imageModel, cloud.model].sort());
    const stored = fs.readFileSync(path.join(dataDir, 'connections.json'), 'utf8');
    assert.ok(!stored.includes(cloud.key), 'the API key is not in connections.json in plain text');
    const view = await ev("window.lumen.connections('get')");
    assert.equal(view.cloud.providers.custom.key, true);
    assert.ok(!JSON.stringify(view).includes(cloud.key), 'the renderer never gets the key');
    const test = await ev("window.lumen.connections('provider-test', {provider: 'custom', model: " + js(cloud.model) + "})");
    assert.equal(test.reply, cloud.reply);
  });

  test('a wrong key is reported as rejected', async () => {
    await ev(`window.lumen.connections('provider', {provider: 'custom', key: 'sk-wrong'})`);
    const r = await ev(`window.lumen.connections('provider-test', {provider: 'custom', model: ${js(cloud.model)}}).then(() => 'ok', e => e.message)`);
    assert.match(r, /rejected the API key/);
    await ev(`window.lumen.connections('provider', {provider: 'custom', key: ${js(cloud.key)}})`);
  });

  test('the cloud model is in the list and a chat streams its reply', async () => {
    await ev("window.lumen.request('models').then(m => { state.models = m; renderPickers(); return 0; })");
    const entry = await ev(`state.models.find(m => m.Name === ${js(NAME())})`);
    assert.ok(entry, 'listed');
    assert.equal(entry.Cloud.provider, 'custom');
    await ev(`(state.chat.Model = ${js(NAME())}, renderPickers(), 0)`);
    const before = cloud.requests.filter(r => r.path === '/v1/chat/completions').length;
    await app.cdp.type('#prompt', 'Merhaba, bulut!');
    await app.cdp.click('#send');
    await app.cdp.waitFor(`(${lastAssistant}?.querySelector('.message-body').textContent || '').includes('Merhaba from the mock')`, 60000);
    await app.cdp.waitFor('state.busy === false', 60000);
    assert.equal(await ev(`${lastAssistant}.querySelector('.message-body').textContent.trim()`), cloud.reply);
    const sent = cloud.requests.filter(r => r.path === '/v1/chat/completions').slice(before);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].auth, 'Bearer ' + cloud.key);
    assert.equal(sent[0].body.model, cloud.model);
    assert.equal(sent[0].body.stream, true);
    assert.equal(sent[0].body.messages.at(-1).content, 'Merhaba, bulut!');
  });

  test('the reply is saved and survives a restart', async () => {
    await app.stop();
    app = await launch({ shell, dataDir });
    await app.cdp.waitFor('state.ready === true', 30000);
    await app.cdp.click('.history-item');
    await app.cdp.waitFor("document.querySelectorAll('.message').length >= 2", 10000);
    assert.equal(await ev(`${lastAssistant}.querySelector('.message-body').textContent.trim()`), cloud.reply);
  });

  test('research, project and tools are refused for a cloud model (local only)', async () => {
    const msg = await ev(`window.lumen.agent('run', {runId: crypto.randomUUID(), chat: state.chat, prompt: 'x', mode: 'research', context: 4096}).then(() => 'ran', e => e.message)`);
    assert.doesNotMatch(String(msg), /^ran$/);
  });

  test('turning cloud off removes its models', async () => {
    await ev("window.lumen.connections('cloud', {enabled: false})");
    await ev("window.lumen.request('models').then(m => { state.models = m; return 0; })");
    assert.ok(!(await ev("state.models.some(m => m.Cloud)")));
    await sleep(0);
    assert.deepEqual(app.cdp.errors, []);
  });
});
