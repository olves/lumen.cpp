// Image-generation models in the catalog (added from Explore) are not offered for chat (v1.0.9): not in the model menu,
// the hidden picker, a new chat's default, the assistant editor or the local API list; the Library still shows them, tagged.
// No model is loaded: the catalog entries only need names.
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/imagemodels.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launch, workRoot } from '../harness/launch.mjs';
import { prepareData } from './data.mjs';

const require = createRequire(import.meta.url);
const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `imagemodels-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const dataDir = path.join(runDir, 'data');
const IMAGE = 'unsloth/Qwen-Image-2.1-GGUF / qwen-image-2.1-Q4_K_M.gguf';
const ENCODER = 'AtomicChat/Qwen-Image-2.1-Turbo-Uncensored-GGUF / Qwen-Image-2.1-Turbo-Uncensored-AD-Q3_K.gguf';
let app;
const ev = expression => app.cdp.evaluate(expression);

describe(`image models stay out of chat lists (${shell})`, () => {
  before(async () => {
    prepareData(dataDir, null);
    // The bundled catalog plus two image entries placed first, so a "first model" default would pick one if not filtered.
    const bundled = require('../../app/backend/models.catalog.json');
    const sha = c => c.repeat(64);
    fs.writeFileSync(path.join(dataDir, 'catalog.json'), JSON.stringify([
      { Name: IMAGE, Repo: 'unsloth/Qwen-Image-2.1-GGUF', File: 'qwen-image-2.1-Q4_K_M.gguf', Sha: sha('a'), Bytes: 4199565024, LocalFile: 'aaaaaaaaaaaa-qwen-image-2.1-Q4_K_M.gguf' },
      { Name: ENCODER, Repo: 'AtomicChat/Qwen-Image-2.1-Turbo-Uncensored-GGUF', File: 'Qwen-Image-2.1-Turbo-Uncensored-AD-Q3_K.gguf', Sha: sha('b'), Bytes: 4180000000, LocalFile: 'bbbbbbbbbbbb-Qwen-Image-2.1-Turbo-Uncensored-AD-Q3_K.gguf' },
      ...bundled,
    ]));
    app = await launch({ shell, dataDir });
    await app.cdp.waitFor('state.ready === true', 30000);
    await ev("setPage('chat'); 0");
  });
  after(async () => { await app?.stop(); });

  test('the core marks both image entries', async () => {
    const marked = await ev(`state.models.filter(m => m.Image).map(m => m.Name)`);
    assert.deepEqual(marked.sort(), [IMAGE, ENCODER].sort());
    assert.ok(await ev('state.models.filter(m => !m.Image).length') > 0, 'chat models remain');
  });

  test('the model menu and hidden picker leave them out', async () => {
    await app.cdp.click('#model-trigger');
    await app.cdp.waitFor("!document.getElementById('model-menu').hidden", 5000);
    const shown = await ev("[...document.querySelectorAll('#model-options .model-option strong')].map(s => s.textContent).join(' | ')");
    assert.doesNotMatch(shown, /Qwen[ -]?Image/i, shown);
    await ev("document.getElementById('model-filter').value = 'image'; document.getElementById('model-filter').dispatchEvent(new Event('input')); 0");
    assert.equal(await ev("document.querySelectorAll('#model-options .model-option').length"), 0, 'searching "image" finds none');
    await ev("document.getElementById('model-filter').value = ''; closeComposerMenus(); 0");
    const options = await ev("[...document.getElementById('model-picker').options].map(o => o.value)");
    assert.ok(!options.includes(IMAGE) && !options.includes(ENCODER));
    const bench = await ev("[...document.getElementById('bench-model').options].map(o => o.value)");
    assert.ok(!bench.includes(IMAGE) && !bench.includes(ENCODER));
  });

  test('a new chat does not default to an image model', async () => {
    assert.ok(![IMAGE, ENCODER].includes(await ev('fresh().Model')));
    assert.ok(![IMAGE, ENCODER].includes(await ev('state.chat.Model')));
  });

  test('a chat that still names an image model moves to a chat model', async () => {
    await ev(`state.chat.Model = ${JSON.stringify(ENCODER)}; renderPickers(); 0`);
    const model = await ev('state.chat.Model');
    assert.notEqual(model, ENCODER);
    assert.equal(await ev("document.getElementById('model-picker').value"), model);
  });

  test('Explore → For you does not recommend them as chat models', async () => {
    await ev("openSettings('explore'); 0");
    await app.cdp.waitFor("document.getElementById('discover-list').children.length > 2", 15000);
    const text = await ev("document.getElementById('discover-list').textContent");
    assert.ok(text.length > 0, 'the For you list rendered');
    assert.doesNotMatch(text, /Qwen[ -]?Image/i);
    await ev("setPage('chat'); 0");
  });

  test('the local API does not list them', async () => {
    // The API server reads request('models') like the renderer; check through the same decorated list.
    const list = await ev("api.request('models').then(l => l.filter(m => m.Installed && !m.Cloud && !m.Image).map(m => m.Name))");
    assert.ok(!list.includes(IMAGE) && !list.includes(ENCODER));
  });
});
