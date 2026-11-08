'use strict';
// Token usage, cache hits and cost of a coding task. Providers report usage differently: DeepSeek gives
// prompt_cache_hit_tokens / prompt_cache_miss_tokens, OpenAI prompt_tokens_details.cached_tokens, the local engine
// {prompt, generated}. Prices are per million tokens, set by the user (Settings → Coding); a model without a price shows only
// token counts and is limited by tokens alone.

function normalizeUsage(usage) {
  const u = usage || {};
  const input = Number(u.prompt_tokens ?? u.prompt) || 0;
  const cached = Number(u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens) || 0;
  const output = Number(u.completion_tokens ?? u.generated) || 0;
  return { input, cached: Math.min(cached, input), output };
}

function addUsage(totals, usage) {
  const t = totals || { input: 0, cached: 0, output: 0, steps: 0 }, u = normalizeUsage(usage);
  return { input: t.input + u.input, cached: t.cached + u.cached, output: t.output + u.output, steps: (t.steps || 0) + 1 };
}

const cacheRate = totals => totals && totals.input > 0 ? totals.cached / totals.input : null;

function costOf(modelKey, totals, prices) {
  const p = prices?.[modelKey]; if (!p || !totals) return null;
  const amount = ((totals.input - totals.cached) * p.input + totals.cached * (p.cachedInput ?? p.input) + totals.output * p.output) / 1e6;
  return { amount, currency: p.currency || 'USD' };
}

function overBudget(totals, cost, settings) {
  if (totals && settings?.taskTokens > 0 && totals.input + totals.output > settings.taskTokens) return 'tokens';
  if (cost && settings?.taskMoney > 0 && cost.amount > settings.taskMoney) return 'money';
  return null;
}

module.exports = { normalizeUsage, addUsage, cacheRate, costOf, overBudget };
