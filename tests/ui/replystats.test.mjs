// Per-reply numbers and Continue with a real model: a short reply shows "N tokens · s · tok/s" and no Continue; a reply that
// hits the 512-token response length shows Continue, which sends the continue request as a normal message. The numbers come
// back after reloading the conversation list (conversation-stats.json). Needs an installed chat model; skipped otherwise.
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/replystats.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, workRoot } from '../harness/launch.mjs';
import { pickModel, prepareData } from './data.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `replystats-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data');
const model = pickModel();
let app;
const ev = expression => app.cdp.evaluate(expression);
const shot = name => app?.cdp.screenshot(path.join(runDir, name + '.png')).catch(() => {});
const LAST = "[...document.querySelectorAll('.message.assistant')].at(-1)";

async function send(text) {
  const before = await ev("document.querySelectorAll('.message.assistant').length");
  await app.cdp.type('#prompt', text);
  await app.cdp.click('#send');
  await app.cdp.waitFor(`document.querySelectorAll('.message.assistant').length > ${before}`, 120000);
  await app.cdp.waitFor('state.busy === false', 300000);
}

describe(`reply stats and Continue (${shell})`, { skip: model ? false : 'no installed model' }, () => {
  before(async () => {
    prepareData(dataDir, model);
    app = await launch({ shell, dataDir });
    await app.cdp.waitFor('state.ready === true', 30000);
    await ev("(async () => { state.prefs = await api.preferences({ ...state.prefs, responseTokens: 512, thinking: false }); return 0; })()");
  });
  after(async () => { await app?.stop(); });

  test('a short reply shows its numbers and no Continue', async () => {
    await send('Write one sentence about rain.');
    const r = await ev(`(() => { const m = state.chat.Messages.at(-1); return { stats: m.Stats, text: ${LAST}.querySelector('.reply-stats')?.textContent || '', title: ${LAST}.querySelector('.reply-stats')?.title || '', cont: !!${LAST}.querySelector('.continue-reply') }; })()`);
    assert.ok(r.stats?.tokens > 0, JSON.stringify(r.stats));
    assert.equal(r.stats.cut, false);
    assert.match(r.text, /^[\d.,]+ tokens · [\d.,]+ s( · [\d.,]+ tok\/s)?$/);
    assert.match(r.title, /First token after [\d.,]+ s/);
    assert.equal(r.cont, false);
  });

  test('a reply cut at the response length offers Continue, which sends a normal message', async () => {
    await send('Write a detailed essay of at least 1500 words about the history of lighthouses, in many long paragraphs.');
    const s = await ev('state.chat.Messages.at(-1).Stats');
    assert.equal(s?.cut, true, JSON.stringify(s));
    assert.ok(s.tokens >= 512);
    // Continue sits below the reply (where reading ends), visible without hovering.
    assert.equal(await ev(`(() => { const n = ${LAST}, foot = n.querySelector('.reply-continue'); return !!foot && n.classList.contains('reply-cut') && !!foot.querySelector('.continue-reply').offsetParent && n.querySelector('.message-body').compareDocumentPosition(foot) === Node.DOCUMENT_POSITION_FOLLOWING && getComputedStyle(foot).opacity === '1'; })()`), true, 'Continue below the reply');
    await ev("document.getElementById('chat-scroll').scrollTop = 1e9; 0");
    await shot('cut-reply');
    const before = await ev('state.chat.Messages.length');
    await ev(`${LAST}.querySelector('.continue-reply').click(); 0`);
    await app.cdp.waitFor(`state.chat.Messages.length >= ${before + 2} && state.busy === false`, 300000);
    const turn = await ev(`state.chat.Messages.slice(${before}).map(m => [m.Role, m.Content.slice(0, 40)])`);
    assert.equal(turn[0][0], 'user');
    assert.match(turn[0][1], /^Continue exactly where you stopped/);
    assert.equal(turn[1][0], 'assistant');
    assert.ok(turn[1][1].length > 0);
    // Only the last reply offers Continue.
    assert.equal(await ev("document.querySelectorAll('.continue-reply').length <= 1"), true);
  });

  test('numbers come back from the saved conversation', async () => {
    const saved = await ev("api.request('bootstrap').then(b => b.chats.find(c => c.Id === state.chat.Id).Messages.filter(m => m.Role === 'assistant').map(m => !!m.Stats?.tokens))");
    assert.deepEqual(saved, [true, true, true]);
  });
});
