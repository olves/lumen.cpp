// v1.2 photos and cloud models: a model that can see gets the photo as an image once the user agreed for the provider; before that
// (and for a model that cannot see) only the text read from it goes. A provider that refuses images gets text and the user is told.
// Mock cloud provider; the photo is a real PNG dropped on the message box.
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/vision.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, workRoot } from '../harness/launch.mjs';
import { prepareData } from './data.mjs';
import { cloudServer } from './mocks.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `vision-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const js = v => JSON.stringify(v);
let app, cloud;
const ev = e => app.cdp.evaluate(e);
const lastBody = () => cloud.requests.filter(r => r.path === '/v1/chat/completions').at(-1).body;
const hasImage = body => body.messages.some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'image_url' && /^data:image\/png;base64,/.test(p.image_url.url)));

async function dropPhoto() {
  await ev(`(async () => {
    const c = document.createElement('canvas'); c.width = 96; c.height = 48; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 96, 48); g.fillStyle = '#c00'; g.fillRect(8, 8, 30, 30);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'red.png', { type: 'image/png' }));
    document.querySelector('.composer').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    return 0; })()`);
  await app.cdp.waitFor("document.querySelectorAll('#photo-attachments .photo-card').length === 1", 30000);
}
async function sendText(text) {
  const before = await ev("document.querySelectorAll('.message.assistant').length");
  await app.cdp.type('#prompt', text); await app.cdp.click('#send');
  await app.cdp.waitFor(`document.querySelectorAll('.message.assistant').length > ${before} && state.busy === false`, 15000).catch(async e => {
    console.log('# DEBUG', JSON.stringify(await ev("({toast: document.getElementById('toast').textContent, busy: state.busy, prompt: $('prompt').value, msgs: state.chat.Messages.length, cards: [...document.querySelectorAll('.approval-card')].map(c => c.textContent.slice(0, 120))})")));
    throw e;
  });
}
async function useModel(id) {
  await ev(`window.lumen.request('models').then(m => { state.models = m; state.chat = fresh(${js(id)}); upsert(state.chat); const s = document.getElementById('model-picker'); renderPickers(); s.value = ${js(id)}; s.dispatchEvent(new Event('change')); renderMessages(); return 0; })`);
}

describe(`photos and cloud models (${shell})`, () => {
  before(async () => {
    cloud = await cloudServer({ model: 'gpt-4o' });
    prepareData(path.join(runDir, 'data'), null);
    app = await launch({ shell, dataDir: path.join(runDir, 'data') });
    await app.cdp.waitFor('state.ready === true', 30000);
    await ev(`window.lumen.connections('cloud', {enabled: true, consented: true})`);
    await ev(`window.lumen.connections('provider', {provider: 'custom', base: ${js(cloud.base)}, label: 'Mock', key: ${js(cloud.key)}, models: ['gpt-4o', 'deepseek-v4-pro', 'my-model']})`);
    await useModel('cloud:custom/gpt-4o');
  });
  after(async () => { await app?.stop(); cloud?.close(); });

  test('a model that sees: the hint offers to send photos to the provider; until then only text goes', async () => {
    await dropPhoto();
    await app.cdp.waitFor("!!document.querySelector('.cloud-photo-allow')", 10000);
    assert.match(await ev("document.getElementById('photo-mode-hint').textContent"), /can see photos[^]*Mock/);
    assert.doesNotMatch(await ev("document.getElementById('photo-mode-hint').textContent"), /This engine/);
    await sendText('What color is the square?');
    assert.equal(hasImage(lastBody()), false, 'no image before the user agreed');
  });

  test('after "Send photos to Mock" the photo goes as an image and is marked as seen', async () => {
    await dropPhoto();
    await app.cdp.waitFor("!!document.querySelector('.cloud-photo-allow')", 10000);
    await ev("document.querySelector('.cloud-photo-allow').click(); 0");
    await app.cdp.waitFor("(state.prefs.cloudPhotos || []).includes('custom')", 5000);
    assert.match(await ev("document.getElementById('photo-mode-hint').textContent"), /Mock can see these photos/);
    await sendText('And now?');
    assert.equal(hasImage(lastBody()), true);
    await app.cdp.waitFor('state.chat.Messages.some(m => m.ImagesSeen)', 5000);
  });

  test('a model that cannot see: only text, and the hint says so', async () => {
    await useModel('cloud:custom/deepseek-v4-pro');
    await dropPhoto();
    assert.match(await ev("document.getElementById('photo-mode-hint').textContent"), /cannot see photos/);
    await sendText('Describe it.');
    assert.equal(hasImage(lastBody()), false);
  });

  test('a provider that refuses images: text only, and a notice', async () => {
    await useModel('cloud:custom/my-model');
    cloud.setScript(body => body.messages.some(m => Array.isArray(m.content)) ? { status: 400, error: 'image input not supported' } : { content: 'Text only reply.' });
    await dropPhoto();
    await sendText('Look at this.');
    await app.cdp.waitFor("/did not accept the photos/.test(document.getElementById('toast').textContent)", 10000);
    assert.equal(hasImage(lastBody()), false);
  });
});
