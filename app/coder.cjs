'use strict';
// The coding agent (spec docs/superpowers/specs/2026-11-08-coding-agent-design.md). One loop for cloud models (native tool
// calls through cloud.chat) and local models (JSON steps through engine.complete) over the conversation's project folder:
// list, find, search and read files, and — when the user allowed edits — change or create files through codewrite.cjs, each
// change shown as a diff and applied only after approval. The request starts the same way at every step (stable system text
// and tools, append-only transcript) so providers can serve it from their cache; the transcript is compacted rarely, at 75 % of
// the window. Usage, cache hits and cost are summed per task and checked against the user's limits after every step.
const crypto = require('node:crypto');
const ctx = require('./codecontext.cjs');
const cost = require('./codecost.cjs');
const { createProjectWriter } = require('./codewrite.cjs');
const { createProjectTools } = require('./projects.cjs');

const APPROVAL_MS = 10 * 60 * 1000, KEEP_STEPS = 8, MAX_REPEAT_FAIL = 3, CLOUD_STEP_TOKENS = 8192, LOCAL_STEP_TOKENS = 4096;
const short = (text, n) => { const s = String(text ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const READ_TOOLS = new Set(['list_dir', 'find_files', 'search_text', 'read_file']);

// A JSON-step schema for local models built from the same tool definitions the cloud gets.
function stepSchema(tools) {
  return { oneOf: tools.map(t => { const p = t.function.parameters; return { type: 'object', properties: { action: { const: t.function.name }, ...p.properties }, required: ['action', ...(p.required || [])], additionalProperties: false }; }) };
}
function parseLocal(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let value; try { value = JSON.parse(raw); } catch { const m = /\{[\s\S]*\}/.exec(raw); if (m) try { value = JSON.parse(m[0]); } catch {} }
  if (!value || typeof value !== 'object' || typeof value.action !== 'string') return null;
  const { action, ...args } = value; return { name: action, args };
}

function createCoder({ cloud, engine, store, checkpointsDir, emit = () => {}, log = () => {} }) {
  const runs = new Map(), approvals = new Map();

  function waitApproval(runId, callId, signal) {
    return new Promise(resolve => {
      const done = decision => { clearTimeout(timer); approvals.delete(callId); signal.removeEventListener('abort', onAbort); resolve(decision); };
      const onAbort = () => done('skip');
      const timer = setTimeout(() => done('timeout'), APPROVAL_MS);
      signal.addEventListener('abort', onAbort, { once: true });
      approvals.set(callId, { runId, done });
    });
  }

  async function run(options) {
    const { runId, chat, msgIndex, prompt, model, cloudTarget, contextSize, language = 'en', binding, allowEdits, systemPrompt = '' } = options;
    if (runs.size) throw Error('Another run is active.');
    const controller = new AbortController(), signal = controller.signal; runs.set(runId, controller);
    const send = event => emit({ runId, ...event });
    const settings = store.settings(), local = !cloudTarget;
    const modelKey = cloudTarget ? `${cloudTarget.provider}/${cloudTarget.model}` : null;
    const project = createProjectTools(binding);
    const writer = createProjectWriter({ root: binding.root, checkpointsDir, allowSensitive: binding.allow || [], maxCreateBytes: local ? 12 * 1024 : 200 * 1024 });
    const taskId = runId, info = await project.info();
    const tools = ctx.toolDefinitions(allowEdits, { createBytes: local ? 12 * 1024 : 200 * 1024 });
    const system = ctx.systemText({ projectName: info.name, allowEdits, language }) + (systemPrompt.trim() ? '\n\nThe user\'s instructions for this conversation:\n' + short(systemPrompt.trim(), 12000) : '');
    // Cloud: the whole session transcript continues (cache + memory). Local: only the last task's summary (host limits).
    const saved = store.get(chat.Id);
    let entries = local ? [] : saved.entries.slice();
    if (local) { const last = saved.tasks.filter(t => !t.undone).at(-1); if (last?.summary) entries.push({ role: 'note', msg: msgIndex, text: `Previous task: ${short(last.summary, 2000)}${last.files?.length ? ' Changed files: ' + last.files.join(', ') : ''}` }); }
    const fresh = !entries.some(e => e.role === 'user');
    let userText = prompt;
    if (fresh) { const tree = await project.list('.', 2); userText += `\n\nPROJECT TREE (depth 2${tree.truncated ? ', truncated' : ''}):\n${tree.entries.join('\n') || '(empty)'}`; }
    const startLength = entries.length;
    entries.push({ role: 'user', msg: msgIndex, text: userText });

    const task = { id: 'P1', title: info.name, goal: short(prompt, 240), status: 'running', ops: [], result: '', error: '' };
    const publicTask = () => ({ id: task.id, title: task.title, goal: task.goal, status: task.status, model, ops: task.ops, result: task.result, error: task.error });
    send({ type: 'start', model, provider: null, webOn: false, project: info.name });
    send({ type: 'plan', route: 'project', tasks: [publicTask()] });
    send({ type: 'phase', phase: 'task', detail: task.id });

    let totals = { input: 0, cached: 0, output: 0, steps: 0 }, answer = null, budgetStop = null, applyAll = false, lastInput = 0, perSecond = null, stopReason = '';
    const fails = new Map(), seen = new Map(), readFiles = new Map();
    const turns = () => entries.filter(e => e.role === 'user').length;
    const status = (extra = {}) => send({ type: 'coding-status', steps: totals.steps, turns: turns(), input: totals.input, cached: totals.cached, output: totals.output, cacheRate: cost.cacheRate(totals), contextUsed: lastInput, contextSize, perSecond, ...extra });
    const render = () => local ? ctx.toJsonStepMessages(system, entries) : ctx.toChatMessages(system, entries);

    try {
      for (let step = 1; step <= settings.maxSteps && answer === null; step++) {
        if (signal.aborted) break;
        // Compaction: rare and in one go (each one costs one cache miss); fewer kept steps only if 8 still do not fit.
        if (ctx.estimateTokens(render()) >= 0.75 * contextSize) {
          for (let keep = KEEP_STEPS; keep >= 1; keep--) { entries = ctx.compact(entries, { keepSteps: keep }); if (ctx.estimateTokens(render()) < 0.6 * contextSize) break; }
          status({ compacted: true });
        }
        const started = Date.now();
        let content = '', calls = [];
        if (local) {
          const r = await engine.complete({ model, contextSize, messages: render(), schema: stepSchema(tools), maxTokens: Math.min(LOCAL_STEP_TOKENS, Math.floor(contextSize / 4)), temperature: 0.2, signal, timeoutMs: 180000 });
          totals = cost.addUsage(totals, { prompt: r.promptTokens, generated: r.completionTokens }); lastInput = r.promptTokens || 0;
          const parsed = parseLocal(r.content);
          if (parsed) calls = [{ id: `s${step}`, name: parsed.name, args: parsed.args, raw: null }]; else content = String(r.content || '');
          perSecond = r.completionTokens && Date.now() > started ? r.completionTokens / ((Date.now() - started) / 1000) : null;
        } else {
          const r = await cloud.chat({ provider: cloudTarget.provider, model: cloudTarget.model, messages: render(), tools, maxTokens: CLOUD_STEP_TOKENS, temperature: 0.2, reasoningEffort: settings.deepThinking ? 'high' : 'low', signal });
          totals = cost.addUsage(totals, r.usage); lastInput = cost.normalizeUsage(r.usage).input;
          content = String(r.content || ''); calls = (r.toolCalls || []).map(c => ({ id: c.id || crypto.randomUUID(), name: c.name, args: null, raw: c.arguments }));
          const out = cost.normalizeUsage(r.usage).output; perSecond = out && Date.now() > started ? out / ((Date.now() - started) / 1000) : null;
        }
        const taskCost = cost.costOf(modelKey, totals, settings.prices);
        status({ cost: taskCost });

        if (!calls.length) { answer = content.trim() || (language === 'tr' ? 'Yanıt üretilemedi.' : 'No answer was produced.'); entries.push({ role: 'assistant', msg: msgIndex, step, text: content }); break; }
        // Parse arguments; a call that cannot be read gets an error result so the model can correct itself.
        for (const c of calls) if (c.args === null) { try { c.args = JSON.parse(c.raw || '{}'); if (!c.args || typeof c.args !== 'object') throw 0; } catch { c.invalid = 'Invalid arguments: send a JSON object that matches the tool.'; c.args = {}; } }
        entries.push({ role: 'assistant', msg: msgIndex, step, text: content, calls: calls.map(c => ({ id: c.id, name: c.name, args: c.args })) });
        for (const c of calls) {
          const finishing = c.name === 'finish' && !c.invalid;
          if (finishing) { answer = String(c.args.summary || content || '').trim(); entries.push({ role: 'tool', msg: msgIndex, step, id: c.id, name: c.name, args: {}, result: 'finished' }); continue; }
          const result = await callTool(c, step);
          entries.push({ role: 'tool', msg: msgIndex, step, id: c.id, name: c.name, args: c.args, result: result.text, ...(result.error ? { error: true } : {}) });
          if (result.error) {
            const key = c.name + JSON.stringify(c.args) + (c.raw || '');
            const n = (fails.get(key) || 0) + 1; fails.set(key, n);
            if (n >= MAX_REPEAT_FAIL) { stopReason = language === 'tr' ? `Aynı hatalı adım üç kez tekrarlandığı için durduruldu: ${short(result.text, 200)}` : `Stopped: the same failing step was repeated three times (${short(result.text, 200)}).`; answer = stopReason; }
          }
          if (signal.aborted) break;
        }
        if (signal.aborted) break;
        const over = cost.overBudget(totals, taskCost, settings);
        if (over && answer === null) { budgetStop = over; answer = language === 'tr' ? `Görev sınırına ulaşıldı (${over === 'tokens' ? 'token' : 'tutar'}). Devam etmek için yeni bir mesaj gönder.` : `The task limit was reached (${over}). Send a new message to continue.`; }
      }
      if (answer === null && !signal.aborted) answer = language === 'tr' ? `Adım sınırına (${settings.maxSteps}) ulaşıldı.` : `The step limit (${settings.maxSteps}) was reached.`;
      if (signal.aborted) throw Object.assign(Error('Cancelled'), { cancelled: true });
      task.status = 'done'; task.result = answer ? short(answer, 200) : ''; send({ type: 'task', task: publicTask() });
      return finishRun({ content: answer });
    } catch (error) {
      if (signal.aborted || error.cancelled) { task.status = 'cancelled'; send({ type: 'task', task: publicTask() }); return finishRun({ content: '', cancelled: true }); }
      task.status = 'failed'; task.error = short(error.message, 200); send({ type: 'task', task: publicTask() });
      finishRun({ content: '', failed: true });
      throw error;
    } finally { runs.delete(runId); send({ type: 'end' }); }

    function finishRun(extra) {
      const files = writer.changedFiles(taskId), taskCost = cost.costOf(modelKey, totals, settings.prices);
      store.replaceEntries(chat.Id, entries);
      if (totals.steps) store.addTask(chat.Id, { taskId, msg: msgIndex, files, totals, cost: taskCost, summary: short(extra.content, 2000), ...(budgetStop ? { budgetStop } : {}) });
      status({ cost: taskCost, done: true });
      const sources = [...readFiles.values()].map((r, i) => ({ id: 'F' + (i + 1), title: r.path, path: r.path, start: r.start, end: r.end, site: (language === 'tr' ? 'satır ' : 'lines ') + r.start + '–' + r.end, url: '', file: true, read: true }));
      return { route: 'project', taskId, files, totals, cost: taskCost, ...(budgetStop ? { budgetStop } : {}), sources, tasks: [publicTask()], ...extra };
    }

    async function callTool(c, step) {
      if (c.invalid) return { error: true, text: c.invalid };
      const allowed = tools.some(t => t.function.name === c.name);
      if (!allowed) return { error: true, text: `Unknown tool "${c.name}". Use one of: ${tools.map(t => t.function.name).join(', ')}.` };
      const a = c.args;
      if (READ_TOOLS.has(c.name)) {
        const key = c.name + JSON.stringify(a);
        if (seen.has(key)) return { text: 'You already did that. Use the earlier result or try something else.' };
        const op = { kind: { list_dir: 'p-list', find_files: 'p-find', search_text: 'p-grep', read_file: 'p-read' }[c.name], label: a.query || a.path || a.pattern || '.', status: 'running', detail: '' };
        task.ops.push(op); send({ type: 'task', task: publicTask() });
        try {
          let text;
          if (c.name === 'list_dir') { const r = await project.list(a.path || '.', a.depth || 2); text = `list_dir ${r.path}${r.truncated ? ' (truncated)' : ''}:\n${r.entries.join('\n') || '(empty)'}`; op.detail = String(r.entries.length); }
          else if (c.name === 'find_files') { const r = await project.find(a.pattern); text = `find_files "${r.pattern}": ${r.files.length} file(s)${r.truncated ? ' (truncated)' : ''}\n${r.files.join('\n')}`; op.detail = String(r.files.length); }
          else if (c.name === 'search_text') { const r = await project.search(a.query, { path: a.path || '.', signal }); text = `search_text "${r.query}" in ${r.path}: ${r.matches.length} match(es)${r.truncated ? ' (truncated; narrow the search)' : ''}\n${r.matches.map(m => `${m.path}:${m.line}: ${m.text}`).join('\n')}`; op.detail = String(r.matches.length); }
          else { const r = await project.read(a.path, a.start_line || 1, a.end_line); text = `read_file ${r.path} lines ${r.start}-${r.end} of ${r.totalLines}${r.truncated ? ' (more lines follow; read them with start_line)' : ''}:\n${r.text}`; op.label = r.path; op.detail = `${r.start}-${r.end}`; readFiles.set(r.path + ':' + r.start, { path: r.path, start: r.start, end: r.end }); }
          seen.set(key, true); op.status = 'done'; send({ type: 'task', task: publicTask() });
          return { text };
        } catch (error) { op.status = 'failed'; op.detail = short(error.message, 120); send({ type: 'task', task: publicTask() }); return { error: true, text: error.message }; }
      }
      // edit_file / create_file: preview → approval → apply.
      let change;
      try { change = c.name === 'edit_file' ? await writer.previewEdit(a.path, a.edits) : await writer.previewCreate(a.path, a.content); }
      catch (error) { return { error: true, text: error.message }; }
      const op = { kind: 'p-edit', label: change.path, status: 'running', detail: `+${change.diff.added} −${change.diff.removed}` };
      task.ops.push(op); send({ type: 'task', task: publicTask() });
      let decision = 'apply';
      if (!applyAll) {
        send({ type: 'edit-approval', callId: c.id, change: { kind: change.kind, path: change.path, added: change.diff.added, removed: change.diff.removed, hunks: change.diff.hunks } });
        decision = await waitApproval(runId, c.id, signal);
        if (decision === 'apply-all') { applyAll = true; decision = 'apply'; }
      }
      if (decision !== 'apply') {
        send({ type: 'edit-done', callId: c.id, decision: decision === 'timeout' ? 'timeout' : 'skipped' });
        op.status = 'failed'; op.detail = decision === 'timeout' ? 'timeout' : 'skipped'; send({ type: 'task', task: publicTask() });
        return { text: decision === 'timeout' ? 'skipped: the user did not answer in time; the change was not applied.' : 'skipped: the user declined this change; it was not applied.' };
      }
      try {
        const done = await writer.apply(change, taskId);
        send({ type: 'edit-done', callId: c.id, decision: 'applied' });
        op.status = 'done'; send({ type: 'task', task: publicTask() });
        const region = change.after.replace(/\r\n/g, '\n').split('\n');
        const [from, to] = (done.lines || '1-1').split('-').map(Number);
        const view = region.slice(Math.max(0, from - 1), Math.min(region.length, Math.max(from, to), from + 19)).join('\n');
        return { text: `applied: ${change.kind === 'create' ? 'created' : 'edited'} ${done.path}${done.lines ? ' lines ' + done.lines : ''}${view ? ':\n' + view : ''}` };
      } catch (error) {
        send({ type: 'edit-done', callId: c.id, decision: 'failed', error: error.message });
        op.status = 'failed'; op.detail = short(error.message, 120); send({ type: 'task', task: publicTask() });
        return { error: true, text: error.message };
      }
    }
  }

  function approve(runId, callId, decision) {
    const a = approvals.get(String(callId || '')); if (!a || a.runId !== runId) return false;
    a.done(['apply', 'skip', 'apply-all'].includes(decision) ? decision : 'skip'); return true;
  }
  function cancel(runId) { runs.get(runId)?.abort(); }

  async function undo(chatId, taskId, binding) {
    const state = store.get(chatId);
    const latest = state.tasks.filter(t => t.files?.length).at(-1);
    if (!latest || latest.taskId !== taskId || latest.undone) throw Error('Only the latest task that changed files can be undone.');
    const writer = createProjectWriter({ root: binding.root, checkpointsDir, allowSensitive: binding.allow || [] });
    const result = await writer.undo(taskId);
    store.markUndone(chatId, taskId);
    const parts = [result.restored.length && 'restored ' + result.restored.join(', '), result.removed.length && 'removed ' + result.removed.join(', '), result.skipped.length && 'left alone because they changed afterwards: ' + result.skipped.map(s => s.path).join(', ')].filter(Boolean);
    store.appendEntries(chatId, [{ role: 'note', text: `The user undid the changes of the previous task (${parts.join('; ') || 'nothing to restore'}). The files on disk are back to their earlier content.` }]);
    return result;
  }

  return { run, approve, cancel, undo, active: () => runs.size > 0 };
}

module.exports = { createCoder, stepSchema };
