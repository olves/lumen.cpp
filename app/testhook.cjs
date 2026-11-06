// Test hook, loaded only with --ui-check. Installed by the core (core.cjs), so every shell gets it. Depends only on
// { platform, env }, never on electron directly.
//   platform.dialog.open(options) -> {canceled, filePaths}   the real open dialog (platform.cjs)
//   platform.dialog.save(options) -> {canceled, filePath}    the real save dialog
// LUMEN_TEST_FILES: JSON array of paths. When set, open dialogs return those paths instead of asking.
// LUMEN_TEST_SAVE_DIR: a folder. When set, save dialogs return <folder>\<file name of options.defaultPath> instead of asking.
// The update/import overrides below are returned only here, so they cannot take effect outside test mode.
'use strict';
const fs = require('fs');
const path = require('path');

function install({ platform, env = {} }) {
  let files = null;
  if (env.LUMEN_TEST_FILES) {
    try { files = JSON.parse(env.LUMEN_TEST_FILES); } catch { throw Error('LUMEN_TEST_FILES must be a JSON array of paths.'); }
    if (!Array.isArray(files) || !files.every(f => typeof f === 'string')) throw Error('LUMEN_TEST_FILES must be a JSON array of paths.');
  }
  const saveDir = env.LUMEN_TEST_SAVE_DIR || null;
  return {
    overrides: {
      updateApi: env.LUMEN_UPDATE_API || undefined,
      updateKey: env.LUMEN_UPDATE_KEY ? fs.readFileSync(env.LUMEN_UPDATE_KEY, 'utf8') : undefined,
      importHome: env.LUMEN_IMPORT_HOME || null,
    },
    openDialog: options => files
      ? Promise.resolve({ canceled: false, filePaths: [...files] })
      : platform.dialog.open(options),
    saveDialog: options => saveDir
      ? Promise.resolve({ canceled: false, filePath: path.join(saveDir, path.basename(String(options?.defaultPath || 'saved'))) })
      : platform.dialog.save(options),
  };
}

module.exports = { install };
