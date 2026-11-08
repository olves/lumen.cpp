# Coding agent, phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the read-only project agent with one loop that can also edit and create files in the attached project folder (each change shown as a diff and approved), works with cloud models (DeepSeek first) and local models, keeps requests cache-friendly, compacts context, and shows live tokens / cache hit / context and the task cost.

**Architecture:** Five small core modules (`linediff`, `codewrite`, `codecontext`, `codecost`, `codingstore`) under `app/`, one loop module `app/coder.cjs` that drives either `cloud.chat` (native tool calls) or `engine.complete` (JSON steps), wired into `core.cjs` in place of `agent.runProject`. Renderer work stays in `project.js` (toggle, diff cards, task summary, undo), `statusbar.js` (live coding items) and `regen.js` (hide Regenerate on coding replies). No new IPC channel: new actions go on the existing `projects` and `agent` channels.

**Tech Stack:** Node 22 (CommonJS, no npm), classic browser scripts, Electron 44 + Tauri preview sharing `core.cjs`, `node --test`, CDP UI harness.

**Spec:** `docs/superpowers/specs/2026-11-08-coding-agent-design.md` (approved 8 Nov 2026). Read it with this plan; §-references below point into it.

## Global Constraints

- No new npm dependency; no change to `app/backend/*.cs` in phase 1 (spec §11a-4).
- No command execution, delete, rename or move (spec §2 non-goals).
- Every write goes through `codewrite.cjs`; nothing reaches disk before the user approves it (spec §2 anti-goals, §8).
- Writes only inside the project root after `realpath`; `SENSITIVE` and gitignored-secret files are never edited or read unless already allowed by the read rules (spec §8).
- Atomic writes (temp file + rename); CRLF/LF and a UTF-8 BOM are preserved (spec §8).
- System message + tool definitions are identical for every request of a project session; history is append-only except at compaction (spec §7.1).
- Compaction at 75 % of the model's context window; the last 8 steps stay verbatim (spec §7.5, §11a-6).
- Defaults: task money limit 0.20 USD (only when a price is known), token limit 3,000,000 per task, step limit 40, approval timeout 10 minutes (spec §5, §8, §11a-6).
- `reasoning_effort: 'low'` for DeepSeek steps by default, `'high'` with the setting; reasoning text is never sent back (spec §11a-7).
- Local models: no transcript carried across tasks (only the previous `finish` summary + changed files), step output ≤ 4096 tokens, `create_file` content ≤ 12 KB, cloud `create_file` ≤ 200 KB, `edit_file` target ≤ 1 MB (spec §6, §11a-4).
- Only the latest task that changed files can be undone; undo appends a note to the transcript (spec §11a-1).
- Branch / regenerate / edit never touch disk; Regenerate is hidden on coding replies (spec §11a-2).
- EN/TR strings for every new UI text; tests never write the user's real data; UI tests run on both shells.
- Price defaults for DeepSeek are filled only from the official pricing page with the date in a comment; if it cannot be read, ship without defaults (tokens shown, money limit inactive).

## Review Focus

1. A model `edit_file` whose `old` text matches with different line endings (file CRLF, model sends LF) — the edit must still apply once and the file keep CRLF. → Task 2 test `edit_file matches across CRLF and keeps CRLF`.
2. The user edits a file in an editor after the agent changed it, then presses Undo — that file must be left alone and reported, others restored. → Task 2 test `undo skips a file changed after the task`.
3. A provider streams one tool call split over many SSE chunks (name in the first, arguments in pieces, two calls interleaved by index) — arguments must join correctly. → Task 4 test `stream joins split tool_call arguments by index`.
4. The user stops the task while an edit card is waiting — the card closes as "skipped", nothing is written, the reply is saved as interrupted with what was applied so far. → Task 8 UI test `stop while an edit waits writes nothing`.
5. A cloud model returns plain text without a tool call mid-task — treated as `finish` with that text, not as an error loop. → Task 6 test `plain text reply ends the task as its answer`.

---

### Task 1: Line diff

**Files:**
- Create: `app/linediff.cjs`
- Test: `tests/core/linediff.test.mjs`

**Interfaces:**
- Produces: `diffLines(before: string, after: string, {context=3}={}) -> {added: number, removed: number, hunks: Array<{oldStart, newStart, lines: Array<{t: ' '|'+'|'-', s: string}>}>}` (1-based line numbers; lines without their line ending).

