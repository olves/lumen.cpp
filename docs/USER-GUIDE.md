# lumen.cpp Beta

Open **lumen.cpp.exe**. On the first launch after this update, choose Desk or Studio using the real interface previews, then choose Light or Dark and open the workspace. Lumen remembers your selection and skips this screen on later launches. Keep the entire folder together. Windows x64 and .NET Framework 4.8 are required. Electron and the CPU/Vulkan llama.cpp engines are included; no npm, Ollama, Python, or separate AI service installation is needed.

The workspace uses a compact conversation rail, a quiet charcoal surface, warm orange accents, an anchored composer, and short opening/page transitions. English is the default; Turkish and reduced motion are available in Settings. There are no permanent decorative animation loops or remote fonts/scripts. Conversations have no dividing rules: your messages sit in a soft block, and Copy/Branch appear when you hover or focus a message. Settings with only a few choices (language, design, display mode, accent, text size, context window, search results and language) use segmented buttons that work with the arrow keys.

## Installing and updating

Lumen comes in two forms on the GitHub Releases page (github.com/olves/lumen.cpp/releases):
- **lumen-beta-setup.exe** installs Lumen for your Windows user, with no administrator rights, into `%LOCALAPPDATA%\Programs\lumen.cpp`. It adds a Start menu entry, an optional desktop shortcut and an uninstaller. Setup is available in English and Turkish.
- **lumen-beta-portable.zip** runs from any folder you extract it to.

Both are unsigned Beta builds, so Windows SmartScreen may warn the first time. Your chats, models and settings are kept in `%LOCALAPPDATA%\lumen.cpp` in both cases, and updating never touches them. Uninstalling asks whether to delete them as well; the default is No.

**Updates** (Settings → General → Updates):
- **Version.** The section shows your Beta build number.
- **Checking.** With *Check automatically* on (the default), Lumen asks GitHub at most once a day whether a newer Beta build exists. The request only reads the public release list; nothing about you or your chats is sent. You can also press *Check for updates*.
- **When a newer build exists.** An "Update" button appears in the header and the release notes are shown in Settings. Nothing is downloaded until you click *Download update*. The download can be cancelled and resumes where it stopped.
- **Verification.** Every release carries a manifest signed with the Lumen release key. Lumen installs a file only if the signature is valid and the file's size and SHA-256 match. A modified or corrupted download is deleted.
- **Installing.** *Restart and update* closes Lumen and a small updater installs the new build:
  - installed copies run the new setup silently;
  - portable copies swap the folder, and the old version is restored if anything fails.
  Then Lumen starts again.
- **Portable copies** can only update themselves if Lumen can write to their folder. Otherwise, download the new ZIP yourself.

**At startup.** While the opening animation plays, Lumen checks for a newer Lumen and a newer llama.cpp engine; each check runs only when its automatic check is on. The animation waits for these checks, at most about four seconds, and shows "Checking for updates…" under the mark. With Motion off nothing waits. When the workspace appears, each result gets its own notice in the top-right corner:
- **Lumen v… is available**: *Update* downloads it and opens Settings → General; *Later* closes the notice.
- **New llama.cpp engine**: *Update* installs it; *Remind me in 7 days* stays quiet for a week (llama.cpp publishes several builds a day).

**llama.cpp engine updates** (Settings → Runtime → llama.cpp engine). Lumen ships with llama.cpp b11438 and keeps it as a fallback.
- **What gets downloaded.** A newer official build from github.com/ggml-org/llama.cpp, only when you click *Update*. It is checked against the SHA-256 digest GitHub publishes for that file.
- **Size.** For CUDA, the large CUDA runtime is reused when it has not changed, so an update is about 150 MB instead of about 550 MB. Vulkan is about 30 MB, CPU about 20 MB.
- **Testing.** The new engine is unpacked into its own folder and tested: it must report its version and, for GPU engines, find the GPU. Only then is it used, from the next reply on.
- **Rollback.** If it later fails to start or does not use the GPU, Lumen goes back to the previous engine by itself and tells you once. *Use the previous engine* switches back by hand.
- **Testing caveat.** Newer llama.cpp builds support newer models and bring fixes, but Lumen has not tested each of them in advance.

## Chat and models

Pick a model under the composer. If needed, Lumen downloads and verifies it before the first response. Chats are stored locally, responses stream, and the stop button cancels generation. Copy text/code, export Markdown, edit a message into a new branch, or branch after an answer. Settings → Explore contains the curated GGUF library and public Hugging Face repository discovery; Settings → Library shows downloaded models. Model compatibility and licensing still depend on the individual model.

To delete a conversation, hover its history row and click the trash icon (also visible on the selected conversation). Confirm Delete in the dialog; Cancel leaves it untouched. Deletion permanently removes that conversation's saved messages, without deleting models or other conversations. If the current conversation is deleted, Lumen opens an empty conversation. Deletion is disabled during generation/download operations. Restart the application after updating to Beta.

**Model names.** Lists, the model menu and message headers show a short name built from the file's own metadata, for example "Qwen2.5 Coder 7B · Q4_K_M" or "Gemma 4 E2B · UD-Q4_K_XL". If two files would get the same name, the differing words (such as "QAT") or the owner are added. The full repository and file name is in the tooltip and in Library details. The stored model identity is unchanged, so existing chats, downloads and settings keep working.

**Formatting.** Answers render Markdown with tables, syntax-highlighted code blocks (37 common languages), and math written as `$…$`, `$$…$$`, `\(…\)` or `\[…\]` (KaTeX). Each code block has a language label and a Copy button that copies the original code, not the highlighted HTML. Model output never runs as HTML: raw HTML is shown as text, only http(s) and mailto links are kept, and images become links. Highlighting and math are done only when a message scrolls near the screen, and very large code blocks (over 150 KB) stay plain. The libraries (markdown-it, highlight.js, KaTeX) are bundled locally in `resources/app/vendor`; nothing is loaded from the internet.

