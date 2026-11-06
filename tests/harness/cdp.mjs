// Minimal Chrome DevTools Protocol client for driving a Lumen window. No npm dependencies (Node 22+ global WebSocket/fetch).
// connect(port, {target}) -> {evaluate, click, type, waitFor, screenshot, send, errors, close}
import fs from 'node:fs';
import path from 'node:path';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const DEFAULT_TARGET = /^lumen:\/\/app\//;

export async function connect(port, { target = DEFAULT_TARGET, timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let page;
  while (!page) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      page = list.find(t => t.type === 'page' && target.test(t.url) && t.webSocketDebuggerUrl);
    } catch {}
    if (!page) {
      if (Date.now() > deadline) throw new Error(`No page target on port ${port}`);
      await sleep(100);
    }
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP connect failed')); });
  let nextId = 1;
  const waiting = new Map();
  const errors = []; // console errors and uncaught exceptions seen since connect
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) {
      const { resolve, reject } = waiting.get(m.id); waiting.delete(m.id);
      m.error ? reject(new Error(`${m.error.message}`)) : resolve(m.result);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      errors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      errors.push(`log: ${m.params.entry.text} ${m.params.entry.url || ''}`.trim());
    }
  };
  ws.onclose = () => { for (const { reject } of waiting.values()) reject(new Error('CDP closed')); waiting.clear(); };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');

  // Evaluates a JS expression in the page (awaits promises) and returns its JSON value.
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('evaluate failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const q = s => JSON.stringify(s);
  const center = async selector => {
    const box = await evaluate(`(()=>{const e=document.querySelector(${q(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})()`);
    if (!box || !box.w || !box.h) throw new Error(`Element not found or not visible: ${selector}`);
    return box;
  };
  const waitFor = async (expr, ms = 10000) => {
    const end = Date.now() + ms;
    let last;
    while (Date.now() < end) {
      try { last = await evaluate(expr); if (last) return last; } catch (e) { last = e.message; }
      await sleep(100);
    }
    throw new Error(`waitFor timed out after ${ms} ms: ${expr} (last: ${last})`);
  };
  return {
    evaluate, waitFor, send, errors,
    async click(selector) {
      const { x, y } = await center(selector);
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
      }
    },
    async type(selector, text) {
      await evaluate(`document.querySelector(${q(selector)}).focus()`);
      await send('Input.insertText', { text });
    },
    async screenshot(file) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      return file;
    },
    close() { try { ws.close(); } catch {} },
  };
}
