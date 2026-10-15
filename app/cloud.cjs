'use strict';
// Cloud models (optional, off by default): OpenAI-compatible chat completions with streaming. Only conversations whose
// model the user set to a cloud model are sent, and only to that provider. Keys come from connections.cjs (DPAPI).
// Unknown fields some providers reject are dropped on a second attempt instead of failing the reply.

function short(text, n) { text = String(text || '').replace(/\s+/g, ' ').trim(); return text.length > n ? text.slice(0, n - 1) + '…' : text; }
function cloudError(code, message, status) { return Object.assign(Error(message), {code, status}); }

async function errorFrom(response, provider) {
  let detail = '';
  try { const text = (await response.text()).slice(0, 4000); try { const j = JSON.parse(text); detail = j?.error?.message || j?.message || j?.error || text; } catch { detail = text; } } catch {}
  detail = short(typeof detail === 'string' ? detail : JSON.stringify(detail), 300);
  const s = response.status;
  if (s === 401 || s === 403) return cloudError('key', provider + ' rejected the API key' + (detail ? ': ' + detail : '.'), s);
  if (s === 402) return cloudError('credits', provider + ': no credits left on this account' + (detail ? ' (' + detail + ')' : '.'), s);
  if (s === 404) return cloudError('model', provider + ': model or address not found' + (detail ? ' (' + detail + ')' : '.'), s);
  if (s === 429) return cloudError('rate-limit', provider + ' is limiting requests or the quota is used up' + (detail ? ': ' + detail : '.'), s);
  if (s >= 500) return cloudError('busy', provider + ' is unavailable right now (' + s + ').', s);
  return cloudError('request', provider + ' refused the request (' + s + ')' + (detail ? ': ' + detail : '.'), s);
}

// Reads a text/event-stream body and calls onData for each "data:" payload. Stops at [DONE].
async function readEvents(body, onData, {signal, stallMs = 90000}) {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '', timer = null, stalled = false;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; reader.cancel().catch(() => {}); }, stallMs); };
  arm();
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (signal?.aborted) throw Object.assign(Error('Cancelled'), {cancelled: true});
      if (done) break; arm();
      buffer += decoder.decode(value, {stream: true});
      let cut;
      while ((cut = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const block = buffer.slice(0, cut); buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, '');
        const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
        if (!data) continue; if (data.trim() === '[DONE]') return;
        onData(data);
      }
    }
    if (stalled) throw cloudError('stalled', 'The provider stopped sending the reply.');
  } finally { clearTimeout(timer); }
}

