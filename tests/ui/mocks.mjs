// Local stand-ins for the outside world, used by the scenario tests. Everything listens on 127.0.0.1 only.
//   downloadServer  a Hugging Face-like file host (Range, throttling) for LUMEN_TEST_DOWNLOAD_BASE
//   mcpServer       a Streamable HTTP MCP server (JSON-RPC over POST)
//   cloudServer     an OpenAI-compatible provider (chat completions with streaming, models, images)
//   sdServerExe     a compiled stand-in for stable-diffusion.cpp's sd-server.exe (HTTP API of the real one)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

const listen = server => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const readBody = req => new Promise(r => { const parts = []; req.on('data', d => parts.push(d)); req.on('end', () => r(Buffer.concat(parts).toString('utf8'))); });
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function png(width, height, seed = 0) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const o = y * (width * 4 + 1) + 1 + x * 4; raw[o] = (x + seed) % 256; raw[o + 1] = y % 256; raw[o + 2] = 160; raw[o + 3] = 255; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- model file host ----------
// Serves GET /<repo>/resolve/main/<any file> with Range support (every file name gets the same content). The content is pseudo-random bytes derived from `seed`, so its SHA-256
// is known up front. delayMs slows every response chunk (pausing/resuming needs a download that takes a moment).
export async function downloadServer({ bytes = 24 << 20, seed = 'lumen-download-test', delayMs = 0, repo = 'lumen-test/mock-model', file = 'mock-model-q4.gguf' } = {}) {
  const data = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i += 32) crypto.createHash('sha256').update(seed + i).digest().copy(data, i);
  const sha = crypto.createHash('sha256').update(data).digest('hex');
  const state = { delayMs, corrupt: false, requests: [] };
  const server = http.createServer(async (req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    state.requests.push({ url, range: req.headers.range || null });
    if (!url.startsWith(`/${repo}/resolve/main/`)) { res.writeHead(404); return res.end('nope'); }
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const start = range ? Number(range[1]) : 0, end = range && range[2] !== '' ? Math.min(Number(range[2]), bytes - 1) : bytes - 1;
    res.writeHead(range ? 206 : 200, { 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', 'content-length': end - start + 1, etag: '"' + sha.slice(0, 16) + '"',
      ...(range ? { 'content-range': `bytes ${start}-${end}/${bytes}` } : {}) });
    for (let at = start; at <= end; at += 1 << 20) {
      let part = data.subarray(at, Math.min(at + (1 << 20), end + 1));
      if (state.corrupt) { part = Buffer.from(part); part[0] ^= 0xff; }
      if (!res.write(part)) await new Promise(r => res.once('drain', r));
      if (state.delayMs) await sleep(state.delayMs);
      if (res.destroyed) return;
    }
    res.end();
  });
  const port = await listen(server);
  return { base: `http://127.0.0.1:${port}`, sha, bytes, repo, file, state, close: () => { server.closeAllConnections?.(); server.close(); },
    model: name => ({ Name: name, Repo: repo, File: file, Sha: sha, Bytes: bytes }) };
}

// ---------- MCP ----------
// tools: [{name, description, inputSchema, annotations, run(args) -> text}]. calls records every tools/call.
export async function mcpServer({ tools } = {}) {
  tools = tools || [{ name: 'add', description: 'Adds two numbers and returns the sum.', annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] }, run: a => `The sum is ${Number(a.a) + Number(a.b)}.` }];
  const calls = [], seen = [];
  const server = http.createServer(async (req, res) => {
    const text = await readBody(req);
    seen.push({ method: req.method, auth: req.headers.authorization || null, body: text.slice(0, 500) });
    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    let msg; try { msg = JSON.parse(text); } catch { res.writeHead(400); return res.end(); }
    const reply = (result, error) => { res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'mock-session' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...(error ? { error } : { result }) })); };
    if (msg.id === undefined) { res.writeHead(202); return res.end(); }
    switch (msg.method) {
      case 'initialize': return reply({ protocolVersion: msg.params?.protocolVersion || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'Mock tools', version: '1.0' } });
      case 'tools/list': return reply({ tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })) });
      case 'tools/call': {
        const t = tools.find(x => x.name === msg.params?.name);
        if (!t) return reply(null, { code: -32602, message: 'Unknown tool' });
        calls.push({ name: t.name, arguments: msg.params.arguments });
        return reply({ content: [{ type: 'text', text: await t.run(msg.params.arguments || {}) }], isError: false });
      }
      default: return reply(null, { code: -32601, message: 'Method not found' });
    }
  });
  const port = await listen(server);
  return { url: `http://127.0.0.1:${port}/mcp`, calls, seen, close: () => { server.closeAllConnections?.(); server.close(); } };
}

