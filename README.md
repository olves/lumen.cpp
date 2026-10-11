# lumen.cpp (Beta)

A local AI chat workspace for Windows. Lumen runs open models (GGUF) on your own computer with [llama.cpp](https://github.com/ggml-org/llama.cpp). There is nothing to install besides the app folder: no Python, no Ollama, no npm. Chats, models and settings stay on your machine.

![Lumen, Studio layout, dark](app/previews/studio-dark.png)

> **Beta.** Lumen is a portable, unsigned Beta. Windows SmartScreen may warn on first launch.

## Features

- **Chat** with streaming answers, stop, branches, regenerate with versions, local chat search (Ctrl+K), Markdown with highlighted code, tables and math.
- **Models**: browse Hugging Face GGUF repositories, download with resume and SHA-256 checks, and see an estimate of whether a model fits your GPU, RAM or both.
- **GPU setup**: picks CUDA 13 / CUDA 12 / Vulkan / CPU automatically. AMD and Intel GPUs use Vulkan.
- **Performance**: automatic GPU/RAM placement (large MoE models work on 8 GB GPUs), compact 8-bit context cache, speculative decoding (n-gram and MTP draft models), contexts up to 32K, and an Auto context size per model.
- **Thinking models** (Qwen3, Gemma 4…): optional reasoning shown in a collapsible block. Lumen detects which models support it.
- **Photos**: OCR on Windows, and real image input for vision models with a projector (mmproj).
- **Web research (optional, off by default)**: a planner and sequential subagents search and read pages, then answer with citations. Providers: Wikipedia (no key), Tavily, Brave Search, or your own SearXNG.
- **Project folder (read-only)**: let a model list, find, search and read files in a folder, with file citations. It cannot write, delete or run anything.
- **Skills**: reusable instructions and reference notes you select per conversation.
- **Desk / Studio layouts, light and dark, English and Turkish.**

## Download and run

1. Download `lumen-beta-portable.zip` from the [Releases](../../releases) page.
2. Extract it anywhere and run `lumen.cpp.exe`.

Requirements: Windows 10/11 x64, .NET Framework 4.8 (built into current Windows). A GPU is optional.

Your data lives in `%LOCALAPPDATA%\lumen.cpp` (chats, models, settings). Deleting the app folder does not delete it.

## Privacy and safety

- The model server listens on loopback only and uses a random key per launch.
- Nothing leaves your computer unless you turn on web research. Then only search queries go to the provider you chose, and pages are fetched from their own sites. API keys are encrypted with Windows DPAPI.
- Model output is never executed as HTML. Web pages are read as untrusted data, with private and local network addresses blocked.
- Project folders are read-only. Keys, `.env` files and similar stay unreadable unless you allow a specific file.

More detail: [docs/USER-GUIDE.md](docs/USER-GUIDE.md). Measurements and test notes: [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md).

## Repository layout

```text
app/                 Electron app: main process (*.cjs), renderer (*.js, *.css, index.html), vendored libraries
app/backend/         LumenHost.cs (engine host) and ImageOcr.cs (Windows OCR helper) sources
docs/                User guide, measurements, licenses
scripts/             build-portable.ps1 and the pinned Electron download manifest
```

The UI is plain HTML, CSS and JavaScript with no build step. Renderer scripts share one global scope and load in the order listed in `app/index.html`.

## Building from source

```powershell
.\scripts\build-portable.ps1 -Backend <path to lumen-core-beta.exe>
```

The script downloads Electron 44.5.1 and checks it against a pinned SHA-256. It then copies `app/` into place and compiles `lumen-host.exe` and `lumen-image-ocr.exe` with the .NET Framework compiler included in Windows.

The native backend `lumen-core-beta.exe` comes from an earlier stage of the project, and its source is not available. Take it from the release ZIP (`resources/app/backend/`). `LumenHost.cs` uses it as a library and adds the newer engine features.

## License

MIT. See [LICENSE](LICENSE). Third-party components and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Downloaded models keep their own licenses.

---

**Türkçe:** Lumen, Windows'ta yerel yapay zekâ modelleriyle sohbet etmenizi sağlayan, kurulum gerektirmeyen bir uygulamadır (Beta). Releases sayfasından `lumen-beta-portable.zip` dosyasını indirin, bir klasöre çıkarın ve `lumen.cpp.exe`'yi çalıştırın. Arayüz Türkçe kullanılabilir (Ayarlar → Genel → Dil).