**Regenerate.** The last answer has a Regenerate button. The new answer becomes a new version of the same reply: `‹ 2/2 ›` switches between versions, and the chosen version is what the model sees as history from then on. Up to 12 versions are kept in `conversation-variants.json`. An earlier answer offers *Regenerate in a new branch*, which leaves the conversation as it is. A research answer is regenerated with research again (identical searches from the last 10 minutes may come from the cache), and a project answer by looking through the project again. If you stop a regeneration before any text arrives, or it fails, the previous answer comes back. The button is disabled while another reply is running.

**Searching conversations.** The search box above Recent (Ctrl+K) searches titles and message text of all local chats. Turkish letters match with or without accents and in either case (for example "cay" finds "ÇAY", "igdir" finds "ığdır"). Results show where the match is; clicking one opens the chat and scrolls to that message. The index is built on this computer in small steps, follows renames and deletions, and is never sent anywhere.

Old models and conversations continue to use `%LOCALAPPDATA%\lumen.cpp`. Desktop preferences are in `desktop-preferences.json`; older WPF preferences remain separate. The AI server listens only on loopback and requires a random per-process key.

## Context

Click the context indicator below the composer. It shows the last request's input, output, active window, response reserve, and the model's training window when supplied by its metadata. Input includes system instructions and the chat template. Counts come from llama.cpp's tokenizer and final usage response; the unsent draft is not included. Changing models/windows clears the previous snapshot.

The context window is set in Settings → Chat behavior: **Auto** or a fixed 2,048 / 4,096 / 8,192 / 16,384 / 32,768 tokens. Larger windows use more RAM/VRAM.
- **Auto** is the default for new installs. For each model it picks 4,096, 8,192 or 16,384 tokens from the model's metadata (layers, KV heads, sliding-window layers), your free GPU memory and RAM, and the GPU and cache settings. Settings shows the value it chose and why, for example "Auto uses 16,384 tokens for Gemma 4 E2B · UD-Q4_K_XL: it fits fully on the GPU (estimate)". It never goes above the model's trained window.
- If a model fails to load at the chosen size because of memory, Auto retries at the next smaller size (16,384 → 8,192 → 4,096, not lower) and remembers the smaller size for that model until Lumen restarts. A fixed size you chose is never changed.
- **Existing installs keep their manual setting.** If you had chosen a size before this update, that size stays selected; choose Auto to switch.
- The model's trained window is shown separately and is not allocated in full.

Lumen reserves the response length for a reply (512 by default; see below) and excludes the oldest complete conversation turns if necessary, without deleting history. The UI reports how many earlier messages were omitted. If the newest message plus instructions cannot fit, it asks you to shorten it or increase the window.

## Thinking and response settings

Settings → Chat behavior → **Responses** has four settings. They apply to normal chat and to research answers:
- **Thinking** (off by default). Models whose chat template supports it reason before answering. Examples: Qwen3, DeepSeek R1, Gemma 4. Thinking is slower and often better on hard questions. A model without thinking support simply answers as before. With thinking on, at least 2,048 tokens are reserved for the reply, at most half the context window.
- **Show thinking**. The reasoning appears above the answer as a collapsed "Thinking…" block, then "Thought for N s". It is saved in `conversation-reasoning.json`, copied to branches and removed when the conversation is deleted. It is never sent back to the model as history and is not part of Copy or Markdown export.
- **Response length**: 512 / 1,024 / 2,048 / 4,096 tokens. The context panel shows the actual reserve of the last request.
- **Creativity**: Precise (temperature 0.2), Balanced (0.7, the previous default) or Creative (1.0). Research answers are capped at Balanced.

**Which models can think.** Lumen reads the chat template inside each installed GGUF file. A template with an `enable_thinking` switch (Qwen3, Gemma 4) is *supported*. A template that always reasons (DeepSeek R1 style `<think>`) is *always on*; the switch does not apply. Templates with other reasoning schemes are *unknown*, and templates without any are *unsupported*: the Thinking switch is disabled for that model with an explanation, and your setting is kept for other models. Tested: Qwen3 8B with thinking on returned 614 reasoning tokens, with thinking off none; Qwen2.5 Coder 7B is shown as unsupported.

Normal chat goes through the engine's `chat` request, which trims history and counts tokens the same way the first betas did. If a model spends the whole response length thinking, Lumen says so instead of saving an empty answer.

### Run settings for one conversation

The settings button under the message box (it shows, for example, "Balanced · 512") opens **Run settings** next to the chat. Everything there applies to this conversation only, from the next reply on:
- **Thinking**, **Response length** and **Temperature** (0–2, with Precise / Balanced / Creative shortcuts).
- **Instructions**: the conversation's system prompt. `{{current_date}}` (and `{{current_time}}`) are filled in for each request in your interface language; the saved conversation keeps the placeholder.
- **Advanced sampling**: Top P, Top K, Min P, repeat, presence and frequency penalties, and a seed (the same seed and settings give the same reply). Values you have not set are not sent, so llama.cpp and the model keep their own defaults; the field says "Default".
- A dot on the button means the conversation has its own values. **↺** next to a setting returns it to the default; **Reset this conversation** drops all of them; **Use for new chats** makes this conversation's values the defaults (Settings → Chat behavior shows the same defaults; choosing a Creativity preset there replaces a custom default temperature).
- The context window and engine options are not per conversation: changing them reloads the model, so they stay in Settings, linked from the panel.

Saved in `conversation-run.json` (only what you changed); copied to branches and removed with the conversation. Research and project answers use the conversation's thinking, length, temperature and sampling for their final answer; their planning and tool steps keep fixed settings.

