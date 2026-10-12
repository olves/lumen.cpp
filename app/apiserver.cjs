'use strict';
// Local OpenAI-compatible API (off by default). Listens on 127.0.0.1 only and needs the token shown in Settings → Connections.
// Other programs on this computer can use Lumen's local models through it: GET /v1/models, POST /v1/chat/completions
// (streaming or not). Requests go through the same single engine as the chat, one at a time. No CORS headers are sent, and
// the Host header must be this computer, so web pages cannot use it. Cloud models are not offered here.
const http = require('node:http'), crypto = require('node:crypto');

const MAX_BODY = 4 * 1048576;
function json(res, status, body, extra = {}) { const text = JSON.stringify(body); res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), ...extra}); res.end(text); }
function fail(res, status, message, type = 'invalid_request_error', code = null) { json(res, status, {error: {message, type, code}}); }
function sameToken(a, b) { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); }
function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    if (content.some(p => p && p.type && p.type !== 'text')) throw Object.assign(Error('Only text content is supported.'), {status: 400});
    return content.map(p => String(p?.text || '')).join('');
  }
  if (content == null) return '';
  throw Object.assign(Error('Invalid message content.'), {status: 400});
}
const num = (v, min, max) => v === undefined || v === null ? undefined : (Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : NaN);

function createApiServer({getConfig, models, complete, contextFor, cancel = () => {}, log = () => {}}) {
  let server = null, port = 0, stats = {requests: 0, errors: 0, last: null, lastError: ''}, queue = 0;

  async function body(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(Error('Request body is larger than 4 MB.'), {status: 413})); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(Error('The body is not valid JSON.'), {status: 400})); } });
      req.on('error', reject);
    });
  }

  async function chatCompletions(req, res, payload) {
    const list = (await models()).filter(m => m.Installed && !m.Cloud);
    const model = list.find(m => m.Name === payload.model) || list.find(m => m.File === payload.model) || (payload.model === undefined || payload.model === 'default' ? list[0] : null);
    if (!model) return fail(res, 404, 'Model not found. GET /v1/models lists the downloaded models.', 'invalid_request_error', 'model_not_found');
    if (!Array.isArray(payload.messages) || !payload.messages.length || payload.messages.length > 80) return fail(res, 400, 'messages must be a list of 1–80 messages.');
    const messages = payload.messages.map(m => {
      const role = m?.role === 'developer' ? 'system' : m?.role;
      if (!['system', 'user', 'assistant'].includes(role)) throw Object.assign(Error('Only system, user and assistant messages are supported.'), {status: 400});
      return {role, content: textOf(m.content)};
    });
    if (messages.reduce((n, m) => n + m.content.length, 0) > 200000) return fail(res, 400, 'Messages are longer than 200,000 characters.');
    const maxTokens = Math.round(num(payload.max_completion_tokens ?? payload.max_tokens, 1, 4096) ?? 1024);
    const temperature = num(payload.temperature, 0, 2), topP = num(payload.top_p, 0, 1), seed = num(payload.seed, -1, 2147483647);
    const presence = num(payload.presence_penalty, -2, 2), frequency = num(payload.frequency_penalty, -2, 2), topK = num(payload.top_k, 0, 500), minP = num(payload.min_p, 0, 1);
    if ([maxTokens, temperature, topP, seed, presence, frequency, topK, minP].some(Number.isNaN)) return fail(res, 400, 'A sampling value is out of range.');
    const sampling = Object.fromEntries(Object.entries({topP, topK: topK === undefined ? undefined : Math.round(topK), minP, presencePenalty: presence, frequencyPenalty: frequency, seed: seed === undefined ? undefined : Math.round(seed)}).filter(([, v]) => v !== undefined));
    const stream = payload.stream === true, id = 'chatcmpl-' + crypto.randomBytes(12).toString('hex'), created = Math.floor(Date.now() / 1000);
    // The engine runs one request at a time and its cancel stops whatever is running. A client that leaves is only cancelled
    // once its own reply is streaming; before that the request finishes unseen instead of stopping someone else's reply.
    let begun = false, gone = false;
    const started = () => { if (!begun) { begun = true; if (gone) cancel(); } };
    res.on('close', () => { if (!res.writableFinished) { gone = true; if (begun) cancel(); } });
    const context = await contextFor(model.Name);
    if (queue >= 4) return fail(res, 429, 'Lumen is busy with other requests. Try again shortly.', 'rate_limit_error');
    queue++;
    try {
      if (stream) {
        res.writeHead(200, {'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive'});
        const chunk = delta => res.write('data: ' + JSON.stringify({id, object: 'chat.completion.chunk', created, model: model.Name, choices: [{index: 0, delta, finish_reason: null}]}) + '\n\n');
        chunk({role: 'assistant', content: ''});
        const result = await complete({model: model.Name, contextSize: context, messages, maxTokens: Math.max(16, maxTokens), temperature: temperature ?? 0.7, sampling, stream: true,
          onChunk: text => { started(); if (!gone) chunk({content: text}); }, onReasoning: text => { started(); if (!gone) chunk({reasoning_content: text}); }});
        if (gone) return;
        res.write('data: ' + JSON.stringify({id, object: 'chat.completion.chunk', created, model: model.Name, choices: [{index: 0, delta: {}, finish_reason: result.finish === 'length' ? 'length' : 'stop'}],
          usage: {prompt_tokens: result.promptTokens || 0, completion_tokens: result.completionTokens || 0, total_tokens: (result.promptTokens || 0) + (result.completionTokens || 0)}}) + '\n\n');
        res.end('data: [DONE]\n\n');
      } else {
        const result = await complete({model: model.Name, contextSize: context, messages, maxTokens: Math.max(16, maxTokens), temperature: temperature ?? 0.7, sampling, stream: false});
        if (gone) return;
        json(res, 200, {id, object: 'chat.completion', created, model: model.Name, choices: [{index: 0, message: {role: 'assistant', content: result.content || ''}, finish_reason: result.finish === 'length' ? 'length' : 'stop'}],
          usage: {prompt_tokens: result.promptTokens || 0, completion_tokens: result.completionTokens || 0, total_tokens: (result.promptTokens || 0) + (result.completionTokens || 0)}});
      }
    } finally { queue--; }
  }

  async function handle(req, res) {
    const config = getConfig();
    // Only this computer's own addresses, so a web page cannot reach the server through DNS rebinding.
    const host = String(req.headers.host || '').toLowerCase();
    if (!new RegExp('^(127\\.0\\.0\\.1|localhost|\\[::1\\]):' + port + '$').test(host)) return fail(res, 403, 'Unknown host.');
    if (req.method === 'OPTIONS') { res.writeHead(403); return res.end(); }
    const auth = String(req.headers.authorization || ''); const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
    if (!sameToken(token, config.token)) return fail(res, 401, 'Missing or wrong API key. Use the token from Lumen → Settings → Connections → Local API.', 'authentication_error', 'invalid_api_key');
    const url = new URL(req.url, 'http://localhost'); stats.requests++; stats.last = new Date().toISOString();
    if (req.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/models')) {
      const list = (await models()).filter(m => m.Installed && !m.Cloud);
      return json(res, 200, {object: 'list', data: list.map(m => ({id: m.Name, object: 'model', created: 0, owned_by: 'lumen', name: m.Display || m.Name, file: m.File}))});
    }
    if (req.method === 'POST' && (url.pathname === '/v1/chat/completions' || url.pathname === '/chat/completions')) return chatCompletions(req, res, await body(req));
    return fail(res, 404, 'Not found. Supported: GET /v1/models, POST /v1/chat/completions.');
  }

  function start() {
    const config = getConfig(); if (!config.enabled) return stop();
    if (server && port === config.port) return Promise.resolve(status());
    return stop().then(() => new Promise((resolve) => {
      const s = http.createServer((req, res) => {
        handle(req, res).catch(error => {
          stats.errors++; stats.lastError = String(error.message || error).slice(0, 200);
          if (error.cancelled || /Cancelled/.test(error.message)) { if (!res.headersSent) fail(res, 499, 'Cancelled.'); else res.end(); return; }
          if (!res.headersSent) fail(res, error.status || 500, error.status ? error.message : 'Lumen could not answer: ' + String(error.message).slice(0, 300), error.status ? 'invalid_request_error' : 'server_error');
          else { try { res.write('data: ' + JSON.stringify({error: {message: String(error.message).slice(0, 300)}}) + '\n\n'); } catch {} res.end(); }
        });
      });
      s.requestTimeout = 0; s.headersTimeout = 20000;
      s.on('error', error => { stats.lastError = error.code === 'EADDRINUSE' ? 'Port ' + config.port + ' is already in use.' : String(error.message).slice(0, 200); log('[api] ' + stats.lastError); server = null; port = 0; resolve(status()); });
      s.listen(config.port, '127.0.0.1', () => { server = s; port = config.port; stats.lastError = ''; log('[api] listening on 127.0.0.1:' + port); resolve(status()); });
    }));
  }
  function stop() { return new Promise(resolve => { if (!server) { port = 0; return resolve(status()); } const s = server; server = null; port = 0; s.close(() => resolve(status())); s.closeAllConnections?.(); }); }
  function status() { return {running: !!server, port: server ? port : 0, address: server ? 'http://127.0.0.1:' + port + '/v1' : '', ...stats, busy: queue > 0}; }
  return {start, stop, status};
}

module.exports = {createApiServer};
