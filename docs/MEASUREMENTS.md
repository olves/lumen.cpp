# Optimization check — Beta

Measured on this Windows machine with Qwen2.5 0.5B Q4_K_M, the actual bundled llama.cpp engine, and Electron's software rendering diagnostic run.

The development execution environment could not create Chromium's restricted child token (`render-process-gone: launch-failed`, exit code 49). The isolated diagnostic run used `--no-sandbox --in-process-gpu --disable-gpu` **only for testing our local UI**. The delivered application still enables its sandbox and normal GPU behavior. Its default sandbox startup could not be validated from this restricted agent environment. Do not use those diagnostic switches as a normal launch workaround.

| Check | Observed result |
| --- | --- |
| Renderer initialization including local bootstrap | 101 ms in the final run; not total cold-start time |
| Idle active animations | 0 |
| Electron process working set before model load | Approx. 293 MB (browser 140, utility 56, renderer 97); excludes .NET backend/model |
| Idle CPU sample | 0% reported in the short sample; not an averaged long-duration benchmark |
| Real streamed reply | 41 chunk events, 34 DOM flushes, Markdown formatted once |
| UI main-thread long tasks during that reply | No tasks over 50 ms observed |
| Synthetic 240-message history | 2 ms DOM construction, 2,471 DOM elements; not a full paint/scroll benchmark |
| Compact 800 × 600 layout | No horizontal overflow; composer and send button visible |
| Language | English default and Turkish switching verified |
| Renderer isolation | `require` unavailable; no renderer console errors in the diagnostic checks |

Separate native-backend tests verified real two-turn recall, exact input/output usage, a 4,096-token active window and 32,768-token training metadata, whole-turn trimming with a 2,048-token window, preservation of the complete history, and rejection of an oversized current prompt. The speed lab retains its fixed 2,048-context / 192-output protocol.

Implementation checks: no external fonts/frameworks, no idle animation loop, short transform/opacity transitions, reduced-motion support, one text node for live output, Markdown after completion, no arbitrary HTML from model output, inactive pages outside layout, cancellation before model unload, and graceful backend shutdown.

Raw development measurements and screenshots are in `work`; no test conversations or screenshots are bundled in the portable application. The app's Electron baseline is heavier than the previous WPF build.

## Version names (2026-10-11)

Versions are now named `vX.Y.Z-beta` (Beta 2 = v1.0.2-beta). Real Beta 1, downloaded from the GitHub release (internally 0.1.0-beta.1, which compares only build numbers), found v1.0.2-beta through the local release server, downloaded it, swapped its folder and started again: pass (`run-update-compat.ps1`). v1.0.2-beta → v1.0.3-beta passes for the portable folder and the installed copy (`run-update-e2e.ps1`). Version order checks: 1.0.10 > 1.0.9, and a final release > its beta.

## Browser commands in chat (2026-10-11)

| Check | Kind | Result |
| --- | --- | --- |
| Command parser: 30 sentences (Turkish case endings, domains, known sites, site searches, back/reload/close, English); ordinary requests such as "dosyayı aç", "main.py aç" and questions are not treated as commands | Unit | 30/30 (`test-browse-intent.mjs`) |
| Real app and network: "browserdan discord.com sitesini aç" opened discord.com in the panel with no model call and saved two messages; YouTube search; back; close; English "open github.com"; 0 console errors | Real UI | Pass (`test-browse-ui.cjs`) |
| Turkish text in Settings → General → Updates was garbled in build 1 (updates.js had been saved with the wrong encoding). Repaired for build 2; the release script now refuses double-encoded files and the themes UI test checks this text | Fix + guard | Pass |
| Clicks and chained commands on real sites: "browserdan discord.com'u aç ve giriş yapa bas" → discord.com/login; "open github.com and click sign in" → github.com/login; scrolling; a missing button lists the visible ones; a typing request is refused with an explanation; httpbin.org's "Submit order" waited for "evet" and was clicked only after it | Real UI + network | Pass (`test-browse-click-ui.cjs`) |
| Parser: 51 sentences incl. clicks, scrolling, typing requests, confirmation and chained commands | Unit | 51/51 |
| A browser request that is not a command reaches the model with the command hint (prompt 192 vs 43 tokens for an unrelated question); Gemma 4 E2B answered with the exact command "discord'u aç ve giriş yap'a bas" | Real inference | Pass (`test-browse-hint-ui.cjs`) |
| Research with a model and DuckDuckGo after the game closed: Coder-7B, 36 s, correct facts with citations; a made-up URL was refused | Real inference + network | Pass |

## Web search without a key, accent themes (2026-10-11)

