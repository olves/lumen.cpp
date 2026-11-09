'use strict';
// Reasoning effort ("how hard the model thinks") that a model accepts as reasoning_effort. Decided by the model's own name as
// well as the provider, because the same models are reached through several providers (DeepSeek directly, through
// OpenRouter or a custom OpenAI-compatible address). DeepSeek's /models lists low, high and max (default high, 8 Nov 2026);
// OpenAI reasoning models (o-series, GPT-5) take low, medium and high. Local models and other providers have no levels here:
// local models only have thinking on/off. Gemini 2.5/3 take low, medium and high. Anthropic is left out on purpose: its
// OpenAI-compatible layer does not reliably honor reasoning_effort (Claude's effort needs the native Messages API).
const DEEPSEEK = { levels: ['low', 'high', 'max'], def: 'high' };
const OPENAI = { levels: ['low', 'medium', 'high'], def: 'medium' };
const NONE = { levels: [], def: null };

function effortOf(modelName) {
  const m = /^cloud:([a-z]+)\/(.+)$/.exec(String(modelName || ''));
  if (!m) return { ...NONE, levels: [] };
  const [, provider, id] = m, name = id.toLowerCase();
  if (provider === 'deepseek' || /(^|\/)deepseek[-/]/.test(name)) return { ...DEEPSEEK, levels: [...DEEPSEEK.levels] };
  if (/(^|\/)(o[1-9](-mini|-pro)?|gpt-5[\w.-]*)$/.test(name)) return { ...OPENAI, levels: [...OPENAI.levels] };
  // Gemini 2.5 and 3.x think; Google's OpenAI-compatible endpoint maps reasoning_effort to their thinking level or budget.
  if (/(^|\/)gemini-(2\.5|3)([.-]|$)/.test(name)) return { levels: ['low', 'medium', 'high'], def: null };
  return { ...NONE, levels: [] };
}

module.exports = { effortOf, EFFORTS: ['low', 'medium', 'high', 'max'] };
