// app/testhook.cjs (loaded only with --ui-check): the dialog bypasses UI tests use on both shells.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { install } = require('../../app/testhook.cjs');
const platform = { dialog: { open: async () => ({ real: 'open' }), save: async () => ({ real: 'save' }) } };

test('without test variables the real dialogs answer', async () => {
  const hook = install({ platform, env: {} });
  assert.deepEqual(await hook.openDialog({}), { real: 'open' });
  assert.deepEqual(await hook.saveDialog({ defaultPath: 'x.md' }), { real: 'save' });
});

test('LUMEN_TEST_FILES answers open dialogs, Turkish names included', async () => {
  const file = 'C:\\w\\Şubat raporu.pdf';
  const hook = install({ platform, env: { LUMEN_TEST_FILES: JSON.stringify([file]) } });
  assert.deepEqual(await hook.openDialog({}), { canceled: false, filePaths: [file] });
  assert.throws(() => install({ platform, env: { LUMEN_TEST_FILES: '{"a":1}' } }), /JSON array/);
});

test('LUMEN_TEST_SAVE_DIR answers save dialogs with the default file name in that folder', async () => {
  const dir = 'C:\\w\\saved';
  const hook = install({ platform, env: { LUMEN_TEST_SAVE_DIR: dir } });
  assert.deepEqual(await hook.saveDialog({ defaultPath: 'lumen-chat.md' }), { canceled: false, filePath: path.join(dir, 'lumen-chat.md') });
  assert.deepEqual(await hook.saveDialog({ defaultPath: 'C:\\elsewhere\\SKILL.md' }), { canceled: false, filePath: path.join(dir, 'SKILL.md') });
  assert.deepEqual(await hook.openDialog({}), { real: 'open' });
});

test('LUMEN_TEST_DOWNLOAD_BASE is honoured only for a loopback http origin', () => {
  const base = 'http://127.0.0.1:4567';
  assert.equal(install({ platform, env: { LUMEN_TEST_DOWNLOAD_BASE: base } }).overrides.downloadBase, base);
  for (const bad of ['https://127.0.0.1:4567', 'http://example.com', 'http://127.0.0.1:4567/x', 'http://localhost:4567', ''])
    assert.equal(install({ platform, env: { LUMEN_TEST_DOWNLOAD_BASE: bad } }).overrides.downloadBase, null, bad);
  assert.equal(install({ platform, env: {} }).overrides.downloadBase, null);
});
