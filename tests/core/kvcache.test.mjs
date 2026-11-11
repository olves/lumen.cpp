// "Tighter" context memory (k8v4: K q8_0 + V q4_0). Measured 11 Nov 2026 (work/kv-q4): near lossless on Qwen2.5-Coder-7B and Qwen3-8B,
// while 4-5 bit keys broke Qwen2.5. Here: the memory estimate, the saved preference and the host arguments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { kvBytes, estimate } = createRequire(import.meta.url)('../../app/modelinfo.cjs');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Qwen2.5-Coder-7B: 28 layers, 4 KV heads, head size 128.
const shape = { layers: 28, sharedLayers: 0, kvHeads: 4, key: 128, value: 128, window: 0, swaShare: 0, keySwa: 0, valueSwa: 0 };

test('k8v4 needs 26/32 bytes per value: 40% of f16, 76% of q8_0', () => {
  const f16 = kvBytes(shape, 32768, 'f16'), q8 = kvBytes(shape, 32768, 'q8_0'), k8v4 = kvBytes(shape, 32768, 'k8v4');
  assert.equal(Math.round(f16 / 1048576), 1792, 'matches llama.cpp: 1792 MiB at 32K f16');
  assert.equal(k8v4 / f16, 26 / 64);
  assert.equal(k8v4 / q8, 26 / 34);
});

test('the estimate needs less memory with k8v4, by exactly the KV difference', () => {
  const model = { Bytes: 4683073248, shape }, hardware = { vramFree: 6.8 * 1024 ** 3, ramFree: 16 * 1024 ** 3 };
  const need = kv => estimate(model, { context: 65536, kv, hardware }).need;
  assert.ok(need('k8v4') < need('q8_0') && need('q8_0') < need('f16'));
  assert.equal(need('q8_0') - need('k8v4'), kvBytes(shape, 65536, 'q8_0') - kvBytes(shape, 65536, 'k8v4'));
});

test('core keeps k8v4 in preferences and passes it to the engine; the host turns it into -ctk q8_0 -ctv q4_0', () => {
  const core = fs.readFileSync(path.join(repo, 'app', 'core.cjs'), 'utf8');
  assert.match(core, /kvCache:\['f16','q8_0','k8v4'\]/);
  assert.match(core, /kv:\['q8_0','k8v4'\]\.includes\(p\.kvCache\)\?p\.kvCache:'f16'/);
  const host = fs.readFileSync(path.join(repo, 'app', 'backend', 'LumenHost.cs'), 'utf8');
  assert.match(host, /kv=="k8v4"\)o\.Kv=kv/);
  assert.match(host, /options\.Kv=="k8v4"\)args\.Append\(" -ctk q8_0 -ctv q4_0"\)/);
});
