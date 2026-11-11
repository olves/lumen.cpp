'use strict';
// Which cloud models can see photos (v1.2, ROADMAP-v1.2.md §4C). Lumen sends photos to a cloud model only when it can see them and
// the user agreed once per provider; otherwise only the text read from the photo goes (as in v1.1).
//   sees('cloud:<provider>/<model>') -> 'yes' | 'maybe' | 'no'
// 'maybe' (custom providers, unknown names): Lumen tries; cloud.cjs drops the images and says so when the provider refuses them.
// DeepSeek: per its model list on 8 Nov 2026, V4.1 Flash (deepseek-flash) takes text and images, V4 Pro text only.
const YES = /gpt-4o|gpt-4\.1|gpt-5|^o[34](-|$)|chatgpt-4o|gemini|claude|vision|[-_.]vl([-_.]|$)|pixtral|llava|qwen.*vl|grok-[\w.-]*vision|grok-4|llama-4|deepseek-flash|deepseek-chat/i;
const NO = /deepseek-v4-pro|deepseek-reasoner|gpt-3\.5|^o1-mini|embedding|whisper|tts|-audio|image-?gen|dall-?e/i;

function sees(name) {
  const m = /^cloud:([a-z]+[0-9]?)\/(.+)$/.exec(String(name || ''));
  if (!m) return 'no';
  const [, provider, model] = m;
  if (NO.test(model)) return 'no';
  if (YES.test(model)) return 'yes';
  if (provider === 'gemini') return 'yes';
  if (provider === 'deepseek' || provider === 'openai') return 'no';
  return 'maybe';
}

module.exports = { sees };