function createCloud({connections, version = 'beta', fetchImpl = fetch}) {
  function target(provider) {
    const base = connections.baseOf(provider); if (!base) throw cloudError('setup', 'Set the provider address in Settings → Cloud models.');
    const key = connections.cloudKey(provider);
    if (!key && provider !== 'custom') throw cloudError('key', 'Add an API key for ' + connections.providerLabel(provider) + ' in Settings → Cloud models.');
    const headers = {'content-type': 'application/json', accept: 'text/event-stream, application/json', 'user-agent': 'lumen.cpp/' + version};
    if (key) headers.authorization = 'Bearer ' + key;
    if (provider === 'openrouter') { headers['x-title'] = 'lumen.cpp'; headers['http-referer'] = 'https://github.com/olves/lumen.cpp'; }
    return {base, headers, label: connections.providerLabel(provider)};
  }

  async function listModels(provider, {signal} = {}) {
    const {base, headers, label} = target(provider);
    const response = await fetchImpl(base + '/models', {headers, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000)});
    if (!response.ok) throw await errorFrom(response, label);
    const json = await response.json();
    const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : Array.isArray(json) ? json : [];
    return [...new Set(list.map(m => typeof m === 'string' ? m : m?.id || m?.name).filter(x => typeof x === 'string').map(x => x.replace(/^models\//, '')))]
      .filter(x => /^[A-Za-z0-9][A-Za-z0-9._:\/@+-]{0,127}$/.test(x)).sort().slice(0, 800);
  }

  // messages: [{role, content}] (text only). Returns {content, reasoning, usage, finish}.
  async function chat({provider, model, messages, maxTokens = 1024, temperature, sampling = {}, signal, onChunk, onReasoning}) {
    const {base, headers, label} = target(provider);
    const full = {model, messages, stream: true, stream_options: {include_usage: true}};
    // OpenAI's newer models only take max_completion_tokens; the other providers use max_tokens.
    if (provider === 'openai') full.max_completion_tokens = maxTokens; else full.max_tokens = maxTokens;
    if (Number.isFinite(temperature)) full.temperature = temperature;
    const map = {topP: 'top_p', presencePenalty: 'presence_penalty', frequencyPenalty: 'frequency_penalty', seed: 'seed'};
    for (const [k, field] of Object.entries(map)) if (Number.isFinite(sampling[k]) && !(k === 'seed' && sampling[k] < 0)) full[field] = sampling[k];
    const minimal = {model, messages, stream: true, ...(provider === 'openai' ? {max_completion_tokens: maxTokens} : {max_tokens: maxTokens})};
    let response;
    for (const body of [full, minimal]) {
      response = await fetchImpl(base + '/chat/completions', {method: 'POST', headers, body: JSON.stringify(body), redirect: 'error',
        signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(600000)])});
      if (response.ok) break;
      // A 400 often means a field this provider or model does not accept (temperature on reasoning models, stream_options…).
      if (response.status === 400 && body === full) { await response.text().catch(() => ''); continue; }
      throw await errorFrom(response, label);
    }
    if (!response.ok) throw await errorFrom(response, label);
    let content = '', reasoning = '', usage = null, finish = null;
    const type = String(response.headers.get('content-type') || '');
    if (!/event-stream/.test(type)) { // a provider that ignored stream:true
      const j = await response.json(); const choice = j?.choices?.[0];
      content = String(choice?.message?.content || ''); reasoning = String(choice?.message?.reasoning_content || choice?.message?.reasoning || '');
      if (reasoning) onReasoning?.(reasoning); if (content) onChunk?.(content);
      return {content, reasoning, usage: j?.usage || null, finish: choice?.finish_reason || null};
    }
    await readEvents(response.body, data => {
      let j; try { j = JSON.parse(data); } catch { return; }
      if (j?.error) throw cloudError('request', label + ': ' + short(j.error.message || JSON.stringify(j.error), 300));
      if (j?.usage) usage = j.usage;
      const choice = j?.choices?.[0]; if (!choice) return;
      const d = choice.delta || {};
      const think = d.reasoning_content || d.reasoning || '';
      if (typeof think === 'string' && think) { reasoning += think; onReasoning?.(think); }
      if (typeof d.content === 'string' && d.content) { content += d.content; onChunk?.(d.content); }
      if (choice.finish_reason) finish = choice.finish_reason;
    }, {signal});
    return {content, reasoning, usage, finish};
  }
  // Images from a provider: Gemini image models ("gemini-…-image") through Gemini's own generateContent; everything else
  // through the OpenAI-compatible /images/generations (gpt-image-1, dall-e-3, Imagen on Gemini's compatible endpoint…).
  // Returns image buffers (PNG/JPEG/WebP as the provider sends them).
  async function generateImage({provider, model, prompt, shape = 'square', count = 1, signal}) {
    const {base, headers, label} = target(provider);
    const timeout = () => AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(300000)]);
    const out = [];
    if (provider === 'gemini' && /^gemini-/.test(model)) {
      const key = connections.cloudKey(provider), native = base.replace(/\/openai$/, '');
      const aspect = {square: '1:1', landscape: '16:9', portrait: '9:16'}[shape] || '1:1';
      for (let i = 0; i < count; i++) {
        const response = await fetchImpl(native + '/models/' + encodeURIComponent(model) + ':generateContent', {method: 'POST', redirect: 'error', signal: timeout(),
          headers: {'content-type': 'application/json', 'x-goog-api-key': key, 'user-agent': headers['user-agent']},
          body: JSON.stringify({contents: [{role: 'user', parts: [{text: prompt}]}], generationConfig: {responseModalities: ['TEXT', 'IMAGE'], imageConfig: {aspectRatio: aspect}}})});
        if (!response.ok) throw await errorFrom(response, label);
        const j = await response.json();
        const parts = (j?.candidates || []).flatMap(c => c?.content?.parts || []).filter(p => p?.inlineData?.data || p?.inline_data?.data);
        if (!parts.length) throw cloudError('empty', label + ' returned no image' + (j?.promptFeedback?.blockReason ? ' (blocked: ' + j.promptFeedback.blockReason + ').' : '.'));
        for (const p of parts) out.push(Buffer.from((p.inlineData || p.inline_data).data, 'base64'));
      }
      return out.slice(0, count);
    }
    const size = /^dall-e-3/.test(model) ? {square: '1024x1024', landscape: '1792x1024', portrait: '1024x1792'}[shape] : /^dall-e-2/.test(model) ? '1024x1024' : {square: '1024x1024', landscape: '1536x1024', portrait: '1024x1536'}[shape];
    const body = {model, prompt, n: /^dall-e-3/.test(model) ? 1 : count, ...(size && provider === 'openai' ? {size} : {}), ...(/^dall-e|^imagen/.test(model) || provider !== 'openai' ? {response_format: 'b64_json'} : {})};
    const rounds = body.n === count ? 1 : count;
    for (let i = 0; i < rounds; i++) {
      const response = await fetchImpl(base + '/images/generations', {method: 'POST', headers: {...headers, accept: 'application/json'}, body: JSON.stringify(body), redirect: 'error', signal: timeout()});
      if (!response.ok) throw await errorFrom(response, label);
      const j = await response.json();
      for (const item of Array.isArray(j?.data) ? j.data : []) {
        if (item?.b64_json) out.push(Buffer.from(item.b64_json, 'base64'));
        else if (typeof item?.url === 'string' && /^https:\/\//.test(item.url)) {
          const r = await fetchImpl(item.url, {redirect: 'follow', signal: timeout()}); if (!r.ok) throw cloudError('download', label + ': the image could not be downloaded (' + r.status + ').');
          const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 25 * 1048576) throw cloudError('download', label + ': the image is larger than 25 MB.'); out.push(buf);
        }
      }
    }
    if (!out.length) throw cloudError('empty', label + ' returned no image.');
    return out.slice(0, count);
  }
  return {listModels, chat, generateImage};
}

module.exports = {createCloud, readEvents, errorFrom};
