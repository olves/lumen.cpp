# Third-party notices

Lumen's own code is under the MIT license (see `LICENSE`). It uses or redistributes the following components, each under its own license.

| Component | Version | License | Where |
| --- | --- | --- | --- |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) | b11438 | MIT | Inference engine; downloaded/bundled by the backend. `docs/licenses-llama.cpp.txt` |
| [Electron](https://www.electronjs.org/) | 44.5.1 | MIT (Chromium components under their own licenses) | Desktop runtime in the release ZIP. `docs/licenses-electron.txt`; the release also contains `LICENSES.chromium.html` |
| [markdown-it](https://github.com/markdown-it/markdown-it) | 14.1.0 | MIT | `app/vendor/markdown-it.min.js`, `app/vendor/LICENSE.markdown-it.txt` |
| [highlight.js](https://highlightjs.org/) | 11.11.1 | BSD-3-Clause | `app/vendor/highlight.min.js`, `app/vendor/LICENSE.highlight.txt` |
| [KaTeX](https://katex.org/) | 0.16.22 | MIT | `app/vendor/katex.*`, `app/vendor/fonts/`, `app/vendor/LICENSE.katex.txt` |

**Model family marks** in `app/logos/` are the organizations' Hugging Face profile images (sources in `app/logos/sources.json`). They belong to their owners, are used only to identify model families, and do not imply endorsement.

**Models** are not part of this repository. Each model you download keeps the license published on its Hugging Face page.

**Backend.** `lumen-core-beta.exe` (in the release ZIP) is a .NET Framework 4.8 program from an earlier stage of this project; its source is not included here. `app/backend/LumenHost.cs` uses it as a library and adds the newer engine features.
