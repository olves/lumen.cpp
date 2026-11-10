// permissions.cjs: the one decision table of the agent's permission modes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { decide, offers, MODES, DEFAULT_MODE, validMode } = createRequire(import.meta.url)('../../app/permissions.cjs');

const a = (mode, risk) => decide(mode, risk).action;

test('new workspaces start in Ask', () => {
  assert.equal(DEFAULT_MODE, 'ask');
  assert.deepEqual(MODES, ['ask', 'accept-edits', 'plan', 'auto', 'full']);
});

test('the full table inside the folder', () => {
  const table = {
    //              read     write    exec     exec-harmless
    ask:            ['allow', 'ask',   'ask',   'ask'],
    'accept-edits': ['allow', 'allow', 'ask',   'ask'],
    plan:           ['allow', 'deny',  'deny',  'deny'],
    auto:           ['allow', 'allow', 'ask',   'allow'],
    full:           ['allow', 'allow', 'allow', 'allow'],
  };
  for (const [mode, row] of Object.entries(table)) {
    assert.deepEqual([a(mode, { kind: 'read' }), a(mode, { kind: 'write' }), a(mode, { kind: 'exec' }), a(mode, { kind: 'exec', harmless: true })], row, mode);
  }
});

test('outside the folder: every mode but Full asks each time with a warning; Plan only reads', () => {
  for (const mode of ['ask', 'accept-edits', 'auto']) for (const kind of ['read', 'write', 'exec']) {
    assert.deepEqual(decide(mode, { kind, outside: true, harmless: true }), { action: 'ask', warn: 'outside' }, mode + ' ' + kind);
  }
  assert.deepEqual(decide('plan', { kind: 'read', outside: true }), { action: 'ask', warn: 'outside' });
  assert.deepEqual(decide('plan', { kind: 'write', outside: true }), { action: 'deny', warn: 'outside' });
  assert.deepEqual(decide('plan', { kind: 'exec', outside: true }), { action: 'deny', warn: 'outside' });
  for (const kind of ['read', 'write', 'exec']) assert.deepEqual(decide('full', { kind, outside: true }), { action: 'allow', warn: null });
});

test('unknown mode falls back to Ask, unknown kind is treated as a command', () => {
  assert.equal(a('yolo', { kind: 'write' }), 'ask');
  assert.equal(a('auto', { kind: 'delete-everything' }), 'ask');
  assert.equal(a('auto', {}), 'ask');
  assert.equal(validMode('yolo'), false);
});

test('Plan offers no writing or running tools', () => {
  assert.deepEqual(offers('plan'), { write: false, exec: false });
  assert.deepEqual(offers('ask'), { write: true, exec: true });
});
