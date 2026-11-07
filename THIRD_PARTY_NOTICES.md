# Third-party notices

Lumen's own code is under the Apache License 2.0 (see `LICENSE` and `NOTICE`). It uses or redistributes the following components, each under its own license.

| Component | Version | License | Where |
| --- | --- | --- | --- |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) | b11438 | MIT | Inference engine. The official CPU and Vulkan builds are bundled unchanged (`app/backend/engines/` in the release); CUDA builds and newer engine versions are downloaded from the official releases. `docs/licenses-llama.cpp.txt` |
| [Electron](https://www.electronjs.org/) | 44.5.1 | MIT (Chromium components under their own licenses) | Desktop runtime in the release ZIP. `docs/licenses-electron.txt`; the release also contains `LICENSES.chromium.html` |
| [markdown-it](https://github.com/markdown-it/markdown-it) | 14.1.0 | MIT | `app/vendor/markdown-it.min.js`, `app/vendor/LICENSE.markdown-it.txt` |
| [highlight.js](https://highlightjs.org/) | 11.11.1 | BSD-3-Clause | `app/vendor/highlight.min.js`, `app/vendor/LICENSE.highlight.txt` |
| [KaTeX](https://katex.org/) | 0.16.22 | MIT | `app/vendor/katex.*`, `app/vendor/fonts/`, `app/vendor/LICENSE.katex.txt` |
| [pdf.js](https://github.com/mozilla/pdf.js) (pdfjs-dist) | 6.3.289 | Apache-2.0 | PDF text for Documents, main process only. `app/vendor/pdfjs/` (legacy build), `app/vendor/LICENSE.pdfjs.txt` |
| [Node.js](https://nodejs.org/) | 22.23.4 | MIT (with the licenses of its bundled components, see nodejs.org/en/about/licenses) | Tauri preview build only (not in releases): the official `node.exe`, SHA-256 pinned in `scripts/node-manifest.json`, runs the shared core next to the shell. |
| [Tauri](https://tauri.app/) (`tauri`, `tauri-build`) | 2.12.4, 2.7.3 | Apache-2.0 OR MIT | Tauri preview shell (`shell-tauri/`, not in releases) |
| [tauri-plugin-single-instance](https://github.com/tauri-apps/plugins-workspace) | 2.5.4 | Apache-2.0 OR MIT | Tauri preview shell |
| [tauri-plugin-opener](https://github.com/tauri-apps/plugins-workspace) | 2.7.2 | Apache-2.0 OR MIT | Tauri preview shell (its Rust function only; the plugin is not registered in any webview) |
| [wry](https://github.com/tauri-apps/wry) / [webview2-com](https://github.com/wravery/webview2-rs) | wry 0.57.1 (a dependency of tauri), webview2-com 0.39.1 | wry: Apache-2.0 OR MIT; webview2-com: MIT | Tauri preview shell: WebView2 bindings |
| [windows](https://github.com/microsoft/windows-rs) | 0.62.2 | MIT OR Apache-2.0 | Tauri preview shell: Win32 (job objects, DPAPI, keyboard) |
| [rfd](https://github.com/PolyMeilex/rfd) | 0.17.2 | MIT | Tauri preview shell: file and message dialogs |
| [arboard](https://github.com/1Password/arboard) | 3.7.0 | MIT OR Apache-2.0 | Tauri preview shell: clipboard text and images |
| [image](https://github.com/image-rs/image) | 0.25.10 | MIT OR Apache-2.0 | Tauri preview shell: PNG/JPEG/WebP decoding and thumbnails |
| [aes-gcm](https://github.com/RustCrypto/AEADs) | 0.10.3 | Apache-2.0 OR MIT | Tauri preview shell: reads and writes the Electron safeStorage format |
| [zeroize](https://github.com/RustCrypto/utils) | 1.9.1 | Apache-2.0 OR MIT | Tauri preview shell: clears key material |
| [getrandom](https://github.com/rust-random/getrandom) | 0.3.4 | MIT OR Apache-2.0 | Tauri preview shell: nonces |
| [base64](https://github.com/marshallpierce/rust-base64) | 0.22.1 | MIT OR Apache-2.0 | Tauri preview shell |
| [serde](https://github.com/serde-rs/serde), [serde_json](https://github.com/serde-rs/json) | 1.0.229, 1.0.154 | MIT OR Apache-2.0 | Tauri preview shell |
| [tokio](https://github.com/tokio-rs/tokio) | 1.54.1 | MIT | Tauri preview shell |
| [percent-encoding](https://github.com/servo/rust-url) | 2.3.2 | MIT OR Apache-2.0 | Tauri preview shell |

**Tauri preview build.** The crates above are the direct dependencies of `shell-tauri/Cargo.toml` (exact versions from `Cargo.lock`, licenses from `cargo metadata`); their own dependencies are listed in `shell-tauri/Cargo.lock` and carry permissive licenses of the same kind. The preview build uses Microsoft's WebView2 runtime that is installed with Windows (Evergreen); Lumen does not ship it.

**Model family marks** in `app/logos/` are the organizations' Hugging Face profile images (sources in `app/logos/sources.json`). They belong to their owners, are used only to identify model families, and do not imply endorsement.

**Models** are not part of this repository. Each model you download keeps the license published on its Hugging Face page.

**Engine process.** `lumen-host.exe` is built from `app/backend/LumenHost.cs` and `LumenCore.cs` in this repository (since v1.0.4-beta; earlier releases also contained a closed `lumen-core-beta.exe`, which is no longer used or shipped).