## Optimization and verification

The frontend has no framework dependencies. Streaming appends to one text node in animation-frame batches; Markdown is parsed once after a reply. Offscreen messages use `content-visibility`, inactive pages are removed from layout, and hidden production windows retain Chromium background throttling. Node access is disabled in the renderer, context isolation and sandboxing are enabled, IPC operations are allowlisted, and a local resource protocol/CSP prevents remote content execution.

See `OPTIMIZATION.md` for measured results and the test environment limitation. These are local development checks, not a guarantee of performance on every PC.

If a launch fails, diagnostic logs are in `%LOCALAPPDATA%\lumen.cpp` or the Electron user-data folder `%APPDATA%\lumen.cpp`. This portable build is unsigned.

## Build sources and licenses

`resources/app` contains the HTML/CSS/JavaScript frontend. The local engine process is `resources/app/backend/lumen-host.exe`, built from `LumenHost.cs` and `LumenCore.cs` in the same folder. `backend/engines` holds the official llama.cpp b11438 CPU and Vulkan archives, unchanged; `backend/models.catalog.json` is the starter model list. No npm build step is required for this frontend. All source code is in the repository, github.com/olves/lumen.cpp.

Lumen: Apache License 2.0, `LUMEN-LICENSE.txt` and `NOTICE.txt` (v1.0.3-beta and earlier: MIT). Electron v44.5.1: `LICENSE`, `LICENSES.chromium.html`. llama.cpp b11438: `LLAMA-LICENSE.txt`. Bundled formatting libraries (MIT; license files in `resources/app/vendor`): markdown-it 14.1.0, highlight.js 11.11.1, KaTeX 0.16.22 with its woff2 fonts; pdf.js 6.3.289 (Apache-2.0, `resources/app/vendor/pdfjs`, used in the main process to read PDF text). They were taken from the npm registry and checked against the registry's SHA-512 integrity values. Model licenses are on their Hugging Face repository pages.

## GPU welcome and Model Hub

First launch opens a hardware welcome screen. Lumen chooses a pinned llama.cpp b11438 build automatically: CUDA 13.4 for a supported NVIDIA GPU/driver, CUDA 12.4 for compatible older NVIDIA setups, otherwise the bundled Vulkan engine. CUDA needs an optional download (13.4: 576,625,007 bytes across engine and runtime archives). No CUDA toolkit or NVIDIA driver is installed. Continue with CPU works offline; Settings → Runtime → Configure GPU reopens setup.

Downloads support cancellation and HTTP range resume, check exact sizes and pinned SHA-256 hashes, extract into staging with path traversal checks, and probe GPU devices before activation. Failed setup leaves CPU available. During inference, unusable GPU engines fall back to Vulkan/CPU; engine progress and Settings report the running engine once loaded. Engine selection is saved separately in engine-preferences.json. Saved models and chats are preserved.

Settings → Explore has a split model browser: repositories on the left, quant variants and model details on the right. Settings → Library lists installed models. Click a library model name or a search result to view its GGUF quant variants, actual file sizes and approximate memory fit. Download a variant directly; an installed variant opens chat. Small windows stack the browser panels. Split GGUF files and vision projectors remain excluded. Memory fit is an estimate, not a performance or quality guarantee; context and other applications affect it.

## Conversation controls

The Lumen mark is now the Windows executable/window icon (16–256px ICO). The composer has a local model menu with family logos, search, keyboard navigation and a checkmark for the selected model. Models that need downloading are labelled.

Rename a conversation with the pencil beside its history row or title. Names persist in the chat JSON; conversation-names.json preserves manually chosen titles across subsequent saves. Rename is disabled during generation/download. Cancel leaves the existing name intact.

The composer’s + menu attaches UTF-8 text/code files and opens system instructions. Up to five files, each at most 1 MB, total at most 45,000 characters. Remove a file before sending with its × button. Contents are included as text in the next message, counted in context and saved with that message. Photos are now a separate option in the + menu. The current text engine receives locally extracted OCR text; it does not receive image pixels. Document parsing is not provided.

Opening, page/conversation transitions, sidebar, dialogs and menus have short, finite animations. Reduced motion disables and cancels them. The app remains Beta, in the same folder. Restart Lumen after updating.

## Settings and reusable skills

Settings is a separate workspace with General, Chat behavior, Appearance, Skills, Explore, Library, Runtime and Speed lab. Back to chat returns to the conversation rail. Appearance offers eight accent colors (warm charcoal, graphite, ocean, forest, plum, rose, teal, gold) or any color of your own, plus 13–16px chat text. Context and system instructions are under Chat behavior.

**What a skill is.** A skill is a named set of instructions plus optional reference notes that you select for a conversation. Selected skills are added to the model's instructions for that conversation. A skill cannot run code, install anything or change what the model is allowed to do.

- **Creating and editing.** Settings → Skills. Each skill has a name, a description, instructions (up to 8,000 characters, with a Markdown preview) and up to 5 reference notes (16,000 characters each, 32,000 in total). The editor shows roughly how many context tokens the skill adds. Code review, Debugging and Technical writing are editable starting points.
- **Importing.** From a SKILL.md/Markdown/JSON file, from a folder containing SKILL.md, or from an https address (a GitHub file page is read from its raw address; web pages, http and local or private addresses are refused; 64 KB at most). Nothing is saved until you confirm a review that shows the instructions, the reference notes and what was **not** imported: scripts and binary files in a folder, and front-matter fields such as `allowed-tools` or `permissions` ("skills cannot grant tools or permissions"). In a folder, notes come from `references/` or from text files the instructions mention.
- **Using.** + → Use a skill, or type @. Up to 4 per conversation; the chip shows the token cost and where the skill applies. Selection is kept per conversation and inherited by branches.
- **Where skills apply.** Normal answers, and the final answer of research and project turns. The planner and the tool steps (searching, reading pages or files) do not see skills, so a skill cannot steer tool use.
- **Budget.** Skills are added to the request only (up to 24,000 characters for all selected skills); the conversation's own instructions in the chat file are never rewritten.
- **Export** writes SKILL.md with the reference notes. **Migration:** an older skills.json is upgraded in place (ids, names and instructions unchanged) and the original is kept as `skills.v1.json`.