// ---------- cloud provider ----------
// The reply is a fixed sentence (streamed in pieces). requests records what Lumen sent, keys included, so the tests can check them.
export async function cloudServer({ key = 'sk-mock-key-123', reply = 'Merhaba from the mock cloud model.', model = 'mock-chat', imageModel = 'mock-image' } = {}) {
  const requests = [];
  const image = png(320, 192, 7);
  const server = http.createServer(async (req, res) => {
    const text = await readBody(req);
    const url = new URL(req.url, 'http://x');
    let body = null; try { body = JSON.parse(text); } catch {}
    requests.push({ method: req.method, path: url.pathname, auth: req.headers.authorization || null, body });
    if (req.headers.authorization !== 'Bearer ' + key) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } })); }
    if (url.pathname === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: model }, { id: imageModel }] })); }
    if (url.pathname === '/v1/images/generations') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ b64_json: image.toString('base64') }] })); }
    if (url.pathname === '/v1/chat/completions' && typeof server.script === 'function') {
      // Scripted turns for the coding agent: script(body, n) -> {content?, toolCalls?: [{name, args}], usage?}. Streams tool
      // calls in two pieces (name, then arguments) like real providers do.
      const turn = server.script(body, server.turns = (server.turns || 0) + 1) || { content: 'ok' };
      const usage = turn.usage || { prompt_tokens: 1200, completion_tokens: 40, prompt_cache_hit_tokens: server.turns > 1 ? 1000 : 0, prompt_cache_miss_tokens: server.turns > 1 ? 200 : 1200 };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      (turn.toolCalls || []).forEach((c, index) => {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index, id: `call_${server.turns}_${index}`, type: 'function', function: { name: c.name, arguments: '' } }] } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index, function: { arguments: JSON.stringify(c.args) } }] } }] })}\n\n`);
      });
      if (turn.content) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: turn.content } }] })}\n\n`);
      if (turn.delayMs) await sleep(turn.delayMs);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: turn.toolCalls?.length ? 'tool_calls' : 'stop' }], usage })}\n\n`);
      res.write('data: [DONE]\n\n'); return res.end();
    }
    if (url.pathname === '/v1/chat/completions') {
      const parts = reply.match(/.{1,8}/g);
      if (body?.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const p of parts) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`); await sleep(15); }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } })}\n\n`);
        res.write('data: [DONE]\n\n'); return res.end();
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 7 } }));
    }
    res.writeHead(404); res.end('nope');
  });
  const port = await listen(server);
  return { base: `http://127.0.0.1:${port}/v1`, key, model, imageModel, reply, image, requests, setScript: fn => { server.script = fn; server.turns = 0; }, close: () => { server.closeAllConnections?.(); server.close(); } };
}

