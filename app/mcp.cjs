'use strict';
// MCP client for servers the user adds by address (Streamable HTTP transport: JSON-RPC over POST, replies as JSON or as an
// event stream). Lumen never starts programs for MCP: a local server is run by the user and connected by its address.
// Tools are off until the user turns each one on, and each call asks for approval unless the user chose otherwise
// (agent.cjs). Tool results are untrusted data for the model.
const {readEvents} = require('./cloud.cjs');

const PROTOCOL = '2025-06-18';
const MAX_BYTES = 1048576;
function short(text, n) { text = String(text || '').replace(/\s+/g, ' ').trim(); return text.length > n ? text.slice(0, n - 1) + '…' : text; }
function mcpError(message, extra = {}) { return Object.assign(Error(message), extra); }

function createMcp({version = 'beta', fetchImpl = fetch} = {}) {
  const sessions = new Map(); // server id -> {sessionId, protocol}
  let seq = 0;

  async function post(server, message, {signal, timeoutMs = 30000, session} = {}) {
    const headers = {'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'lumen.cpp/' + version};
    if (server.token) headers.authorization = 'Bearer ' + server.token;
    if (session?.sessionId) headers['mcp-session-id'] = session.sessionId;
    if (session?.protocol) headers['mcp-protocol-version'] = session.protocol;
    const response = await fetchImpl(server.url, {method: 'POST', headers, body: JSON.stringify(message), redirect: 'error',
      signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(timeoutMs)])}).catch(error => {
      if (signal?.aborted) throw Object.assign(Error('Cancelled'), {cancelled: true});
      throw mcpError(error.name === 'TimeoutError' ? 'The server did not answer in time.' : 'Could not reach the server: ' + short(error.cause?.message || error.message, 160), {code: 'network'});
    });
    if (response.status === 401 || response.status === 403) throw mcpError('The server refused access (' + response.status + '). Check the access token.', {code: 'auth', status: response.status});
    if (response.status === 404 && session?.sessionId) throw mcpError('Session expired.', {code: 'session'});
    if (message.id === undefined) { await response.body?.cancel().catch(() => {}); if (response.status >= 400) throw mcpError('The server refused the notification (' + response.status + ').'); return {response, result: null}; }
    if (!response.ok) { const text = short(await response.text().catch(() => ''), 200); throw mcpError('The server returned ' + response.status + (text ? ': ' + text : '.'), {status: response.status}); }
    const type = String(response.headers.get('content-type') || '');
    let reply = null;
    if (/event-stream/.test(type)) {
      let bytes = 0;
      await readEvents(response.body, data => {
        bytes += data.length; if (bytes > MAX_BYTES) throw mcpError('The server reply is larger than 1 MB.');
        let j; try { j = JSON.parse(data); } catch { return; }
        if (j && j.id === message.id && (j.result !== undefined || j.error)) reply = j;
      }, {signal, stallMs: timeoutMs}).catch(error => { if (!reply) throw error; });
    } else {
      const text = await response.text(); if (text.length > MAX_BYTES) throw mcpError('The server reply is larger than 1 MB.');
      let j; try { j = JSON.parse(text); } catch { throw mcpError('The address did not answer like an MCP server.'); }
      reply = Array.isArray(j) ? j.find(x => x?.id === message.id) : j;
    }
    if (!reply) throw mcpError('The server did not answer the request.');
    if (reply.error) throw mcpError('Server error: ' + short(reply.error.message || JSON.stringify(reply.error), 300), {code: 'rpc', rpc: reply.error.code});
    return {response, result: reply.result};
  }

  async function connect(server, {signal} = {}) {
    const {response, result} = await post(server, {jsonrpc: '2.0', id: ++seq, method: 'initialize', params: {protocolVersion: PROTOCOL, capabilities: {}, clientInfo: {name: 'lumen.cpp', version}}}, {signal});
    if (!result || typeof result !== 'object') throw mcpError('The address did not answer like an MCP server.');
    const session = {sessionId: response.headers.get('mcp-session-id') || null, protocol: typeof result.protocolVersion === 'string' ? result.protocolVersion.slice(0, 20) : PROTOCOL,
      name: short(result.serverInfo?.name || '', 80), tools: !!result.capabilities?.tools};
    await post(server, {jsonrpc: '2.0', method: 'notifications/initialized'}, {signal, session}).catch(() => {});
    sessions.set(server.id, session); return session;
  }
  async function session(server, signal) { return sessions.get(server.id) || connect(server, {signal}); }
  async function request(server, method, params, options = {}) {
    for (let attempt = 0; ; attempt++) {
      const s = await session(server, options.signal);
      try { return (await post(server, {jsonrpc: '2.0', id: ++seq, method, params}, {...options, session: s})).result; }
      catch (error) { if (error.code === 'session' && attempt === 0) { sessions.delete(server.id); continue; } throw error; }
    }
  }

  // Tools the server offers (all pages, at most 64).
  async function listTools(server, {signal} = {}) {
    sessions.delete(server.id); const s = await connect(server, {signal});
    const tools = []; let cursor;
    for (let page = 0; page < 5 && tools.length < 64; page++) {
      const result = await request(server, 'tools/list', cursor ? {cursor} : {}, {signal});
      for (const t of Array.isArray(result?.tools) ? result.tools : []) {
        if (!t || typeof t.name !== 'string' || !/^[A-Za-z0-9_.\-\/]{1,128}$/.test(t.name)) continue;
        const schema = t.inputSchema && typeof t.inputSchema === 'object' && JSON.stringify(t.inputSchema).length <= 16000 ? t.inputSchema : {type: 'object'};
        tools.push({name: t.name, title: short(t.title || t.annotations?.title || '', 80), description: short(t.description || '', 600), inputSchema: schema, readOnly: t.annotations?.readOnlyHint === true});
      }
      cursor = typeof result?.nextCursor === 'string' && result.nextCursor ? result.nextCursor : null; if (!cursor) break;
    }
    return {serverName: s.name, tools: tools.slice(0, 64)};
  }

  // Calls one tool. Returns {text, isError}; non-text parts are described, not passed on.
  async function callTool(server, name, args, {signal} = {}) {
    const result = await request(server, 'tools/call', {name, arguments: args || {}}, {signal, timeoutMs: 60000});
    const parts = Array.isArray(result?.content) ? result.content : [];
    const text = parts.map(p => p?.type === 'text' ? String(p.text || '') : p?.type === 'resource' && typeof p.resource?.text === 'string' ? p.resource.text : p?.type ? '[' + p.type + ' content not shown]' : '').filter(Boolean).join('\n\n')
      || (result?.structuredContent ? JSON.stringify(result.structuredContent) : '');
    return {text: text.slice(0, 200000), isError: result?.isError === true};
  }
  return {listTools, callTool, forget: id => sessions.delete(id)};
}