Model details use published Hugging Face metadata when available: downloads, likes, architecture, parameters, context and a bounded text model card. Missing values are omitted. These published context values remain separate from the configured chat window. Network errors leave installed models usable.

## Web research, agents and the browser panel

Web access is **off by default**; chat keeps working offline. Choose **+ → Research on the web**. The first time, Lumen explains what leaves the computer (search queries go to the selected provider; pages are fetched from their own sites) and turns web search on only if you agree. A "Web research" chip stays in the composer until you remove it. With Settings → Agents → *Use tools automatically*, messages that clearly ask for current or sourced information (for example "latest", "news", "search", "araştır", a URL) can use research without the chip; other messages go straight to normal chat with no extra model call.

A research turn works like this, all with the model you selected:
1. The model plans whether research is needed and splits the request into at most 3 tasks by default (1–4 in Settings).
2. Each task is a subagent with a bounded tool loop: web search, page reading, finish. It has a limit on tool calls (default 4) and a time limit (default 2 min). Subagents cannot create subagents.
3. The model combines the findings into one answer with inline citations like [S1].

The engine runs one request at a time (`--parallel 1`), so tasks run **one after another**; the activity line says which task is running and never shows tasks as parallel. Stop cancels the current model request, search and page reads immediately. Finished task results are kept, and the turn is saved as interrupted.

Every model step must be a JSON object that matches a schema. Lumen enforces this both with llama.cpp grammar constraints and with its own validator. Unknown tools, extra fields, wrong types, repeated identical calls and invented URLs are rejected. A page can only be read if its URL came from a search result or from your own message. After two invalid steps in a row a task stops with a clear message, and the other results are kept. Small models (0.5–1.5B) can follow the format but often choose weak sources or misread them. A 7B model gave clearly better answers in testing.

Sources under an answer are only pages that a tool actually returned or opened. Citations to unknown ids are removed. Each source shows its site, its date when known (Wikipedia shows "updated", not "published") and whether the page was read or only seen as a snippet. Click a source or an inline citation to open it in the browser panel, or use the arrow to open it in your default browser. The activity line expands to show each task: its status, the model, the searches and page reads, and the result. Model reasoning is shown only when Thinking is on (see above). Activity and sources are stored in `conversation-activity.json` and included in Markdown export.