// ---------- sd-server stand-in ----------
// A small C# program (compiled with the .NET Framework compiler of Windows, like lumen-host) that speaks the HTTP API Lumen uses
// (imagegen.cjs): GET /sdcpp/v1/capabilities, POST /sdcpp/v1/img_gen -> 202 {id}, GET /sdcpp/v1/jobs/{id} (progress preview, then
// completed with b64 PNGs), POST /sdcpp/v1/jobs/{id}/cancel. It reads out.png next to itself and logs every request line to
// requests.log. Env LUMEN_MOCK_SD_STEPS (default 4) sets how many 150 ms polls a job takes.
const SD_SOURCE = `
using System; using System.IO; using System.Net; using System.Text; using System.Collections.Generic; using System.Threading;
class MockSd {
  static Dictionary<string,int> jobs = new Dictionary<string,int>(); static HashSet<string> cancelled = new HashSet<string>(); static int counter = 0;
  static void Main(string[] args) {
    int port = 0; string dir = AppDomain.CurrentDomain.BaseDirectory;
    for (int i = 0; i < args.Length - 1; i++) if (args[i] == "--listen-port") port = int.Parse(args[i + 1]);
    File.WriteAllText(Path.Combine(dir, "args.txt"), string.Join("\\n", args));
    if (Array.IndexOf(args, "--list-devices") >= 0) { Console.WriteLine("Vulkan0: Mock device"); return; }
    string png = Convert.ToBase64String(File.ReadAllBytes(Path.Combine(dir, "out.png")));
    int steps = 4; try { steps = int.Parse(Environment.GetEnvironmentVariable("LUMEN_MOCK_SD_STEPS") ?? "4"); } catch {}
    var l = new HttpListener(); l.Prefixes.Add("http://127.0.0.1:" + port + "/"); l.Start();
    while (true) {
      var c = l.GetContext(); string path = c.Request.Url.AbsolutePath, body = "", json = "{}"; int status = 200;
      using (var r = new StreamReader(c.Request.InputStream, Encoding.UTF8)) body = r.ReadToEnd();
      File.AppendAllText(Path.Combine(dir, "requests.log"), c.Request.HttpMethod + " " + path + " " + body.Replace("\\n", " ") + "\\n");
      lock (jobs) {
        if (path == "/sdcpp/v1/capabilities") json = "{\\"ok\\":true}";
        else if (path == "/sdcpp/v1/img_gen") { string id = "job" + (++counter); jobs[id] = 0; json = "{\\"id\\":\\"" + id + "\\"}"; status = 202; }
        else if (path.EndsWith("/cancel")) { string id = path.Split('/')[4]; cancelled.Add(id); json = "{}"; }
        else if (path.StartsWith("/sdcpp/v1/jobs/")) {
          string id = path.Substring("/sdcpp/v1/jobs/".Length);
          if (!jobs.ContainsKey(id)) { status = 404; json = "{}"; }
          else if (cancelled.Contains(id)) json = "{\\"status\\":\\"cancelled\\"}";
          else { int n = ++jobs[id]; Thread.Sleep(150);
            if (n > steps) json = "{\\"status\\":\\"completed\\",\\"result\\":{\\"images\\":[{\\"b64_json\\":\\"" + png + "\\"}]}}";
            else json = "{\\"status\\":\\"running\\",\\"preview\\":{\\"pass\\":1,\\"step\\":" + n + ",\\"total_steps\\":" + steps + ",\\"b64_json\\":\\"" + png + "\\"}}"; }
        } else status = 404;
      }
      var bytes = Encoding.UTF8.GetBytes(json); c.Response.StatusCode = status; c.Response.ContentType = "application/json";
      c.Response.OutputStream.Write(bytes, 0, bytes.Length); c.Response.Close();
    }
  }
}`;
export function buildSdServer(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(dir, 'MockSd.cs'), exe = path.join(dir, 'sd-server.exe');
  fs.writeFileSync(src, SD_SOURCE);
  const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const r = spawnSync(csc, ['/nologo', '/target:exe', `/out:${exe}`, src], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('csc failed: ' + r.stdout + r.stderr);
  fs.writeFileSync(path.join(dir, 'out.png'), png(512, 384, 3));
  return exe;
}

// Creates a file of `bytes` bytes that takes no disk space (NTFS sparse): the image model packages are several GB.
export function sparseFile(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  const r = spawnSync('fsutil', ['sparse', 'setflag', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('fsutil sparse failed: ' + r.stdout + r.stderr);
  fs.truncateSync(file, bytes);
}
