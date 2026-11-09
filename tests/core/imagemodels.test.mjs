// Image-generation GGUFs (text-to-image repositories) must not be offered as chat models (v1.0.9).
//   node --test tests/core/imagemodels.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { imageModelOf, createModelInfo } = require('../../app/modelinfo.cjs');

test('known text-to-image repositories and files are image models', () => {
  for (const m of [
    { Repo: 'unsloth/Qwen-Image-2.1-GGUF', File: 'qwen-image-2.1-Q4_K_M.gguf' },
    { Repo: 'AtomicChat/Qwen-Image-2.1-Turbo-Uncensored-GGUF', File: 'Qwen-Image-2.1-Turbo-Uncensored-AD-Q3_K.gguf' },
    { Repo: 'leejet/Z-Image-Turbo-GGUF', File: 'z_image_turbo-Q4_K.gguf' },
    { Repo: 'city96/FLUX.1-dev-gguf', File: 'flux1-dev-Q4_K_S.gguf' },
    { Repo: 'gpustack/stable-diffusion-xl-base-1.0-GGUF', File: 'sdxl-Q8_0.gguf' },
    { Repo: 'local/models', File: 'something.gguf', arch: 'qwen_image' },
  ]) assert.equal(imageModelOf(m, m.arch ? { shape: { arch: m.arch } } : null), true, m.Repo + ' ' + m.File);
});

test('chat and vision chat models are not image models', () => {
  for (const m of [
    { Repo: 'Qwen/Qwen2.5-Coder-7B-Instruct-GGUF', File: 'qwen2.5-coder-7b-instruct-q4_k_m.gguf' },
    { Repo: 'unsloth/Qwen2.5-VL-7B-Instruct-GGUF', File: 'Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf' },
    { Repo: 'unsloth/gemma-4-E2B-it-GGUF', File: 'gemma-4-E2B-it-Q4_K_M.gguf' },
    { Repo: 'bartowski/Imagine-7B-GGUF', File: 'Imagine-7B-Q4_K_M.gguf' },
    { Repo: 'mradermacher/Fluxion-3B-GGUF', File: 'Fluxion-3B.Q4_K_M.gguf' },
    { Name: 'cloud:openai/gpt-image-1', Cloud: { provider: 'openai' } },
  ]) assert.equal(imageModelOf(m, null), false, (m.Repo || m.Name) + ' ' + (m.File || ''));
});

test('decorate marks image models with Image:true and leaves others alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-img-'));
  const info = createModelInfo(dir);
  const out = info.decorate([
    { Name: 'a', Repo: 'unsloth/Qwen-Image-2.1-GGUF', File: 'qwen-image-2.1-Q4_K_M.gguf', Installed: false },
    { Name: 'b', Repo: 'Qwen/Qwen2.5-Coder-7B-Instruct-GGUF', File: 'qwen2.5-coder-7b-instruct-q4_k_m.gguf', Installed: false },
  ]);
  assert.equal(out[0].Image, true);
  assert.equal(out[1].Image, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});