**Search providers** (Settings → Search):
- **DuckDuckGo** (default) searches the whole web with no account or key. It uses DuckDuckGo's public results page, not an official API. Under heavy use it can ask for a pause; Lumen then says so and never tries to get around that check. Tavily or Brave are steadier if you search a lot.
- **Wikipedia** works without a key, but finds **Wikipedia articles only**. The research chip says "Wikipedia articles only" while it is selected.
- **Tavily** is general web search built for AI tools. It needs a Tavily API key (`tvly-…`); the free plan includes 1,000 searches per month without a card (per Tavily's documentation).
- **Brave Search** is general web search and needs a Brave Search API key.
- **SearXNG** uses an instance you choose (JSON output must be enabled).

To use Tavily or Brave, create a key on the provider's site, then paste it into Settings → Search. The key is encrypted with Windows DPAPI (Electron safeStorage), never shown again and never written to chats or logs. Without a key, or with a rejected key, Lumen says so; it never switches to Wikipedia silently.

Results are capped (3/5/8). Identical queries are cached for 10 minutes and concurrent duplicates share one request. Requests time out after 12–15 s. A 429 or 503 is retried once when the provider asks for a wait of 8 s or less (Retry-After); otherwise the error is shown in plain words, and no results are invented.

**Page reading** uses a light reader first: plain HTTP, a 3 MB limit, readable text extraction, and no scripts run. Only when the reader finds almost no text does a single hidden, sandboxed window render the page with JavaScript (Settings → Browser can turn this off). Every model-driven request is checked, including after DNS resolution and after each redirect. `file:`, localhost, private and link-local addresses (including cloud metadata) are blocked. Page text is passed to the model as untrusted data. Text such as "ignore previous instructions" cannot change its tools or permissions.

**Browser panel.** It has an address field, back/forward, reload/stop, loading and error states, open in your default browser, and close. It sits beside the chat; in windows narrower than 1000 px it covers the chat until you close it. Pages run in a separate `persist:lumen-web` session with no Lumen preload, IPC or Node access. Camera, microphone, clipboard and other permissions, downloads, pop-ups and dialogs are refused, and local/private addresses are blocked. Lumen never signs in, submits forms, posts or buys for you. Settings → Browser → *Clear browsing data* clears that session's cookies, storage and cache.

**Browser commands in chat.** Short commands are carried out directly in the browser panel, without asking the model:
- "discord'u aç", "browserdan discord.com sitesini aç", "open github.com", "go to youtube";
- "youtube'da lofi müzik ara", "search llama.cpp on github";
- "geri git" / "go back", "sayfayı yenile" / "reload", "tarayıcıyı kapat" / "close the browser".

- "giriş yap'a bas" / "click sign in", "kayıt ol butonuna tıkla": clicks the visible link or button with that text. Common labels work in both languages ("giriş yap" also finds "Log In").
- "aşağı kaydır", "en üste çık", "scroll to the bottom".
- Several steps joined with "ve", "sonra", "and", "then" or a comma: "browserdan discord.com'u aç ve giriş yap'a bas". Each step waits for the page to load.

Lumen acts only on a web address, a well-known site, or a message that names the browser or a website. "dosyayı aç", "main.py aç" and ordinary questions still go to the model. If a button is not found, Lumen lists the visible ones. A short note such as "discord.com opened in the browser. Clicked “Giriş Yap”." is saved in the chat.

**Limits, on purpose:**
- Lumen never types into pages, fills in forms or enters passwords. Click into the panel and type yourself.
- Buttons that look like paying, ordering, sending, deleting, posting or confirming ("Satın al", "Öde", "Gönder", "Sil", "Submit order"…) are not clicked until you reply "evet" / "yes".
- When a message about the browser is not a command, the model is told which commands exist, so it can tell you the exact one to send.

You can also use the panel on its own. The globe button in the header opens and closes it. Panel features:
- **Address bar**: words without a domain are searched with the address bar search engine (DuckDuckGo by default; Google, Bing, Brave or Startpage).
- **Home button**: opens your home page, or the search engine's page.
- **Find in page** (Ctrl+F): shows the match count; Enter and Shift+Enter step through matches.
- **Zoom**: Ctrl+plus/minus/0. A percentage button appears while the zoom differs from your default; click it to reset.
- **Other shortcuts**: Ctrl+L focuses the address bar; Alt+←/→ go back/forward; F5 reloads.
- **Ask about page**: puts the page address in your message and turns on web research, so the agent may read that page.

Settings → Browser also offers:
- default zoom (80–150%) and panel width (narrow/medium/wide);
- JavaScript on pages (off reloads the panel page without scripts);
- pop-ups: open in the panel or block; new windows never open;
- "Ask sites not to track", on by default: sends Global Privacy Control and Do Not Track headers;
- clearing browsing data when Lumen closes.

These settings do not loosen any of the protections above.

**Engine process.** Chats, models, engine setup, research, project questions and the speed lab go through `backend/lumen-host.exe`, a small .NET 4.8 program built from `backend/LumenHost.cs` and `backend/LumenCore.cs`. Every request type (chat, tool steps, speed test) reuses the model already loaded; the model is never loaded twice. Since v1.0.4-beta this replaces the closed `lumen-core-beta.exe` of the first betas; chat files, the model list and engine settings are read and written in the same format.

## Project folder (read-only)

Choose **+ → Project folder** and pick a folder. A "Project · name · read-only" chip appears, and questions in that conversation can look through the folder. The model can only **list folders, find files by name, search text and read line ranges**. It cannot write, delete, rename or run anything; there is no terminal or shell.

- **What stays unreadable.** Paths outside the folder (including `..`, absolute paths, symbolic links and junctions); `.git`, `node_modules`, `dist`, `build` and similar folders; anything in `.gitignore` (negations such as `!keep.log` are honored); binary files and files over 1 MB; and sensitive files such as `.env`, private keys and credential files. You can allow a specific sensitive file in the project settings (click the chip), and add your own exclusions there.
- **Limits.** Lists up to 300 entries, name search up to 100 files, text search up to 60 matches in 4,000 files or 4 s, reads up to 300 lines / 20,000 characters at once.
- **Citations.** Answers cite file excerpts as [F1], [F2]. Click one to see the exact lines with highlighting. Citations to excerpts that were not read are removed.
- **File text is untrusted.** Instructions written inside files cannot change the model's tools or permissions.
- **Web stays separate.** Project text is never sent anywhere automatically. Web search is offered only when you also turned on web research for the message; a search query that contains file paths or text from the files is refused.
- The folder choice is saved per conversation (`conversation-projects.json`) and inherited by branches; Detach removes it.

## Documents

Choose **+ → Documents** to add PDF, Word (.docx) or text files (Markdown, CSV, JSON, HTML and similar) to a conversation; a "Documents · n" chip appears. Click it to see or remove them.
- **Read on this computer.** PDF text is read with pdf.js in a background thread (scripts in a PDF never run, fonts are not loaded); .docx files are opened directly. Nothing is uploaded. A scanned PDF without a text layer is reported as having no text (OCR for PDFs is not built in yet). Password-protected PDFs are refused.
- **What the model gets.** If the documents fit in about 45% of what the context window leaves after the reply, they go whole, page by page. Otherwise Lumen picks the passages that best match your latest message (keyword ranking with Turkish letters folded, about 900-character passages) and says that other parts are not shown. Keyword ranking finds exact words and their forms; a question phrased with completely different words can miss a passage, so name the topic as the document does.
- **Citations.** Answers cite passages as [D1], [D2]… right after the statement. Click a badge or a source under the reply to see the passage and its page (or part, for files without pages). Sources the model was given but did not cite are listed in grey.
- **Document text is untrusted.** The model is told that instructions inside documents are data, not commands.
- Limits: 64 MB per file, 2,000 pages, 10 documents per conversation. Documents are stored in `documents/` inside the data folder, linked per conversation (`conversation-documents.json`) and per reply (`conversation-docsources.json`); a document no conversation uses any more is deleted. Branches keep the documents. Research and project answers do not read documents yet.

## Assistants

An assistant is a saved starting point: instructions, an optional model, run settings (temperature, response length, thinking) and up to four skills. Three come with Lumen (Translator, Writing editor, Study tutor); add and edit your own in Settings → **Assistants**.
- **Start one** from the **Assistant** button under the composer. On an empty conversation it applies there; otherwise a new conversation starts with it. An "Assistant · name" chip shows which one the chat started from.
- **Copied, not linked.** Starting copies the values into the conversation (its instructions, its run settings and its skill selection). Changing the chat later does not change the assistant, and editing or deleting the assistant never rewrites chats you already started.
- `{{current_date}}` in the instructions becomes today's date for each reply.

## Cloud models (optional)

Off by default. Settings → **Cloud models** lets you add models from OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, Mistral or any OpenAI-compatible address, with your own API key.
- **What is sent, and where.** Only conversations where you pick a cloud model are sent, and only to that provider: the messages, the conversation's instructions, selected skills and document excerpts. Photos go as their recognized text (OCR), not as images. The composer says "Cloud · provider" instead of "Local response" while a cloud model is selected. Turning the feature on asks for confirmation once.
- **Stays local.** Web research, project folders and connected tools always run on local models; with a cloud model selected Lumen asks you to pick a local one for those. The local API never offers cloud models.
- **Keys** are encrypted with Windows DPAPI and never shown again; the key field only says whether one is saved.
- **Models.** "Load models" lists what your key can use; pick the ones to show in the model menu, or type a model ID. "Test" sends one short message. Run settings apply where the provider supports them (temperature, Top P, penalties, seed, response length); Top K, Min P and repeat penalty are local-only. A provider that refuses one of these fields gets the request again without the optional fields.
- Token counts come from the provider when it reports them; there is no local context window for cloud models.
- Not built in: cloud model costs, image input to cloud models, ChatGPT or Claude subscriptions (these need the providers' paid APIs).

## Connected tools (MCP)

Settings → **MCP servers** connects Lumen to tool servers that speak the Model Context Protocol over HTTP (Streamable HTTP).
- **Lumen never starts programs.** Run a local MCP server yourself and add its address (http is allowed only for this computer; https anywhere). An optional access token is encrypted like API keys.
- **Off until you turn each tool on.** After adding a server Lumen lists its tools; every tool starts off. Read-only tools are marked when the server says so.
- **Using them.** Choose **+ → Connected tools** to send messages through the tool loop with a local model: the model picks a tool and arguments, and Lumen shows an approval card with the tool, server and exact arguments. **Allow once**, **Always allow this tool** (stops asking for that tool) or **Deny**; no answer in 2 minutes counts as Deny. Nothing is called before you allow it.
- **Results** are cited as [T1], [T2]…; click one to see the arguments and the result the model was given. Tool results are treated as untrusted data.
- What a tool does is up to its server: a server you connect can read or change things on its side. Keep "Ask every time" for tools that change anything.

## Local API

Settings → **Local API** (off by default) lets other programs on this computer use your local models through an OpenAI-compatible API: `GET /v1/models` and `POST /v1/chat/completions`, with streaming.
- Listens on `127.0.0.1` only (default port 11500) and requires the key shown on that page (`Authorization: Bearer …`). "New key" replaces it. Requests from web pages are refused (no CORS, the Host must be this computer).
- Requests share the engine with your chats and run one at a time, with the same context rules. Text messages only (no images or tool calls); up to 4,096 response tokens per request. Cloud models are not offered.

## Images

Settings → **Images** sets up picture generation; **+ → Create image** in the composer turns the message box into a prompt box ("Image · model" chip; click it for shape, number of pictures, seed and things to avoid).
- **On this computer.** Install the image engine once: stable-diffusion.cpp (official Windows build, checked with SHA-256). Vulkan is recommended for any recent GPU (30 MB); CUDA 12 is an NVIDIA-only alternative (about 900 MB; not measured against Vulkan yet); CPU works without a GPU but is much slower. Then download **Z-Image Turbo** (Apache-2.0, three files: image model, text encoder, decoder; Q4 about 6.2 GB, Q8 about 8.8 GB). Pictures are made on this computer and nothing is uploaded.
- **Measured here** (RTX 5060 Laptop, Vulkan, Z-Image Turbo Q4, 8 steps): the first 1024×1024 picture took 40 s including loading the model; a following 896×640 picture took 18 s. The same seed gives the same picture.
- **GPU sharing.** The chat model and the image engine take turns: the chat model is unloaded before the image engine loads, and the image engine stops before the next chat reply (or after 3 idle minutes).
- **Cloud.** With cloud models turned on, image models from OpenAI (for example gpt-image-1) or Google Gemini (gemini-…-image) can be added; the prompt goes to that provider.
- **While it works** a progress line and a rough live preview are shown; Stop cancels. The picture appears under the reply with **Save**, **Copy** and **Full size**; "Use this prompt again" refills the composer. Pictures are stored in `generated/` in the data folder and removed when no conversation uses them any more.
- **For models.** Settings → Images → *Let models create images* adds a `create_image` tool to Connected tools: a local chat model can write a detailed prompt and make the picture, after your approval (unless you turn asking off).

## Plugins

Settings → **Plugins** lists ready-made packages. Each card says what it adds (skills, an assistant) and whether it uses the internet (and which address) or works offline. **Add** shows exactly what will be installed; after adding, **Start a chat** opens a conversation with its assistant.
- The list ships with Lumen: Library docs (Context7), GitHub repository guide (DeepWiki), Microsoft Learn, Hugging Face Hub, Turkish editor, Study pack, Picture maker. The four online ones connect to public MCP servers that need no account; their tools stay off until the assistant asks and you click **Turn on**, and each call still asks for approval.
- A plugin is a package, not a permission: it can add skills (instructions only), assistants and MCP server addresses. It cannot turn tools on, start programs or run scripts; a server entry that asks to start a program is refused and listed in the review.
- *Install from a folder, file or address* (at the bottom) takes a `plugin.json` you made or got from someone you trust, with the same review. Removing a plugin removes its skills, assistants and the servers only it added; conversations stay as they are.

## Preview (HTML and SVG)

HTML and SVG code blocks in replies have a **Preview** button. The page opens in its own window, separate from Lumen: scripts run, but the page has no network access at all (every request other than the page itself is blocked), cannot open windows or navigate away, cannot download or ask for permissions, and nothing is saved.

## Models on this computer

Settings → Library → **Models on this computer** looks for GGUF models other apps already downloaded: LM Studio, the Hugging Face cache, Ollama, GPT4All, Jan and llama.cpp's cache, plus any folder you choose. Lumen only reads those folders.
- Models on the same drive are added as a **hard link**: no download and no extra disk space; deleting the model in one app keeps it in the other. A model on another drive needs a copy; it is not selected by default and its row shows the size of the copy.
- Each file is checked (GGUF header, SHA-256; Ollama and Hugging Face cache files already carry their SHA-256 in the file name) and matched with Lumen's model list, so a file Lumen already knows becomes that model. Vision files (mmproj) and split models are skipped.

## Speed lab

Settings → Speed lab measures how fast a model runs on this computer; it is not a quality score. Two profiles:
- **Standard**: 2,048 context, every layer on the GPU, no compact cache or speculation, 192 tokens, temperature 0, seed 42. Comparable between models and computers.
- **Current settings**: your context, GPU, cache, speculation and draft settings, so you can see what you actually get.

Results show load time, first-token time, prompt reading speed and generation speed separately, plus the engine, GPU layers, how much of the weights sit on the GPU and in RAM, the context, and (with a draft model) how many drafted tokens were accepted. Results are saved with these settings in `benchmarks.json`; older results are labelled "Older test". Without the engine host, the older built-in test runs.

## Model downloads

Model downloads no longer go through the backend's single-stream download. In Lumen's own downloader:
- **Connections:** it starts with one connection and adds range connections (up to 4) only while each one raises measured throughput by at least 12%.
- **Range checks:** every 8 MiB range response must be a 206 whose Content-Range and byte count match the request. If a server ignores ranges, the download safely restarts as one stream.
- **Retries:** stalled connections (30 s without data), dropped connections and 429/503 responses are retried a limited number of times with backoff and Retry-After. Expired CDN addresses are resolved again.
- **Identity checks:** before resuming, the remote file is checked against the expected SHA-256 and size (Hugging Face's linked ETag), so a changed file never continues an old partial.
- **Hashing:** SHA-256 is computed in a background thread while the file downloads, so verification takes a moment instead of re-reading the whole file. A file is moved into place only after its size and hash match.
- **Resume:** pause and resume keep completed chunks (`<model>.partial` plus `<model>.partial.json`). An older backend `.partial` file is resumed too.
- **Errors and limits:** disk-full and write errors are reported clearly. The same file cannot be downloaded twice at once.

A small indicator in the header shows progress (percent and speed). Click it for the card: downloaded/total size, smoothed speed, time left, connections, pause/resume, cancel and retry. Verification shows no network speed. Chat stays usable while a model downloads. GPU engine setup still uses the backend's own verified downloader.

On the development connection the line itself was the limit (about 5.4 MB/s), so real Hugging Face downloads were as fast as before, not faster; see OPTIMIZATION.md for measurements.

## Explore

Settings → Explore opens with four collections: For you (Lumen's starter and registered models, sorted for this computer: installed first, then what fits the GPU, largest first; each row says why, for example "Largest that fits your GPU" or "Uses GPU and RAM · slower"), Popular (most-downloaded public text-generation GGUF repositories), Coding, and Compact (published parameter count up to 4.5B). Family shortcuts (Qwen, Llama, Gemma, Mistral, Phi, DeepSeek) search Hugging Face for that family; the search field still accepts any query or an exact owner/repository. Lists are ordered by Hugging Face downloads, not by quality or by compatibility with the bundled llama.cpp.

Each row shows the owner, download count, published parameter count and a size. A size prefixed with ≈ is an estimate for a Q4 file computed from the parameter count; real file sizes appear in the download options. The coloured dot is the same memory estimate used elsewhere (fits GPU memory / RAM or mixed / may exceed available RAM). In the details, the download options carry a general quality note per quant (for example Q4 = balanced, Q8 = close to original) and one quant may be marked Best fit: the Q4_K_M or largest Q4–Q6 file that the estimate places in GPU memory, otherwise in RAM. These are estimates from file size and detected memory, not a load or performance guarantee. Draft (MTP) heads and vision projectors that ship beside the weights are not listed as downloadable chat models.

**Memory fit.** For installed models the dot and label use the file's own metadata, including the context cache at the chosen window: *fits fully on the GPU*, *GPU + RAM*, *CPU*, *may strain memory* or *unknown*. For files not yet downloaded, only the file size is used and the label says "context not included". Free GPU memory comes from `nvidia-smi` (other GPUs: the backend's reported memory); a model that is already loaded is counted as free for its own estimate, using the GPU memory its load actually took (measured with `nvidia-smi` before and after loading; the estimate is used only without a reading). MoE models carry an "MoE" chip ("all N experts stay in memory, M run per token"): every weight must fit in RAM + VRAM, but only the active experts are computed per token, which is why such models can be fast even when partly in RAM. The Coding collection is sorted by how well each model fits this computer. All of these are estimates.

**What a model can do.** Rows show *Thinking*, *Photos*, *Tools* and *Code* badges, and the details have a "What it can do" box with yes / no / unknown. Before download they come from the chat template Hugging Face reports for the repository (the same template llama-server applies); after download, from the file itself. Photos also need the model's vision file (Library → Vision). A repository without a template shows "unknown", and no badge is shown in the list for what is not known.

## Opening

The window shows a static brand frame from the first paint while the local engine starts. When the workspace is ready, the mark moves into the titlebar and the workspace rises into place (about 0.6 s after the frame appears; the frame is held at least 600 ms so it does not flash). It runs once per launch and never loops. With Motion off or the system's reduced-motion setting, the frame is removed without animation.

## Desk / Studio and light mode

Desk keeps compact edge-to-edge navigation and a simple conversation column. Studio uses inset navigation, a separate conversation canvas, centered start page and cards, and a distinct user-message treatment. Both retain the same models, conversations, settings and shortcuts; changing the layout does not copy or migrate your data. Both support Light and Dark.

Change the layout, display mode or accent under Settings → Appearance. For a custom accent, click the last circle and pick a color. Lumen derives the dark and light variants itself and adjusts them until text on the accent stays readable (at least 4.5:1 contrast). The one-time chooser has English/Turkish labels, keyboard navigation and real local screenshots for each layout/mode. The selection is written to desktop-preferences.json as layout, colorMode and designChosen; changing other preferences preserves these values. A saved onboarding flag cannot be accidentally cleared by older preference controls. GPU setup follows design selection when needed. The saved theme is applied to the initial HTML and window background before the workspace becomes interactive.

## Performance settings

Settings → Runtime → **Performance** controls how the engine runs. The settings apply when the model next loads.

- **GPU memory**
  - **Auto** (default) leaves layer placement to llama.cpp. It puts as much of the model on the GPU as fits, keeping a 1 GB margin, and the rest in RAM. For a model that fits, this is the same as before.
  - **All on GPU** is the old behavior. If the model does not fit, Lumen falls back to the CPU engine.
  - **CPU only** uses the CPU engine.
- **Faster generation** (default on). n-gram speculative decoding guesses upcoming text from the conversation itself and checks several tokens in one step. With temperature 0 the measured answers were identical. It helps most when the model repeats code or text you gave it.
- **Compact context memory** (default off). Keeps the KV cache in 8-bit (`q8_0`), roughly halving context memory. With it, a 7B model at 32K context fit on an 8 GB GPU.
- **32,768-token context** is now available in Chat behavior. It needs the engine host.
- **Draft models (MTP).** Some repositories ship a small multi-token-prediction draft (Gemma 4: 93 MB).
  - In Settings → Library → the model, **Faster replies** finds it in the model's own Hugging Face repository after you click. It then downloads it with the normal downloader.
  - With Faster generation on, the draft proposes tokens and the model checks them.
  - Answers can differ slightly from a run without the draft.
- **How it works.** `backend/lumen-host.exe` now starts llama-server itself with these options. Engine order is unchanged: the selected engine, then Vulkan, then CPU. If an option prevents the server from starting, Lumen retries once without the extra options.
- **Cleanup.** The host runs in a Windows job object. If Lumen is closed abruptly, llama-server is closed by Windows instead of keeping a model in GPU memory.
- **Measured speeds.** See OPTIMIZATION.md for this RTX 5060 Laptop GPU.
- **Large MoE models.** Auto mode makes models such as Qwen3-Coder-30B-A3B usable on an 8 GB GPU. Measured here: 36 tok/s with Auto, against 2.1 tok/s when everything is forced onto the GPU. The model needs about 17 GB of free RAM plus VRAM.
- **AMD and Intel GPUs** use the bundled Vulkan engine. Every setting above works the same way there, but none of it was tested on AMD hardware.

## Seeing photos (vision)

A model can look at attached photos when two things are true: the model is a vision model (for example Gemma 4, Gemma 3 or Qwen2.5-VL) and its **vision projector** (`mmproj`) is installed.

- **Turning it on.** Attach a photo. Under the photo, Lumen says whether the model sees it or only reads its text.
  - Click *Let this model see photos*. Lumen asks the model's own Hugging Face repository whether a projector exists; this is a single request, made only after the click.
  - If one exists, the button shows its size (Gemma 4 E2B: 940 MB). Click again to download it. The download uses the normal downloader: resume, SHA-256 check and the progress card.
  - Settings → Library → the model also shows a Vision row with the same actions and **Remove**.
- **Text-only models.** Lumen says the model has no vision support and suggests a vision model.
- **What reaches the model.** Photos stay on this computer. The newest photos (at most 4 per request) go to the local engine as images, and OCR text is still added. Sent messages show "Sent to the model as an image".
- **Requirements and limits.**
  - This needs the engine host (`backend/lumen-host.exe`), which loads the projector with `--mmproj`.
  - Research turns still use the OCR text only.
  - **Recognition depends on the model.** In testing, Gemma 4 E2B described an anime screenshot correctly (hair, clothes, pose) but named the wrong character in 5 of 5 runs. One run named the right series. Larger vision models are expected to do better; that was not measured here.
- **Data files.** `vision.json` stores which projector belongs to which model; `conversation-vision.json` records which messages were sent as images.

## Photos

Choose + → Photos, or paste a screenshot in the message field. PNG, JPEG and WebP are accepted: up to four unique photos per message, 12 MB per source and 50 million pixels. Photos are normalized locally to PNG with a maximum 1,600-pixel long edge; 160-pixel thumbnails are used in the composer and history. These are normalized copies, not original-resolution archives. No photo is uploaded by this feature.

Click a thumbnail to enlarge it and show the recognized text. Remove a draft photo with ×. Photos persist with a sent/saved conversation and are inherited by branches. Editing a photo message restores its photos as attachments. Deleting one conversation preserves photos still referenced by another conversation or an active editing draft; removing the final unreferenced draft cleans up its image files.

The bundled 9 KB helper uses Windows OCR with an installed recognition language, falling back to available local languages. It requires no separate AI installation. OCR can make mistakes; unavailable recognition or an image without text is labelled explicitly. For models without a vision projector, only the recognized text reaches the model. With a projector, the photo is also sent as an image (see "Seeing photos" above). Images and reference metadata are under images/ and conversation-images.json in the existing local data folder. Markdown export retains the model-input text, including OCR; it does not package the image files.

Implementation references: [Windows OCR](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine) and [Electron clipboard API](https://www.electronjs.org/docs/latest/api/clipboard).