- [ ] **Step 1: Write failing tests** — `identical texts give no hunks`; `one changed line gives -1/+1 with 3 context lines each side`; `two far-apart changes give two hunks`; `CRLF input compares by line content`; `10,000-line file with one change finishes under 200 ms`.
- [ ] **Step 2: Run** `node --test tests/core/linediff.test.mjs` — FAIL (module missing).
- [ ] **Step 3: Implement** Myers or LCS on trimmed common prefix/suffix (the edit region is small; prefix/suffix trimming keeps it fast).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `Coding agent: line diff for change cards`.

### Task 2: Project writer with checkpoints and undo

**Files:**
- Create: `app/codewrite.cjs`
- Modify: `app/projects.cjs` (export `realRoot`, `inside`; no behavior change)
- Test: `tests/core/codewrite.test.mjs`

**Interfaces:**
- Consumes: `diffLines` (Task 1); `isSensitive`, `realRoot`, `inside` from `projects.cjs`.
- Produces: `createProjectWriter({root: string, checkpointsDir: string, allowSensitive?: string[]}) -> {previewEdit(path, edits: Array<{old, new}>) -> Promise<Change>, previewCreate(path, content) -> Promise<Change>, apply(change: Change, taskId: string) -> Promise<{path, lines: string}>, undo(taskId) -> Promise<{restored: string[], removed: string[], skipped: Array<{path, reason}>}>, changedFiles(taskId) -> string[]}` where `Change = {kind: 'edit'|'create', path (root-relative, '/' separators), before, after, diff (from diffLines), sha}`. Errors are `Error` with `code`: `'not-found'`, `'ambiguous'` (with `lines: number[]`), `'outside'`, `'sensitive'`, `'binary'`, `'too-large'`, `'exists'`, `'changed'` (file differs from the preview's `before` at apply time).

- [ ] **Step 1: Write failing tests** (temp dirs under `os.tmpdir()`): `edit_file replaces a unique match`; `missing old gives not-found`; `old found twice gives ambiguous with both line numbers`; `edit_file matches across CRLF and keeps CRLF`; `BOM is kept`; `path with .. or absolute path gives outside`; `junction/symlink to a folder outside gives outside` (create with `fs.symlinkSync(..., 'junction')`); `.env and id_rsa give sensitive`; `file with NUL byte gives binary`; `create of an existing file gives exists`; `apply after the file changed gives changed`; `apply writes atomically (no .tmp left)`; `undo restores edited files and deletes created ones`; `undo skips a file changed after the task`; `checkpoint copy is taken only before the first write of a file in a task`.
- [ ] **Step 2: Run** `node --test tests/core/codewrite.test.mjs` — FAIL.
- [ ] **Step 3: Implement** in `app/codewrite.cjs`. Line-ending rule: detect the file's dominant ending; normalize file text and `old`/`new` to `\n` for matching; write back with the file's ending. Checkpoint layout: `<checkpointsDir>/<taskId>/manifest.json` `{files: [{path, kind, sha256After}]}` + `orig/<index>` copies; `undo` compares current sha with `sha256After` to decide `skipped`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `Coding agent: guarded project writer with checkpoints and undo`.

### Task 3: Transcript, rendering and compaction

**Files:**
- Create: `app/codecontext.cjs`
- Test: `tests/core/codecontext.test.mjs`

**Interfaces:**
- Produces:
  - Entry shape: `{role: 'user'|'assistant'|'tool'|'note', text?: string, call?: {id, name, args}, result?: string, msg?: number, step?: number}` (`msg` = chat message index the entry belongs to).
  - `toolDefinitions(allowEdits: boolean, limits) -> Array<OpenAI tool>` (deterministic order and text: list_dir, find_files, search_text, read_file, edit_file?, create_file?, finish).
  - `systemText({projectName, allowEdits, language}) -> string` (stable: no date, no file count).
  - `toChatMessages(system, entries) -> Array<OpenAI message>` (assistant `tool_calls` + `tool` role results; notes become user messages prefixed `NOTE:`).
  - `toJsonStepMessages(system, entries) -> Array<{role, content}>` (today's JSON-step format of `agent.cjs`).
  - `estimateTokens(messages) -> number` (chars / 3, same rule as `agent.cjs`).
  - `compact(entries, {keepSteps = 8}) -> entries` (tool results older than the last `keepSteps` steps become one-line stubs like `read_file src/a.js 1-80 — elided, read again if needed`; edit results become `applied`/`skipped`; user and note entries untouched).
  - `cutAt(entries, msgIndex) -> entries` (branch support, spec §11a-2).

- [ ] **Step 1: Write failing tests** — `system text and tools are byte-identical across calls`; `toChatMessages pairs tool_call ids with results`; `toJsonStepMessages matches the existing step format`; `compact keeps the last 8 steps verbatim and stubs older reads`; `compact never changes user entries`; `cutAt drops entries of later messages`.
- [ ] **Step 2: Run** `node --test tests/core/codecontext.test.mjs` — FAIL.
- [ ] **Step 3: Implement.** Tool descriptions carry the limits (read ≤ 400 lines, create ≤ 200 KB cloud / 12 KB local, edit: `old` must occur exactly once).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `Coding agent: transcript rendering and compaction`.

### Task 4: Cloud tool calls and usage

**Files:**
- Modify: `app/cloud.cjs:68-110` (`chat`)
- Test: `tests/core/cloud-tools.test.mjs` (local HTTP stand-in, no real provider)

**Interfaces:**
- Produces: `cloud.chat({..., tools?: Array, toolChoice?: 'auto', reasoningEffort?: 'low'|'high'})` resolves `{content, reasoning, usage, finish, toolCalls: Array<{id, name, arguments: string}>}`. `reasoning_effort` is sent only to DeepSeek and only when given; when a 400 forces the minimal body, `tools` stay in it.

- [ ] **Step 1: Write failing tests** — `non-stream response returns tool_calls`; `stream joins split tool_call arguments by index`; `two tool calls in one turn keep their order`; `usage with prompt_cache_hit_tokens is passed through`; `reasoning_effort is sent to deepseek and not to openai`.
- [ ] **Step 2: Run** `node --test tests/core/cloud-tools.test.mjs` — FAIL.
- [ ] **Step 3: Implement** in `chat`: add `tools`/`tool_choice` to both bodies; accumulate `delta.tool_calls[i]` by `index` (`id`, `function.name`, `function.arguments` concatenated).
- [ ] **Step 4: Run** this test and `node --test "tests/core/*.test.mjs"` — PASS.
- [ ] **Step 5: Commit** `Cloud: native tool calls and reasoning effort`.

### Task 5: Cost, budget and coding store

**Files:**
- Create: `app/codecost.cjs`, `app/codingstore.cjs`
- Test: `tests/core/codecost.test.mjs`

**Interfaces:**
- Produces:
  - `normalizeUsage(usage) -> {input, cached, output}` (DeepSeek `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`; OpenAI `prompt_tokens_details.cached_tokens`; local `{prompt, generated}` → cached 0).
  - `addUsage(totals, usage) -> totals`, `cacheRate(totals) -> number|null`.
  - `costOf(modelKey, totals, prices) -> {amount, currency}|null` where `prices = {[modelKey]: {input, cachedInput, output, currency, source, date}}` per million tokens; `modelKey` = provider + '/' + model (e.g. `deepseek/deepseek-flash`).
  - `overBudget(totals, cost, settings) -> null|'tokens'|'money'`.
  - `createCodingStore(dataDir) -> {settings() -> {prices, taskMoney: 0.2, taskTokens: 3000000, maxSteps: 40, deepThinking: false}, saveSettings(patch), get(chatId) -> {allowEdits, entries, tasks: Array<{taskId, msg, files, totals, cost, undone}>}, setAllowEdits(chatId, on), appendEntries(chatId, entries), replaceEntries(chatId, entries), addTask(chatId, task), markUndone(chatId, taskId), branch(from, to, msgIndex), forget(chatId)}`. Files: `conversation-coding.json`, `coding-settings.json`; same atomic save as `stats.cjs`.
- DeepSeek default prices: read `https://api-docs.deepseek.com/quick_start/pricing` (Models & Pricing) at implementation time; put the numbers with `source` and `date` into the defaults; if not readable, `prices = {}`.

- [ ] **Step 1: Write failing tests** — `normalizes DeepSeek, OpenAI and local usage`; `cache rate is hits over input`; `cost uses cached price for hits`; `unknown model gives null cost`; `token limit applies without a price`; `money limit applies only with a price`; `store branch keeps entries up to the message`; `store survives a new instance`.
- [ ] **Step 2: Run** `node --test tests/core/codecost.test.mjs` — FAIL.
- [ ] **Step 3: Implement** both modules.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `Coding agent: usage, cost, budget and per-chat store`.

### Task 6: The loop (`coder.cjs`)

**Files:**
- Create: `app/coder.cjs`
- Test: `tests/core/coder.test.mjs` (fake `cloud.chat` / `engine.complete` returning scripted steps; temp project dir)

**Interfaces:**
- Consumes: Tasks 1–5; `createProjectTools(binding)` from `projects.cjs` (read tools as today).
- Produces: `createCoder({cloud, engine, store, checkpointsDir, emit}) -> {run(options) -> Promise<Result>, approve(runId, callId, decision: 'apply'|'skip'|'apply-all') -> boolean, cancel(runId), active() -> boolean, undo(chatId, taskId) -> Promise<UndoResult>}`.
  - `options = {runId, chat, msgIndex, prompt, model, cloudTarget?: {provider, model}, contextSize, language, binding, allowEdits, systemPrompt}`.
  - Events (through `emit`, channel `agent-event`, all carry `runId`): existing `start`/`plan`/`task`/`phase`/`end`; new `coding-status {steps, turns, input, cached, output, cacheRate, contextUsed, contextSize, perSecond}`; `edit-approval {callId, change: {kind, path, added, removed, hunks}}`; `edit-done {callId, decision: 'applied'|'skipped'|'timeout'|'failed', error?}`.
  - `Result = {route: 'project', content, cancelled?, taskId, files: string[], totals, cost, budgetStop?: 'tokens'|'money', sources}`.
- Rules (spec §6, §7, §11a): cloud → `cloud.chat` with `toolDefinitions` + `toChatMessages`; local → `engine.complete` with JSON schema built from the same definitions + `toJsonStepMessages`. `finish(summary)` text is the answer; a plain-text cloud reply is the answer too. Invalid call → one corrective message; the same failing call a third time → stop with a short explanation. Compaction when `estimateTokens ≥ 0.75 × contextSize`. Budget check after every step; when a limit is reached the run ends normally with `budgetStop` set and the work so far kept; the renderer shows the limit note with a Continue button that sends a new message (spec §5 "devam etmek için onay"). Approval timeout 10 min = `timeout` = skipped. `apply-all` applies the current and all later changes of this task without asking.

- [ ] **Step 1: Write failing tests** — `read-only run answers from finish`; `plain text reply ends the task as its answer`; `edit waits for approval and applies`; `skip tells the model the user declined`; `apply-all stops asking for the rest of the task`; `invalid tool call gets one correction then stops on the third repeat`; `request start is identical between steps (cache)`; `compaction triggers at 75 % and keeps the last 8 steps`; `token budget stops the run with budgetStop tokens`; `local model gets JSON steps and no carried transcript`; `cancel while an approval waits writes nothing`; `edit outside the root becomes a tool error, not a write`.
- [ ] **Step 2: Run** `node --test tests/core/coder.test.mjs` — FAIL.
- [ ] **Step 3: Implement** `app/coder.cjs`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `Coding agent: one loop for cloud and local models`.

### Task 7: Core wiring

**Files:**
- Modify: `app/core.cjs` (agent `run` project branch ~line 352, `agent` `approve`, cloud refusal at ~line 350, `projects` handler, branch/delete sidecars, `decorateChat`)
- Modify: `app/agent.cjs` (remove `runProject` and `projectSchemas`; keep exports for other routes)
- Test: `tests/core/core-isolation.test.mjs` (channel list unchanged), `tests/ui/mcp.test.mjs` (update the "refused for a cloud model" test: project mode is now allowed, research and tools still refused)

**Interfaces:**
- Consumes: `createCoder` (Task 6), `createCodingStore` (Task 5).
- Produces (renderer-facing):
  - `api.agent('run', {mode: 'project', ...})` → coder when a project is bound; works for `cloud:` models.
  - `api.agent('approve', {runId, callId, decision})` → `agent.approve` or `coder.approve` by call id.
  - `api.projects('coding', {chatId})` → `{allowEdits, tasks, settings}`; `api.projects('allow-edits', {chatId, on})`; `api.projects('undo', {chatId, taskId})` → `UndoResult`; `api.projects('coding-settings', patch)`; `api.projects('coding-consent', {provider})` (one-time "project files go to <provider>" consent, stored in `coding-settings.json`).
  - `chat.Messages[i].Coding = {taskId, files, totals, cost, undone, canUndo}` via `decorateChat`.

- [ ] **Step 1: Update tests** — mcp.test: `project mode runs with a cloud model; research and tools are refused`; core-isolation: unchanged channel list passes.
- [ ] **Step 2: Run** them — FAIL (project with cloud still refused).
- [ ] **Step 3: Implement** wiring; checkpoints dir `<data>/agent-checkpoints`; cleanup of checkpoints older than 30 days at startup and on chat delete.
- [ ] **Step 4: Run** `node --test "tests/core/*.test.mjs"` and `LUMEN_SHELL=electron node --test tests/ui/mcp.test.mjs tests/ui/documents.test.mjs` — PASS.
- [ ] **Step 5: Commit** `Coding agent: wire the loop into the core; cloud models in project mode`.

### Task 8: Renderer — toggle, change cards, task summary, undo, consent

**Files:**
- Modify: `app/project.js`, `app/regen.js` (hide Regenerate when `m.Coding`), `app/ui/c-tools.css`
- Modify: `tests/ui/mocks.mjs` (`cloudServer({script})`: `script(body, n) -> {content?, toolCalls?, usage?}` for scripted tool calls)
- Test: `tests/ui/coding.test.mjs` (cloud mock + temp project folder via `LUMEN_TEST_FILES`)

**Interfaces:**
- Consumes: Task 7 actions and events.
- Produces: DOM ids/classes the tests use: `#allow-edits` (switch in the project chip/dialog), `.edit-card` with `.edit-apply`, `.edit-skip`, `.edit-apply-all`, `.edit-diff` (`ins`/`del` lines), `.coding-summary` with `.coding-files`, `.coding-undo`, `.coding-cost`; consent card `.coding-consent`.

- [ ] **Step 1: Write failing UI tests** — `allow edits is off by default and read-only runs answer`; `an edit card shows the diff and Apply writes the file`; `Skip leaves the file and the model is told`; `Apply all applies the next change without a card`; `summary lists changed files and Undo restores them`; `Undo is only on the latest task`; `stop while an edit waits writes nothing`; `first cloud run asks for project-file consent once`; `Regenerate is hidden on a coding reply`; `Turkish strings`.
- [ ] **Step 2: Run** `LUMEN_SHELL=electron node --test tests/ui/coding.test.mjs` — FAIL.
- [ ] **Step 3: Implement** the UI (sketch in spec §5).
- [ ] **Step 4: Run** on both shells — PASS.
- [ ] **Step 5: Commit** `Coding agent: change cards, task summary, undo and consent`.

### Task 9: Live status, settings, budget stop

**Files:**
- Modify: `app/statusbar.js` (coding items), `app/ui/c-status.css`, `app/project.js` or a new section in Settings → Tools for "Coding" (prices table, task money/token limits, step limit, "Think more during steps")
- Test: extend `tests/ui/coding.test.mjs`, `tests/ui/statusbar.test.mjs` (fit rule: only the model name may shorten)

**Interfaces:**
- Consumes: `coding-status` event (Task 6), `api.projects('coding-settings')` (Task 7).
- Produces: status ids `#status-coding-steps`, `#status-coding-tokens` (text `682K token · %90 önbellek` / `682K tokens · 90% cached`), `#status-coding-context` (ring, `aria-valuenow`); Settings fields `#coding-money`, `#coding-tokens`, `#coding-steps`, `#coding-think`, price rows `.coding-price-row`.

- [ ] **Step 1: Write failing tests** — `status shows steps, tokens, cache rate and context while a task runs and keeps them after`; `context ring drops after compaction`; `budget stop shows a note with Continue`; `settings save and reload limits and prices`; `status fit in 3 themes × EN/TR with coding items`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `statusbar`, `coding`, `layout` UI tests on both shells — PASS.
- [ ] **Step 5: Commit** `Coding agent: live status, settings and budget stop`.

### Task 10: Real-model check and docs

**Files:**
- Create: `tests/ui/coding-real.test.mjs` (local model: one small edit in a temp project, approved; skipped without a model)
- Modify: `README.md` (features: coding agent), `../CLAUDE.md` (§10 agent section, §19 open items: phase 2)

- [ ] **Step 1:** Write the real-model test: project with `greet.js` exporting `hello()`; prompt "rename hello to greet in greet.js"; approve; file contains `greet` and no `hello(`.
- [ ] **Step 2: Run** `LUMEN_SHELL=electron node --test tests/ui/coding-real.test.mjs` — PASS (or documented model-quality failure with output).
- [ ] **Step 3:** One manual DeepSeek run on a copy of a small repo with `tools/deepseek` key (only with the user's go-ahead for spending): record steps, tokens, cache rate and cost in `docs/MEASUREMENTS.md`.
- [ ] **Step 4:** Full suites: `node --test "tests/core/*.test.mjs"`, both shells `node --test --test-concurrency=1 "tests/ui/*.test.mjs"` — all pass.
- [ ] **Step 5: Commit** `Coding agent: real-model check, docs`.
