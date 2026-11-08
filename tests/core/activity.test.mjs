// Activity records (agent.cjs createActivityStore): the steps shown under a reply keep their kind, including the coding
// agent's change steps (p-edit), so a saved reply shows "Changed app.js · +1 −1" and not a search line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { createActivityStore } = createRequire(import.meta.url)('../../app/agent.cjs');

test('p-edit steps keep their kind; unknown kinds still fall back to search', () => {
  const store = createActivityStore(fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-act-')));
  const r = store.record('f'.repeat(32), 1, { route: 'project', tasks: [{ title: 'demo', status: 'done', ops: [
    { kind: 'p-read', label: 'app.js', detail: '1-4' }, { kind: 'p-edit', label: 'app.js', detail: '+1 −1' }, { kind: 'weird', label: 'x' }] }] });
  assert.deepEqual(r.tasks[0].ops.map(o => o.kind), ['p-read', 'p-edit', 'search']);
});