// A JSON schema the local engine can turn into a grammar: the common subset of an MCP tool's input schema. Anything it does
// not understand becomes "any value", so the server still validates the arguments itself.
function grammarSchema(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 6) return {};
  const out = {};
  const type = Array.isArray(schema.type) ? schema.type.find(t => t !== 'null') : schema.type;
  if (Array.isArray(schema.enum) && schema.enum.length && schema.enum.length <= 50 && schema.enum.every(v => ['string', 'number', 'boolean'].includes(typeof v))) return {enum: schema.enum};
  if (type === 'object' || (!type && schema.properties)) {
    out.type = 'object'; const props = schema.properties && typeof schema.properties === 'object' ? Object.entries(schema.properties).slice(0, 40) : [];
    out.properties = Object.fromEntries(props.map(([k, v]) => [k, grammarSchema(v, depth + 1)]));
    const required = Array.isArray(schema.required) ? schema.required.filter(k => out.properties[k]) : [];
    if (required.length) out.required = required;
    return out;
  }
  if (type === 'array') { out.type = 'array'; out.items = grammarSchema(schema.items, depth + 1); if (Number.isInteger(schema.maxItems) && schema.maxItems <= 100) out.maxItems = schema.maxItems; return out; }
  if (type === 'string') { out.type = 'string'; if (Number.isInteger(schema.maxLength) && schema.maxLength <= 20000) out.maxLength = schema.maxLength; return out; }
  if (type === 'integer' || type === 'number' || type === 'boolean') return {type};
  return {};
}

module.exports = {createMcp, grammarSchema, PROTOCOL};