| Check | Kind | Result |
| --- | --- | --- |
| DuckDuckGo provider: a Turkish query (Turkish sites, ~1.2 s) and two English queries (~0.6–0.7 s) return 5 direct links each, with no ads or redirect links; the first result page was read by the guarded reader (3,778 characters) | Real network | Pass (`test-duckduckgo.mjs`) |
| Settings migration: a never-chosen Wikipedia moves to DuckDuckGo, a provider chosen by hand is kept, and fresh settings default to DuckDuckGo | Fixture | Pass |
| Research run with a model and DuckDuckGo | Real | **Not completed.** The GPU was in use by a game (7 of 8 GB, 82%) and the 7B run timed out, so the test was stopped. |
| Eight accent presets: tokens applied and saved; keyboard arrows move between swatches; Turkish names; 800×600 without overflow; 0 console errors | Fixture UI | Pass (`test-themes-ui.cjs`) |
| Preset contrast: accent text on the darkest/lightest surfaces of both layouts and text on accent buttons, all ≥ 6.1:1 | Calculation | Pass (`check-theme-contrast.mjs`) |
| Custom color (#00ff66, #fff5b0, #3355ff): computed dark/light tokens, button text ≥ 5.5:1 and accent text ≥ 6.1:1; saved and restored after reloading preferences; a partial preference save keeps the theme | Fixture UI | Pass |

Regression after the change: photos, design, explore, composer-clicks, chat-controls, settings-skills and the visual matrix all pass.

## Updates, setup and release signing (2026-10-11)

All checks used a local stand-in for the GitHub Releases API and a throwaway test key. **The real GitHub repository was not published yet, so a check against github.com has not run.**

| Check | Kind | Result |
| --- | --- | --- |
| Newer signed build offered; older or equal build and drafts ignored | Module, local server | Pass |
| Manifest signed with another key, or asset size different from the manifest, is rejected; a bad release does not hide a good one | Module | Pass |
| Download resumes from a partial file (Range request seen), is verified, and stays "ready" after a restart | Module | Pass |
| Server sends different bytes than the manifest promises: verification fails and the partial file is removed | Module | Pass |
| Portable folder, real app: build 1 → Check → Download (189 MB) → Restart and update → updater swapped the folder and started build 2. Took about 3 s after Lumen closed; no leftover folders; Turkish labels; 0 console errors | Real app, real `release.ps1` output | Pass |
| Installed copy: setup build 1 installed silently into `work/`, the updater ran the build 2 setup into the same folder, the uninstaller remained, Lumen was started again; silent uninstall removed the app and its uninstall entry but kept `%LOCALAPPDATA%\lumen.cpp` | Real setup | Pass |

Release build 1 artifacts: portable ZIP 189.3 MB, setup 151.5 MB (Inno Setup LZMA2). Regression after the change: photos, design, explore, composer-clicks, chat-controls, settings-skills and the visual matrix all pass. `settings-skills-check` now uses an installed model from the test data, because the 0.5B model it used was deleted at the user's request.

## Review round: names, formatting, versions, search, Auto context, project folder, providers, skills (2026-10-10)

Machine: RTX 5060 Laptop (8 GB), CUDA13 engine, Electron diagnostic flags as above. **Real** = real host, real llama.cpp and installed models (hard links) or real network. **Fixture** = local test data or a scripted model, no real inference.

| Area | Check | Kind | Result |
| --- | --- | --- | --- |
| Model names | Display name, detail and quant for Coder 7B, Gemma 4 E2B (QAT, UD quant) and Qwen3 8B; picker, selector, message header and Library; stored chat keeps the real name | Real files | Pass (`reg-models`) |
| Thinking support | Read from GGUF templates: Coder 7B unsupported (switch disabled with note), Gemma 4 and Qwen3 supported. Qwen3 8B: on → 614 reasoning tokens, off → 0 and no `<think>` text | Real inference | Pass |
| Auto context | New user gets Auto; existing manual 8,192 kept; Gemma 4 → 16,384 "fits fully on the GPU"; Coder 7B → 16,384; Qwen3 8B → 8,192 "mostly GPU"; Qwen3-Coder-30B MoE → 4,096 "strain" | Real files + hardware | Pass (`test-auto-context.mjs`, `test-models-ui.cjs`) |
| KV estimate | Matches llama-server's reported KV: Qwen3-8B 1,152 MiB, Coder 7B 448 MiB (952 MiB at 32K q8), MoE 768 MiB; Gemma 4 (sliding window/shared layers) ≈54 vs 60 MiB | Real files | Pass (`check-memory-estimate.mjs`) |
| Memory fit while loaded | Coder 7B "gpu" before loading and while loaded; free VRAM with the loaded model added back stays within 592 MiB of the unloaded reading. **Bug found and fixed in this round:** a cached reading taken before the model loaded was counted twice (13.4 GB "free" on an 8 GB card) | Real inference | Pass after fix (`test-fit-loaded.cjs`) |
| Formatting | Headings, Turkish text, inline/block math, tables (right alignment as classes, CSP-safe), highlighted code, unknown language, raw `<script>` shown as text, `javascript:` links removed, Copy returns raw code, links open outside | Fixture | Pass, 0 console errors (`test-format-ui.cjs`) |
| Formatting cost | 300 long messages rendered in 40–48 ms with highlighting/math deferred (600 pending blocks, 0 rendered off screen; 3 rendered after scrolling) | Fixture | Pass |
| Regenerate | New version, pager 2/2, switching changes what is saved, survives reload, Stop restores the previous answer, earlier answer → new branch, research answer regenerated with research (sources kept) | Real inference + Wikipedia | Pass (`test-regen-search-ui.cjs`) |
| Chat search | "istanbul", "cay", "sile", "igdir" find "İstanbul", "ÇAY", "Şile", "ığdır"; rename/delete update results; jump to message | Fixture chats | Pass |
| Project tools | Ranges, long files, `..`, absolute path, junction, `.env`, `id_rsa`, credentials, `.git`, `node_modules`, `dist`, `.gitignore` with negation, 1 MB limit, binary and NUL detection, Turkish file names, explicit allow of `.env` | Fixture folder | Pass (`test-project-tools.mjs`) |
| Project agent | Outside/sensitive reads refused, web query containing file text refused twice, invalid JSON step refused, unknown citation removed, file and web sources kept | Scripted model | Pass (`test-project-agent.mjs`) |
| Project UI | Coder 7B found `loadConfig` with search + read, answered with [F1] citation; excerpt viewer; reload; regenerate; exclusions; detach; Turkish | Real inference | Pass (`test-project-ui.cjs`) |
| Search providers | Local SearXNG mock: 429 with Retry-After 1 s retried once and succeeds; Retry-After 30 s not retried; 503 retried once; two 429s in a row give a clear error; missing Tavily/Brave key gives a clear error with no Wikipedia fallback. Other provider codes (Brave 402/422, Tavily 432/433) are mapped in code but not exercised | Local mock | Pass (`test-web-providers.mjs`) |
| Provider keys | An invalid key sent to the real Brave and Tavily APIs gives "rejected the API key"; one real Wikipedia search | Real network | Pass. **No valid Brave or Tavily key was available; a successful search was not tested.** |
| Skills | v1 → v2 migration of a copy of the user's skills.json (ids and text unchanged, backup equal to original); file/folder/URL import reviews; scripts and `allowed-tools` reported as not imported; http, HTML pages and 127.0.0.1 refused; GitHub page read from raw; selected skill raises prompt tokens 36 → 803 and is not written to the chat file | Real inference + real network | Pass (`test-skills-ui.cjs`) |
| Speed lab | Standard vs Current settings through the host; engine, GPU layers, weight split, load/first-token/prompt/generation reported | Real inference | Pass (`test-host-bench.mjs`, table below) |
| Layouts | Desk/Studio × dark/light × EN/TR and 800×600: chat with table/math/code and project chip, search, model menu, Runtime, Chat behavior, Skills, Speed lab, skill review and project dialogs | Fixture | No horizontal overflow, 0 console errors (`test-visual-matrix.cjs`) |

Speed lab through the host (192-token protocol; one run each, so treat ±10% as noise):

| Model | Profile | Context | Weights GPU / RAM | Load | First token | Prompt | Generation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Qwen2.5 Coder 7B Q4_K_M | Standard | 2,048 | 4,168 / 292 MiB | 9.9 s (cold) | 0.11 s | 493 tok/s | 56.5 tok/s |
| Qwen2.5 Coder 7B Q4_K_M | Current (auto, q8 cache, n-gram) | 16,384 | 4,168 / 292 MiB | 2.6 s | 0.07 s | 712 tok/s | 55.2 tok/s |
| Gemma 4 E2B UD-Q4_K_XL | Current (MTP draft + n-gram) | 8,192 | 1,302 / 1,544 MiB | 5.4 s | 0.11 s | 248 tok/s | 143 tok/s; 76 of 312 drafted tokens accepted |
| Qwen3-Coder-30B-A3B IQ4_XS | Current (auto) | 4,096 | 5,450 / 15,370 MiB | 15.1 s | 6.6 s | 3.9 tok/s | 24.4 tok/s |

Gemma's "RAM" share is most likely its large per-layer embedding table, which llama.cpp keeps in host memory; generation still ran at 143 tok/s. The 7B load time difference is a cold vs warm file cache, not a setting effect. The speed lab prompt is free text, so speculation helps little here; the 271 and 683 tok/s figures below come from editing tasks where the answer repeats the input.

Regression with fresh data after all changes: tools, photos, design, explore, composer-clicks, chat-controls, settings-skills, models, visual matrix and fit-while-loaded all pass (`work/run-regression.ps1`). `test-chat-controls.cjs` passed with fresh data; its earlier failure came from stale test data. `settings-skills-check.cjs` was updated to the review dialog: it now also asserts that nothing is saved before confirming. `test-composer-clicks.cjs` now focuses the window and asserts `document.hasFocus()` before the focus-out step; it passed 4 of 4 runs.

## Beta conversation deletion
Focused scratch-data checks passed: Cancel preserves history and files; confirmation removes only the chosen chat; other chats remain; deleting the active chat opens an empty chat; English/Turkish labels and safe default confirmation buttons work. Invalid IDs/path traversal are rejected, and repeated deletion is idempotent. The UI check mocked dialog responses and used the same isolated software-rendering diagnostic setup described above; it did not delete user conversations.


## GPU setup / Model Hub checks

Passed: NVIDIA build-selection boundaries; invalid backend rejection; archive traversal rejection; persistent CPU choice; downloaded-asset SHA/size checks; verified cache without network; actual HTTP range resume from byte 500,000; corrupted hash cleanup; cancellation without activation. Download pipeline checks used local deterministic fixtures, not a full CUDA install.

UI checks: first-run English welcome, CPU continuation, Settings reopening, quant option rendering, Turkish switching, 800×600 layout, no renderer console errors, no idle animations and renderer isolation. CUDA labels and quant options used fixtures in the restricted Electron diagnostic environment; direct native probing separately detected RTX 5060 / driver 617.14 / compute 12.0 and selected CUDA 13.4. Actual Hugging Face metadata was inspected independently; UI layout fixtures do not stand in for a live network integration test.

A real Qwen2.5 0.5B test used Vulkan, verified 25/25 model layers on the GPU and generated 192 tokens (about 285 tokens/sec in one run). Fixed the offload detector by enabling llama.cpp trace-level startup logs; the default level omitted those records. Real CPU fallback was also exercised. Full CUDA 13.4 installation/inference remains unverified: the official download was interrupted because this test connection was too slow. Partial development downloads are not included in the app. Runtime startup still probes CUDA devices and falls back if necessary.

Model pages use plain DOM/CSS, no remote logos/fonts/frameworks, bounded panel scrolling, short transitions and no polling animation loop. Finished page animations no longer retain a fill state. Existing chat context/deletion logic is retained.

## Bundled model family logos
Model family marks now use seven local organization avatars (35,498 bytes total) with fixed 30px image dimensions and asynchronous decoding. Community conversions resolve by model family before repository owner; unknown models use the existing SVG model icon. The local asset protocol explicitly allows only these image files. No remote image requests, generated logos or animation loops are introduced. The GGUF format tag no longer shrinks into a vertical column.


## Composer, rename and application icon

The native OS model popup is replaced with a local DOM menu, filtered on input. No network calls, polling or idle effects are used for it. Streaming still batches updates into a text node; animations are never run per token. Opening used opacity/transform for 420ms (later replaced; see "Opening animation and Explore"); page/conversation transitions 200–220ms; menus 180ms. Sidebar width transitions are limited to 220ms. Reduced-motion changes also cancel already running Web Animations.

Focused UI checks passed for real native chat persistence, title preservation, rename cancellation, invalid names/IDs, picker filtering/keyboard/focus, local logo loading, attachment composition/removal, binary rejection, English/Turkish controls, 800×600 menu bounds, opening animation completion and no idle animations/renderer errors. Checks use the established isolated Electron diagnostic runtime; saved chats and attachment fixtures live only under work/chat-controls-check. Windows icon was extracted from the updated executable and visually verified.

## Settings / skill checks (2026-10-08)

Passed store tests: create/update/delete, persisted selections, Markdown import/export, IDs and limits, combined prompt budget, crash recovery and preserving messages. The library and selection metadata are cached in the main process, avoiding per-chat disk rereads during bootstrap. Model metadata caches are capped at 24 entries; model-card downloads are bounded to 24 KB and rendered text to 16,000 characters. No new framework or remote UI asset was added.

The isolated Electron UI check passed: all settings sections and back navigation, chat-only rail, skill create/select/preview, @ keyboard selection without sending, multi-select focus, folder import/export/deletion, theme/font persistence, EN/TR, and 800×600 bounded layout. Model metadata/quant layout used IPC fixtures; it is not a live network integration test. Screenshots were inspected.

Real Qwen2.5 0.5B inference with the native bundled engine passed. For the same message and base prompt, input usage was 23 tokens without a skill and 52 with the selected skill; both generated 10 tokens in a 2,048-token session. Base prompt restoration, complete message persistence and branch skill inheritance passed. Crash recovery was exercised with isolated store data. The UI diagnostics reported 149ms bootstrap initialization, 706 DOM nodes, no recorded long tasks and no renderer errors in that run; these are diagnostic samples, not end-to-end startup or sustained performance benchmarks. Reduced motion left no active animations. Existing production sandbox/GPU startup limitations described above still apply.

Existing chat controls also passed after the settings change: custom model menu/logos, search and keyboard selection, rename persistence/cancel, UTF-8 attachment/removal, invalid ID/binary rejection, Turkish controls, compact menu bounds and finite opening animations. See isolated work/chat-settings-regression/result.json.

## Two layouts and display modes (2026-10-08)

Added a small plain-JavaScript layout controller and one semantic CSS layer; the two layouts share the same DOM, renderer and inference engine. No second renderer, framework, remote assets, background animation or polling loop was introduced. Four local 620×430 PNG previews total approximately 179 KiB. Layout/display-mode changes update body attributes and retain existing chat/model state.

Isolated UI checks passed: first-run choice with two actual screenshots, explicit selection, keyboard controls, English/Turkish, 800×600 action visibility, GPU setup preserved after choosing, and persistent appearance settings. A separate real process restart using the same scratch data skipped the chooser and restored Studio/Light. All four layout/mode combinations passed compact chat bounds and retained menus/messages/code blocks/settings. Reduced motion left no running animations; no renderer errors were recorded.

Inspected rendered light-mode screenshots for appearance, skills, runtime, model library and the model picker. Corrected low-contrast inherited dark-theme colors on user messages, quant/fit values, model menu actions, window controls and metadata. A computed-style contrast audit of the sampled empty/chat/menu/appearance/skills/runtime/explore surfaces in all four combinations found no sampled visible text below 4.5:1 after fixes. This is a targeted style audit, not a claim of complete accessibility certification. Existing test-only software-rendering and production startup limitations above still apply; no new memory or sustained CPU benchmark is claimed.

## Photo attachments (2026-10-08)

Added local photo picker/paste, thumbnail viewer, OCR and conversation reference persistence, sharing the existing DOM and theme variables. Imports are serialized; size/dimension checks bound decoding. Images normalize to a 1,600-pixel long edge; messages load local 160-pixel thumbnails lazily rather than full photo buffers. Content hashes deduplicate images. The metadata cache is capped at 32 entries; historical chat decoration omits duplicate OCR text. Windows OCR runs in one short-lived subprocess per uncached photo with a 20-second timeout. WebP uses the existing Chromium decoder because nativeImage in the bundled runtime did not decode that format. No new runtime framework, network OCR service or idle polling was introduced.

The isolated UI test passed actual PNG/JPEG/WebP decoding, local Windows OCR (LUMEN PHOTO 42 / LOCAL TEST 1234), inclusion of OCR in composed model input, enlargement/text viewing, native chat save/bootstrap, branch inheritance, editing drafts, shared-reference deletion and final draft cleanup. Clipboard ingestion used the real handler with a clipboard-read fixture; the user's clipboard was not changed. Invalid raster content, invalid IDs, source files above 12 MB and excessive PNG dimensions were rejected. Desk/Studio Light/Dark retained compact 800×600 bounds; Turkish controls and renderer error capture passed. Screenshots were inspected.

A separate end-to-end generation attempt could not start the existing native bridge's inference engine in this diagnostic run. The same CPU server/model loaded when launched directly, but no successful photo-to-model-answer result is claimed. The tested feature passes OCR text to the unchanged text inference path; full image-pixel/multimodal inference is not implemented. Existing production sandbox/startup testing limitations above remain. No new sustained CPU or working-set benchmark is claimed.

## Engine performance (2026-10-09)

**Setup**
- Hardware: RTX 5060 Laptop GPU (8 GB), i7-13620H, 24 GB RAM, CUDA 13 engine, b11438.
- Tool: `work/perf-engine.mjs`. It runs llama-server directly with each set of flags, temperature 0, seed 42, 8K context, two coding prompts:
  - *write*: new code;
  - *edit*: rewrite a 45-line file with one rename.
- First-run numbers are used, because n-gram caches can flatter repeated prompts. Output hashes were compared.
- Results are in `work/perf/results/*.json`.

| Model / setting | write tok/s | edit tok/s | Output vs. base |
|---|---|---|---|
| Qwen2.5-Coder-7B Q4_K_M, all on GPU | 48.1 | 49.1 | — |
| + KV cache q8_0 | 49.4 | 47.6 | identical; 229 MB less VRAM at 8K |
| + n-gram (ngram-simple) | 54.7 | **271.1** | identical |
| Gemma 4 E2B Q4_K_XL, all on GPU | 131.2 | 132.8 | — |
| + MTP draft (Q8_0, 93 MB) | 233.9 | 283.0 | edit identical; write differs slightly |
| + n-gram | 129.7 | 531.5 | identical |
| + MTP + n-gram | 225.4 | **682.8** | edit identical |

- **Engine choice.** CUDA and Vulkan generated at the same speed (53–55 tok/s). CUDA read prompts twice as fast: 1,583 vs 770 tok/s.
- **Auto GPU memory.** For models that fit, it gave the same speed as all-on-GPU.
- **An early slow sample is discarded.** One sample measured ~10 tok/s while the GPU was busy with another application. It was re-measured.
- **Through Lumen** (`work/test-host-engine.mjs`):
  - default settings: 55.5 tok/s;
  - Faster generation on the edit prompt: 273 tok/s;
  - Gemma with MTP: 639 tok/s;
  - CPU only: 13 tok/s;
  - 7B at 32K context with q8_0: works on 8 GB;
  - vision + MTP + n-gram together: starts normally;
  - invalid options are rejected;
  - killing the host also ends llama-server (1 → 0 processes).
- **UI** (`work/test-speed-ui.cjs`). The real llama-server command line showed:
  - default: `--spec-type ngram-simple` and no `-ngl`;
  - compact + 32K: `-ctk q8_0 -c 32768`;
  - with a draft: `draft-mtp,ngram-simple -md …`;
  - CPU only: `-ngl 0` on the CPU engine.
  The Draft row found the 93 MB file on Hugging Face, and Remove deleted it. Turkish labels and IPC validation passed.
- **Large MoE model.** Qwen3-Coder-30B-A3B IQ4_XS is 16.4 GB, twice the VRAM. It was downloaded only into test data.
  - All on GPU (the old behavior): the driver spills into system memory. Loading takes 158 s and generation runs at **2.1 tok/s**.
  - Auto: llama.cpp places the experts in RAM. Loading takes 12 s and generation runs at **36 tok/s**, about 17× faster.
  - Experts forced to the CPU (`--cpu-moe`): 30 tok/s. CPU only: 22–25 tok/s.
  - Through Lumen with Auto: 27 tok/s on the first answer. Faster generation added only ~15% on this model (34 → 40 tok/s while editing), because checking drafted tokens touches experts held in RAM.
  - A larger batch (`-ub 1024/2048`) did not help, so it was left at the default.
- **Not measured:** AMD/Vulkan hardware, speculative decoding for very long answers, and quality differences beyond output hashes.

## Seeing photos (2026-10-09)

- **Host, direct** (`work/test-host-vision.mjs`, results in `work/vision-check/host-result.json`). Model: Gemma 4 E2B Q4_K_XL with `mmproj-F16.gguf`. Photo: a copy of an anime screenshot the user attached.
  - The projector was downloaded with Lumen's downloader in 198 s (940 MB, SHA-256 verified).
  - The server started with `--mmproj`. The image raised the prompt from 33 to 268 tokens.
  - The model described the picture correctly: brown bob hair, navy blazer, finger near the mouth.
  - Without the projector, the same request asked for OCR text instead.
  - A follow-up turn reused the loaded server (0.8 s).
  - Rejected: a projector outside the models folder, a non-PNG or outside image, and a wrong message index.
- **Recognition.** The character is Yui Hirasawa (K-On!). Across 5 runs the model named Miku Nakano, Ritsu (K-On!), Mami Tomoe, Maki Nishikino, and once declined to name anyone. Only one run had the right series. **The 2B-class model sees the image but does not reliably recognize characters.**
- **Comparison with a larger model** (`work/test-vision-recognition.mjs`, results in `work/vision-check/recognition-*.json`). Same photo, 3 questions in English and Turkish, 9 runs per model. The image reached the model in every run (prompt token counts).
  - Gemma 4 E2B: Yui named in 0/9 runs, the series (K-On!) in 4/9. In two runs it claimed no image was attached.
  - Qwen2.5-VL 7B Q4_K_M (ggml-org, f16 projector; downloaded only for the test): Yui named in 0/9 runs, the series in 6/9. It gave other K-On! names (Mio Akiyama, invented names) or other series. It took 19–138 s per answer on the diagnostic CPU/Vulkan engine.
  - Conclusion: neither local model recognizes this character. Series recognition is better with the larger model.
- **UI** (`work/test-vision-ui.cjs`, results in `work/vision-ui/`):
  - offer → real Hugging Face check (940 MB) → enable (the file already existed, so nothing was downloaded again);
  - "The model sees these photos" hint, then the answer, with the sent-message note "Sent to the model as an image";
  - Settings Vision row → Remove unloads the model and deletes the file (other hard links kept);
  - a text-only model gets "no vision support";
  - Turkish text, IPC validation, no console errors.

## Thinking, response settings and browser tools (2026-10-09)

All runs used the isolated diagnostic runtime and test data with hard-linked models.
- **Host, direct** (`work/test-host-chat.mjs`, results in `work/thinking-check/host-result.json`):
  - The new `chat` request and the original `send` gave identical context numbers on the same chat: 35 prompt tokens, 512 reserved.
  - A 29-message history in a 2,048 window: both omitted 16 messages with a 1,361-token prompt.
  - A 1,024 response length shows Reserved 1,024.
  - Cancel saves an interrupted assistant turn.
  - Invalid requests are rejected (no user message, context 1000, unknown model).
- **Thinking with a real model** (Gemma 4 E2B Q4_K_XL, CPU/Vulkan diagnostic engine):
  - 484 reasoning events (1,031 characters) were separate from the answer: "No. 391 is composite (17 × 23)". The run took 20 s.
  - The same question with thinking off answered "Yes.", which is wrong. This is one example, not a quality benchmark.
- **UI** (`work/test-thinking-ui.cjs`, results in `work/thinking-ui/`):
  - Settings work as segmented controls.
  - The live "Thinking…" block turns into "Thought for 125 s". In this diagnostic environment Gemma generated about 4.5 tokens/s.
  - Reasoning is saved, survives a bootstrap reload, is copied on branching and is hidden when Show thinking is off.
  - With thinking off, the context reserve shows 1,024 and no thinking block appears.
  - Turkish labels are present. Invalid preference values are ignored.
- **Research with thinking** (`work/test-thinking-research.cjs`): 187 s with 1 task. Reasoning was shown live and saved with the turn (1,439 characters). The answer had citations: completed 1887–1889, 330 m.
- **Browser** (same UI test):
  - Words in the address bar are searched with the selected engine (Bing in the test).
  - httpbin received `Sec-GPC: 1` and `DNT: 1`.
  - Ctrl+= inside the page zoomed to 110% and the indicator reset it.
  - Ctrl+F inside the page opened the find bar: 45 matches for "lens", and Enter went to match 2.
  - Ask about page added the URL and the research chip.
  - Turning JavaScript off kept the panel at the same address, and page scripts no longer ran.
  - The wide panel measured 719 px in a 1,240 px window.
  - Blocked pop-ups opened nothing; "open here" loaded example.com in the panel.
  - A 192.168.x address was still blocked, and `window.lumen` was undefined in pages.
  - No renderer console errors.
- **Not verified:** thinking with Qwen3 or DeepSeek R1 (not installed here); clear-on-exit in a real quit (the code path was only reviewed); behavior on the user's CUDA engine.

## Performance pass (2026-10-09)

Measured with `work/perf-ui.cjs`. The harness injects synthetic data into renderer state only: 200 conversations and one conversation with 300 Markdown messages. Each timing is a median that includes a forced layout. Startup used `work/perf-startup.cjs` with motion off. All runs used the isolated diagnostic runtime.

**Baseline.** Idle CPU was 0.02–0.06% with no running animations, and idle memory was about 277 MB (browser 128, utility 46, renderer 102). Rendering 300 messages took 5.7 ms, 200 history rows 4.8 ms, opening a settings section ≤0.8 ms. A simulated 3,000-chunk stream produced no long tasks.

**The one real hotspot.** Every preference change (text size, accent, context window, motion) called `localize()`, which re-rendered the whole conversation with Markdown, the history, the model lists and Explore, even when the language did not change. Now only a language change triggers those re-renders; other preferences update the cheap parts (context meter, pickers, settings, segmented controls).

| Measurement | Before | After |
| --- | --- | --- |
| Preference click (text size / accent / context, including IPC and file write) | 16.6–23 ms | 1.1–6.7 ms |
| `localize()` without a language change | 12.1–12.4 ms | 4.8–5.0 ms |
| Memory after the long-conversation run | 394–401 MB | 353–358 MB |
| Idle memory / idle CPU | ~277 MB / ~0.03% | unchanged |

**Kept, with no measured effect.**
- **Lazy web session.** The `persist:lumen-web` browser session is now created on first use instead of at startup. Idle memory did not change measurably; it is kept because no web session is created on disk until web features are used.
- **Lazy previews.** The design-chooser preview images are lazy-loaded.
- **Parallel startup requests.** The renderer requests preferences and bootstrap in parallel.

**Tried and reverted.** Starting the engine's bootstrap in the main process before the page asked for it. In an interleaved A/B test (8 runs each, motion off), ready time averaged 698 ms before and 707 ms after, so there was no gain. A direct probe showed why:
- **Bootstrap cost:** about 285 ms, with the first call carrying about 130 ms of one-time WMI/JIT warm-up. The backend runs two WMI queries and `nvidia-smi` (about 50 ms) on every bootstrap; that code is in the binary and was not changed.
- **Splash hold:** with motion on (the default), the 600 ms splash hold is longer than bootstrap, so startup is bounded by the hold anyway.

Regression after this pass: design choice, photos, explore/opening, hidden renderer and the full tools UI flow passed with no renderer errors.

## Model downloads: diagnosis and measurements (2026-10-08)

The backend download code was read from the existing binary (IL; the source is not available). It uses one HTTP connection with an infinite timeout. It reads 80 KiB at a time and waits for each disk write before the next read. On resume it trusts any existing `.partial`, and it hashes the whole file after the download. It never retries, and progress text contains only MB.

Real Hugging Face measurements, all on this machine with the same file (Qwen2.5 0.5B Q4_K_M, 491,400,032 bytes), each into a fresh scratch folder, run alternately:

| Run | Network phase | Average | Verify phase |
| --- | --- | --- | --- |
| Backend, run 1 | 88.9 s | 5.27 MB/s | 0.6 s |
| Backend, run 2 | 89.2 s | 5.25 MB/s | 0.8 s |
| New downloader, run 1 (adapted to 2 connections) | 97.4 s | 4.81 MB/s | 0.01 s |
| New downloader, run 2 (adapted to 4 connections) | 89.8 s | 5.22 MB/s | 0.07 s |
| New downloader inside the app (includes a pause/resume) | 96.8 s total | — | — |

Link probes on the same connection gave Cloudflare at 5.42–5.48 MB/s with one connection and Hugging Face's CDN (`us.aws.cdn.hf.co`) at 4.1–5.0 MB/s with 1 to 6 connections. Conclusion: on this connection the bandwidth itself is the bottleneck. The old single stream already used about 97% of it, and **the new downloader is not faster here**. No speed-up is claimed for this machine. What changed is reliability (stall detection, retry with backoff and Retry-After, identity-checked resume, pause) and a near-zero verification wait, because hashing runs in a worker thread during the download. Progress reaches the UI at most 4 times per second, measured at 3.9 per second.

Local test server (not Hugging Face) with a 40 MB file, `work/test-downloader.mjs`; all 15 cases passed:
- normal completion, and range ignored (200) → single-stream fallback;
- connection drops, a short body and 429 with Retry-After, all retried;
- wrong hash → removed and not installed; size mismatch → rejected;
- pause/resume keeping chunk progress; cancel removes the partial; duplicate start blocked;
- resume from an old backend-style `.partial`; stale progress metadata discarded;
- write error reported, nothing installed;
- progress throttling.

With a server that limits each connection to about 1.5 MB/s, the adaptive mode went from 1.30 MB/s on one connection to 3.87 MB/s on four. That shows the benefit for lines with a per-connection limit; it is not a Hugging Face measurement.

In-app check (`work/test-download-ui.cjs`): a real Hugging Face download from the app showed downloading → paused → downloading → verifying → completed. Chat input stayed enabled throughout. The model was then marked installed and produced a real reply through the unchanged native chat path. A second start for an installed file completes immediately.

## Agents, search and browser (2026-10-08)

**Engine access.** `lumen-host.exe` (25 KB, .NET 4.8, source alongside) hosts the unchanged bridge and adds a `complete` action against the already-loaded llama-server (`--parallel 1`). Direct checks (`work/test-host.mjs`):
- a schema-constrained answer parsed as valid JSON;
- a following normal `send` reused the same loaded server (143 ms, no reload);
- cancel stopped a streaming request in about 0.7 s;
- invalid context, roles and models were rejected.

If the host is missing, Lumen falls back to the original backend: tools are reported unavailable and normal chat still replied (`work/test-host-fallback.cjs`).

**Real research, no Electron** (`work/test-agent.mjs`, real Wikipedia, real page reads):
- **Coder 7B:** two correct subtasks, both towers, and an answer where every claim carried a valid citation. It took 210 s because this diagnostic environment ran the 7B at about 2.2 tokens/s.
- **Coder 1.5B:** finished in about 25 s; answer quality varied between runs.
- **0.5B:** one task failed cleanly ("could not produce a valid tool call"), the other result was kept and an answer was still produced.

Malformed calls were rejected before execution: unknown tool, missing field, extra field, wrong type, not JSON. Reads of `127.0.0.1`, `localhost`, `file:`, `192.168.x`, `[::1]` and `169.254.169.254` were refused. A redirect to a private address and a public DNS name resolving to loopback were refused (`work/test-web.mjs`). Repeated searches are served from cache (531 ms first, 0 ms repeat).

**Electron UI** (`work/test-tools-ui.cjs`, desk/studio × light/dark, EN/TR, 800×600; screenshots inspected):
- **Defaults:** web is off by default and normal chat still works.
- **Consent:** web research turns on only after the consent prompt.
- **Research run:** the activity line shows the live state; tasks are recorded and saved; sources are real Wikipedia URLs and are restored after reload.
- **Browser panel:** it opened a real source, with no `window.lumen` and no `require` inside the page. A blocked address shows a plain "blocked" message.
- **Stop:** the run ended in 109 ms with no agent events afterwards, and the turn was saved as interrupted.
- **Auto routing:** a plain message went to normal chat without any model planning call; a "latest news" message routed to research.
- **IPC:** 7 malformed calls were rejected.
- **Renderer:** no errors.

The hidden JavaScript renderer read a real page in 4.3 s inside the separate `persist:lumen-web` session, with no Lumen API, `require` or `process`. It also refused a private address and cancelled when asked (`work/test-render.cjs`).

**Performance.** No idle loops or polling were added.
- **Activity** repaints only when a runtime event arrives (a few per task), batched with requestAnimationFrame.
- **Streamed answers** reuse the existing batching into one text node per animation frame.
- **Browser view position** updates through ResizeObserver and requestAnimationFrame, not a timer.
- **Hidden renderer** is destroyed after 60 s idle.
- **Caches are capped:** 60 searches, 40 pages, 200 metadata entries.

**Regression suites in this runtime:**
- Passed: composer mouse clicks, explore/opening, photos, design choice.
- Failed, with or without the new `tools.js` loaded: `test-chat-controls.cjs` (model-menu keyboard selection with a programmatic click) and `settings-skills-check.cjs` (skill picker focus after a programmatic row click). Both test renderer focus via synthetic `.click()`. They predate the composer focus fix and are recorded here as unresolved test failures, not as passes.

The same test-only software-rendering flags and the production sandbox limitation described at the top still apply.

## Opening animation and Explore (2026-10-08)

Opening: a static splash in index.html (CSS only, one entrance of ≤900 ms) covers engine startup. When bootstrap is done, one Web Animations sequence moves the mark into the titlebar (480 ms) and the shell rises in (420 ms each, 40 ms apart), then the splash element is removed. While motion is allowed, bootstrap is held until 600 ms after renderer start so the frame never flashes; in the isolated run startupMs was 616 and the splash was gone at about 1.0 s. Motion off / reduced motion skips the hold and the animation. The preference is also applied to the initial HTML so the CSS entrance does not run when Motion is off. No loops, timers or polling remain after the opening.

Explore: one new main-process IPC (`hub`) queries the public Hugging Face models API (GGUF filter, download order, 30 results, 20 s timeout) and returns only validated repository IDs and numeric/string metadata. Results are cached in memory (12 queries); list metadata cache in the renderer is capped at 200 entries. Search falls back to the existing engine search if this request fails. No remote images: family shortcuts reuse the seven bundled logos.

The isolated UI check (work/explore-opening-check-2) passed with no renderer errors: splash present before ready and removed afterwards; real Popular (30 rows) and Gemma (30 rows) results from the network; Qwen2.5 0.5B details with six metadata facts, nine quants and Q4_K_M as Best fit; filters hidden in Library; Desk/Studio Light/Dark; Turkish; 800×600. A focused check (work/explore-auxiliary-check) confirmed that the four MTP draft files in unsloth/gemma-4-12b-it-GGUF are hidden and 21 real quants remain. Screenshots were inspected. The same test-only software-rendering flags and sandbox limitation above apply. Downloading a model from these new lists was not exercised; it uses the unchanged register/download path.

## Composer menu focus fix (2026-10-08)

Reproduced photo and skill actions disappearing before their click handler using Electron mouse input (programmatic HTMLElement.click had missed the issue). Replaced the focusout microtask's transient activeElement check with the event's relatedTarget: internal focus changes and temporary null focus no longer dismiss the menus; focus moving outside the composer still dismisses them. No new listeners, timers, dependencies or polling were added.

The isolated mouse regression passed Desk/Studio in Light/Dark: 12 photo action clicks reached the native picker handler (dialog response canceled by a test fixture), skill pickers stayed visible, internal/null focus was preserved, outside focus/click dismissed menus, and Turkish localization passed with no captured renderer errors. The earlier photo decoding/OCR/persistence checks remain separate. Updated the existing Beta directory in place.
