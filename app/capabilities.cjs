'use strict';
// What the model is told about Lumen (v1.2, ROADMAP-v1.2.md §4A). Without it models describe themselves from their training
// ("I have no internet, I cannot read files…") while Lumen has those tools and the user only has to turn them on (11 Nov 2026:
// DeepSeek in Lumen answered "no live internet" to "research re-library.org").
//   describe(state, language) -> string   pure; the same state gives the same text, so provider caches keep working.
// state (built by the core from the real settings):
//   {model, cloud: null | {label}, web: 'on'|'off-cloud'|'off'|'unavailable', autoResearch, readPages,
//    vision: 'sees'|'projector-missing'|'text-only', documents, workspace: null | {name, mode, commands}, mcpTools, imageGen}
// Kept short (about 150 tokens): every request carries it. Setting paths are in the interface language because the model repeats
// them to the user.

const PATHS = {
  en: { cloudWeb: 'Settings → Cloud models → Web research', web: 'Settings → Search', auto: 'Settings → Agents → Research automatically',
    vision: 'the photo chip → Set up vision', folder: '+ → Workspace folder', mode: 'the mode chip under the message box', cloudPhoto: 'the photo note → Send photos to the provider' },
  tr: { cloudWeb: 'Ayarlar → Bulut modelleri → Web araştırması', web: 'Ayarlar → Arama', auto: 'Ayarlar → Ajanlar → Otomatik araştır',
    vision: 'fotoğraf çipi → Görmeyi kur', folder: '+ → Çalışma alanı klasörü', mode: 'mesaj kutusunun altındaki mod çipi', cloudPhoto: 'fotoğraf notu → Fotoğrafları sağlayıcıya gönder' },
};
const MODE_TEXT = { ask: 'asks the user before every change and command', 'accept-edits': 'file changes run, commands ask first', plan: 'read only (Plan mode)', auto: 'file changes and read-only commands run, other commands ask', full: 'full access, nothing asks' };

function describe(state = {}, language = 'en') {
  const p = PATHS[language === 'tr' ? 'tr' : 'en'];
  const can = [], off = [], not = [];
  // Web
  if (state.web === 'on') can.push(`search the web and read web pages (Lumen runs the search${state.autoResearch ? ' when a message needs it' : ' when the user turns on research for a message'}; cite the sources it returns)`);
  else if (state.web === 'off-cloud') off.push(`web search and reading pages, for cloud models (${p.cloudWeb})`);
  else if (state.web === 'off') off.push(`web search and reading pages (${p.web})`);
  else not.push('web access in this setup');
  // Files the user attaches
  can.push('read documents the user attaches (PDF, Word, text and code files)' + (state.documents ? `; ${state.documents} attached now` : ''));
  if (state.vision === 'sees') can.push('see attached photos');
  else if (state.vision === 'projector-missing') off.push(`seeing photos with this model (${p.vision}); until then you get only the text read from a photo`);
  else if (state.vision === 'needs-consent') off.push(`seeing photos: the user has not yet allowed photos to go to ${state.cloud?.label || 'this provider'} (${p.cloudPhoto}); until then you get only the text read from a photo`);
  else not.push('seeing photos with this model (you get only the text read from a photo)');
  // Workspace folder and commands
  if (state.workspace) can.push(`work in the folder of the workspace "${state.workspace.name}": ${MODE_TEXT[state.workspace.mode] || MODE_TEXT.ask}${state.workspace.commands ? '; PowerShell commands included' : ''}`);
  else off.push(`working in a folder on the user's PC: list, read and change files, run commands (${p.folder})`);
  if (state.mcpTools) can.push(`use ${state.mcpTools} connected tool${state.mcpTools === 1 ? '' : 's'} the user approved`);
  if (state.imageGen) can.push('make pictures with the image model the user chose');
  const who = `You are Lumen (lumen.cpp), an assistant app on the user's Windows PC. The model answering is ${state.model || 'a language model'}${state.cloud ? ` from ${state.cloud.label} (cloud)` : ', running locally on this PC'}.`;
  return [
    who,
    `In this conversation you can: ${can.join('; ')}.`,
    off.length ? `Off right now, the user can turn these on: ${off.join('; ')}.` : '',
    not.length ? `Not available: ${not.join('; ')}.` : '',
    'Never claim you lack a capability listed as available. If something is off, say so and where to turn it on. Lumen runs the tools; you do not need to say you cannot browse.',
  ].filter(Boolean).join('\n');
}

module.exports = { describe, PATHS };
