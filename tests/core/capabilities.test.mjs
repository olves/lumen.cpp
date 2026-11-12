// capabilities.cjs: what the model is told about Lumen. The text must follow the real settings and never contradict them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { describe } = createRequire(import.meta.url)('../../app/capabilities.cjs');

const base = { model: 'DeepSeek V4.1 Flash', cloud: { label: 'DeepSeek' }, web: 'off-cloud', autoResearch: false, vision: 'text-only', documents: 0, workspace: null, mcpTools: 0, imageGen: false };
const words = text => text.split(/\s+/).length;

test('it says it is Lumen and names the model and where it runs', () => {
  const t = describe(base);
  assert.match(t, /^You are Lumen \(lumen\.cpp\)/);
  assert.match(t, /DeepSeek V4\.1 Flash from DeepSeek \(cloud\)/);
  assert.match(describe({ ...base, cloud: null, model: 'Qwen2.5 Coder 7B' }), /running locally on this PC/);
});

test('the 11 Nov case: a cloud model with web off is told web is off and where to turn it on, not that it has no internet', () => {
  const t = describe(base);
  assert.match(t, /Off right now[^\n]*web search[^\n]*Settings → Cloud models → Web research/);
  assert.doesNotMatch(t, /In this conversation you can:[^\n]*search the web/);
  assert.match(describe(base, 'tr'), /Ayarlar → Bulut modelleri → Web araştırması/);
});

test('web on: listed as available, with the right trigger', () => {
  assert.match(describe({ ...base, web: 'on', autoResearch: true }), /you can:[^\n]*search the web and read web pages \(Lumen runs the search when a message needs it/);
  assert.match(describe({ ...base, web: 'on' }), /when the user turns on research/);
  assert.match(describe({ ...base, web: 'off' }), /Settings → Search/);
  assert.match(describe({ ...base, web: 'unavailable' }), /Not available: web access/);
});

test('photos: sees / can be set up / text only', () => {
  assert.match(describe({ ...base, vision: 'sees' }), /you can:[^\n]*see attached photos/);
  assert.match(describe({ ...base, vision: 'projector-missing' }), /Off right now[^\n]*seeing photos/);
  assert.match(describe(base), /Not available:[^\n]*seeing photos/);
});

test('review 12 Nov: a cloud model that could see is told photos are off until the user allows them', () => {
  const t = describe({ ...base, vision: 'needs-consent' });
  assert.doesNotMatch(t, /you can:[^\n]*see attached photos/);
  assert.match(t, /Off right now[^\n]*not yet allowed photos to go to DeepSeek/);
});

test('workspace folder, mode and commands; otherwise how to attach one', () => {
  const t = describe({ ...base, workspace: { name: 'Site', mode: 'auto', commands: true } });
  assert.match(t, /work in the folder of the workspace "Site": file changes and read-only commands run, other commands ask; PowerShell commands included/);
  assert.match(describe(base), /Off right now[^\n]*working in a folder[^\n]*\+ → Workspace folder/);
});

test('short, and the same state always gives the same text (provider cache)', () => {
  const full = { ...base, web: 'on', autoResearch: true, vision: 'sees', documents: 2, workspace: { name: 'A', mode: 'ask', commands: true }, mcpTools: 3, imageGen: true };
  for (const s of [base, full]) { assert.ok(words(describe(s)) < 170, String(words(describe(s)))); assert.equal(describe(s), describe({ ...s })); }
});
