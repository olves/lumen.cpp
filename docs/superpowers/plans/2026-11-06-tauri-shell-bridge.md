# Tauri kabuğu ve Node köprüsü — uygulama planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lumen'in mevcut arayüzü ve Node modülleri, Electron yapısı çalışmaya devam ederken bir Tauri 2 kabuğunda da birebir çalışsın.

**Architecture:** `main.cjs` Electron'suz bir çekirdeğe (`core.cjs`) ve ince bir Electron kabuğuna bölünür. Çekirdek, platform hizmetlerini bir `platform` nesnesinden alır. Tauri'de çekirdek `node.exe` yardımcı sürecinde çalışır, Rust ile stdio üzerinden satır başına JSON konuşur. Rust kabuğu platform hizmetlerini, pencereleri ve webview'leri sağlar.

**Tech Stack:** Tauri 2 (sürüm tam sabit, `unstable` özelliği), Rust stable (MSVC), WebView2 Runtime, Node 22 LTS (`node.exe` paketlenir), mevcut Electron 44.5.1, CDP (Node 22 yerleşik `WebSocket`).

**Spec:** `docs/superpowers/specs/2026-11-06-tauri-shell-bridge-design.md`

## Global Constraints

- Commit ve push yalnızca kullanıcının açık onayıyla. Her görevdeki "Commit" adımı onay gelene kadar bekler. İş `tauri-shell` dalında yapılır.
- Kurulum (Rust, VS Build Tools) yalnızca kullanıcının açık onayıyla.
- Sürüm numarası değişmez (`1.0.5-beta`, build 5). Release, setup, ZIP üretilmez. `outputs/` altına dokunulmaz.
- Veri klasörü `%LOCALAPPDATA%\lumen.cpp`; testler her zaman `--test-data=<work altında geçici klasör>` ile çalışır. Kullanıcının gerçek sohbetleri hiç kullanılmaz; modeller yalnızca hard link ile okunur.
- Test çıktıları ve kanıtlar `Lumen WF/work/` altına yazılır. Test **kaynakları** repoda, `tests/` altında durur *(plan kararı: eski testler repo dışında durduğu için kayboldu)*.
- npm bağımlılığı eklenmez. Rust crate'leri sürümleriyle `Cargo.toml`'da sabitlenir.
- Kullanıcıya dönük her yeni metin İngilizce ve Türkçe eklenir.
- Dosyalar UTF-8 yazılır; PowerShell'de `Get-Content -Raw` ile Türkçe metin içeren dosya yeniden yazılmaz (CLAUDE.md §2 kodlama tuzağı).
- Commit mesajlarında `Co-Authored-By` satırı yok (CLAUDE.md §10b).
- Üretim yapısında uzaktan hata ayıklama portu açılmaz; yalnızca `--ui-check` + test derleme bayrağı birlikteyken.

## Review Focus

1. **Çekirdek yanıt vermiyor ya da çöküyor** (ör. `lumen-host` takıldı, Node istisnası): arayüz donmamalı, `fatal` olayı gelmeli, bir kez yeniden başlatma denenmeli. → Task 4 ve Task 5 testleri.
2. **Uzun bir yanıt akarken pencere kapatılıyor:** çekirdek ve `lumen-host` arkada süreç bırakmamalı. → Task 5'te "kapanışta yetim süreç yok" testi.
3. **Büyük yükler köprüden geçiyor** (8 MB'lık bir PDF metni, 4 görsel): ikili veri JSON'a gömülmemeli, sınır aşımı açık hata vermeli. → Task 4 sınır testi.
4. **Türkçe karakterli yollar ve içerik** (`C:\Users\Çağrı\…`, "Şubat raporu.pdf"): dialog → çekirdek → dosya akışında bozulmamalı. → Task 6 testi.
5. **Electron'da kaydedilmiş bir API anahtarı Tauri'de açılıyor ve tersi:** iki kabuk arasında gidip gelince anahtar kaybolmamalı. → Task 6 gizli anahtar testi.

---

## Dosya yapısı

| Dosya | Sorumluluk |
|---|---|
| `app/core.cjs` (yeni) | `main.cjs`'teki bütün iş mantığı ve kanal işleyicileri; Electron'a `require` yapmaz |
| `app/platform.cjs` (yeni) | `platform` sözleşmesi: metod adları listesi + `assertPlatform(p)` |
| `app/shell-electron.cjs` (yeni) | Electron penceresi, protokoller, `ipcMain` kaydı, Electron `platform` uygulaması |
| `app/main.cjs` | Tek satır: `require('./shell-electron.cjs')` |
| `app/core-host.cjs` (yeni) | Tauri'de `node.exe` giriş noktası: NDJSON RPC, `rpc` platform uygulaması |
| `app/webproxy.cjs` (yeni) | Tarayıcı paneli için filtreleyen yerel HTTP/CONNECT proxy |
| `app/testhook.cjs` (yeni, repoda) | Kayıp `ui-check.cjs`'in yerine: test modunda dosya seçimi ve mock adres override'ları |
| `app/bridge-tauri.js` (yeni) | Tauri'de `window.lumen`'i `preload.cjs` ile aynı imzayla tanımlar |
| `shell-tauri/` (yeni Cargo projesi) | `src/main.rs`, `core.rs` (yardımcı süreç + RPC), `protocol.rs` (`lumen`, `lumen-artifact`), `platform/{dialog,clipboard,image,secrets,opener}.rs`, `browser.rs` (panel + gizli işleyici), `artifact.rs`, `capabilities/main.json`, `tauri.conf.json` |
| `tests/harness/` (yeni) | `cdp.mjs` (CDP istemcisi), `launch.mjs` (Electron veya Tauri'yi test verisiyle başlatır), `fixtures/` |
| `tests/core/*.test.mjs` | Node'un yerleşik `node:test`'i ile çekirdek ve proxy testleri |
| `tests/ui/*.test.mjs` | CDP üzerinden iki kabukta çalışan senaryolar (`LUMEN_SHELL=electron|tauri`) |
| `scripts/build-tauri.ps1` (yeni) | `cargo tauri build` + `app/` + `backend/` + sabitlenmiş `node.exe` → `work/tauri-build/` |

---

### Task 1: Araç zinciri ve Electron referans ölçümü

**Files:**
- Create: `tests/harness/measure.mjs`
- Output: `work/measure/electron-baseline.json`

**Interfaces:**
- Produces: `measure({exe, args, dataDir}) -> {startupMs, idleRssMB, folderMB}` (Task 11 de kullanır)

- [ ] **Step 1: Onay al.** Kullanıcıya kurulacakları yaz: rustup (stable-x86_64-pc-windows-msvc), Visual Studio 2022 Build Tools "Desktop development with C++" iş yükü (yaklaşık 6–8 GB). Onay gelmeden devam etme.
- [ ] **Step 2: Kur ve doğrula.** Run: `rustc --version; cargo --version; cargo install tauri-cli --version <sabit> --locked`. Expected: üçü de sürüm yazar.
- [ ] **Step 3: Dal aç.** Run: `git switch -c tauri-shell`. Expected: `Switched to a new branch 'tauri-shell'`.
- [ ] **Step 4: Electron geliştirme klasörü.** Run: `.\scripts\build-portable.ps1 -Out ..\work\electron-dev`. Expected: `work/electron-dev/lumen.cpp.exe` var.
- [ ] **Step 5: `measure.mjs`'i yaz.** Açılış süresi = süreç başlangıcından ana pencerede `document.readyState==='complete'` olana kadar (CDP ile). Boştaki RSS = açılıştan 30 sn sonra kabuğun tüm alt süreçlerinin toplamı (`lumen-host` ve `llama-server` **hariç**). 5 koşu, medyan.
- [ ] **Step 6: Ölç.** Run: `node tests/harness/measure.mjs --shell electron --out ../work/measure/electron-baseline.json`. Expected: dosya üç alanı da içerir.

### Task 2: CDP test altyapısı ve duman testleri (bugünkü Electron'a karşı)

Bu görev Task 3'teki bölmeden **önce** yapılır; bölmenin davranışı değiştirmediğini bu testler kanıtlar.

**Files:**
- Create: `tests/harness/cdp.mjs`, `tests/harness/launch.mjs`, `app/testhook.cjs`, `tests/ui/smoke.test.mjs`
- Modify: `app/main.cjs:623` (`ui-check.cjs` yerine `testhook.cjs`; hook bulunamazsa test modu hata verir)
- Modify: `.gitignore` (`app/ui-check.cjs` satırı kalır, `testhook.cjs` girmez)

**Interfaces:**
- Produces:
  - `connect(port) -> {evaluate(expr), click(selector), type(selector,text), waitFor(expr, ms), screenshot(path), close()}`
  - `launch({shell:'electron'|'tauri', dataDir, port, env}) -> {cdp, process, stop()}`. Test modunda kabuğa `--ui-check --test-data=<dir> --remote-debugging-port=<port>` geçer.
  - `testhook.cjs`: `install({platform, env})`. `LUMEN_TEST_FILES` (JSON yol dizisi) varsa dosya dialog'larını atlar; mevcut `LUMEN_UPDATE_API`, `LUMEN_UPDATE_KEY`, `LUMEN_IMPORT_HOME` override'ları yalnızca test modunda etkin kalır.

- [ ] **Step 1: Duman testini yaz** (`tests/ui/smoke.test.mjs`, `LUMEN_SHELL` ortam değişkenine göre kabuk seçer):
  - `opens`: `document.querySelector('#composer')` var, konsolda hata yok.
  - `chat streams and cancels`: hard link'lenmiş Gemma 4 E2B ile "Merhaba" gönder; 60 sn içinde asistan mesajında ≥1 karakter; ikinci mesajda 1 sn sonra iptal → mesaj `Interrupted`.
  - `persists`: uygulamayı kapat-aç; iki mesaj hâlâ listede.
  - `language`: Ayarlar → dil TR; `#composer` placeholder Türkçe metin içerir.
  - `800x600`: pencere 800×600; `document.documentElement.scrollWidth <= 800`.
- [ ] **Step 2: Çalıştır, düştüğünü gör.** Run: `$env:LUMEN_SHELL='electron'; node --test tests/ui/smoke.test.mjs`. Expected: FAIL (`launch` tanımlı değil).
- [ ] **Step 3: `cdp.mjs`, `launch.mjs`, `testhook.cjs`'i yaz.** `launch` önce `app/`'ı `work/electron-dev/resources/app`'a eşitler (`robocopy /MIR`, `backend\*.exe` ve `backend\engines` hariç tutulur).
- [ ] **Step 4: Çalıştır.** Expected: 5/5 PASS. `language` testi, kullanıcının ekran görüntüsünde görülen İngilizce placeholder hatasını ("Ask anything. Keep it local.") yakalarsa **düzeltme bu görevde yapılmaz**; test `todo` olarak işaretlenir ve kullanıcıya raporlanır.
- [ ] **Step 5: Commit (onaydan sonra).** `git add tests app/testhook.cjs app/main.cjs; git commit -m "Test harness over CDP; smoke tests"`

### Task 3: Çekirdeği Electron'dan ayırma

**Files:**
- Create: `app/platform.cjs`, `app/core.cjs`, `app/shell-electron.cjs`, `tests/core/core-isolation.test.mjs`
- Modify: `app/main.cjs` (tamamı), `app/browser.cjs` (Electron'a dokunan kısım `platform.browser`'a), `app/artifacts.cjs` (`platform.artifact`'a), `app/photos.cjs:9` ve görsel URL'si üreten yer (`platform.assetBase`), `app/connections.cjs`, `app/toolsettings.cjs` (`safeStorage` yerine `platform.secrets`)

**Interfaces:**
- Produces (`platform.cjs` sözleşmesi; hepsi async döner, Electron'daki eşdeğerinin girdi/çıktısıyla aynı):
  - `send(channel, payload)`, `windowAction('minimize'|'maximize'|'close')`
  - `dialog.open(opts) -> {canceled, filePaths}`, `dialog.save(opts) -> {canceled, filePath}`, `dialog.message(opts) -> {response}`
  - `clipboard.writeText(text)`, `clipboard.writePng(path)`, `clipboard.read() -> [{type:'text'|'image', text?|pngPath?}]`
  - `image.decodeWebp(buffer) -> pngBuffer`, `image.thumbnail(pngPath, maxSide) -> pngBuffer`
  - `secrets.available() -> bool`, `secrets.encrypt(text) -> base64`, `secrets.decrypt(base64) -> text`
  - `openExternal(url)`, `assetBase: string`, `appDir: string`, `updateMode: 'full'|'check-only'`
  - `browser.*`: `browser.cjs`'in bugün `WebContentsView`/`BrowserWindow` üzerinde yaptığı her işlem için bir metod (`show(bounds)`, `hide()`, `navigate(url)`, `back()`, `forward()`, `reload()`, `stop()`, `find(text, opts)`, `stopFind()`, `evalIsolated(script) -> value`, `input(event)`, `close()`, `render(url, {signal}) -> {title, text}`), ayrıca olaylar `onNavigate`, `onPopup`, `onState`
  - `artifact.open(html, kind)`, `artifact.close()`
- Produces (`core.cjs`): `createCore({platform, dataDir, test}) -> {channels: string[], call(channel, args: any[]) -> Promise<any>, start(), stop()}`. `channels`, `preload.cjs`'teki invoke kanallarıyla birebir aynıdır. `start()` `core.lock`'u alır (spec §7), `lumen-host`'u başlatır.

- [ ] **Step 1: Yalıtım testini yaz** (`tests/core/core-isolation.test.mjs`):
  - `does not load electron`: `Module._load` sarılır; `require('../../app/core.cjs')` + `createCore` sahte platformla; `electron` istenirse test düşer.
  - `channels match preload`: `preload.cjs` metninden çıkarılan kanal listesi `core.channels` ile eşit.
  - `assertPlatform rejects missing methods`: eksik `dialog.save` → `Error('platform.dialog.save missing')`.
  - `core.lock`: ikinci `start()` aynı veri klasöründe `Error` verir; PID ölü kilit dosyası varsa devralınır.
  - `asset urls use platform base`: `assetBase='http://lumen.localhost/'` iken `photos` dekorasyonu `http://lumen.localhost/photo/<id>.png` döner.
- [ ] **Step 2: Çalıştır, düştüğünü gör.** Run: `node --test tests/core/`. Expected: FAIL (`core.cjs` yok).
- [ ] **Step 3: Böl.** `main.cjs:1-626`'daki işleyiciler `core.cjs`'e taşınır; her `ipcMain.handle('<kanal>', (event,...a)=>{sender(event); …})` gövdesi `call('<kanal>', a)` dalı olur. `sender` kontrolü kabukta kalır. `decodeWebp`'in `executeJavaScript` yolu `platform.image.decodeWebp`'e taşınır (Electron uygulaması aynı betiği kullanmaya devam eder).
- [ ] **Step 4: Çekirdek testleri.** Run: `node --test tests/core/`. Expected: PASS.
- [ ] **Step 5: Duman testleri (Electron).** Run: `$env:LUMEN_SHELL='electron'; node --test tests/ui/smoke.test.mjs`. Expected: Task 2'deki sonuçla aynı.
- [ ] **Step 6: Commit (onaydan sonra).** `git commit -m "Split Electron-free core from the Electron shell"`

### Task 4: Çekirdek sunucusu (stdio RPC)

**Files:**
- Create: `app/core-host.cjs`, `tests/core/core-host.test.mjs`

**Interfaces:**
- Consumes: `createCore`, `platform.cjs` sözleşmesi (Task 3)
- Produces: Çalıştırma `node core-host.cjs --data <dir> --app <dir> [--ui-check]`. stdin/stdout'ta satır başına bir JSON:
  - Kabuk → çekirdek: `{id, type:'call', channel, args}`, `{type:'shutdown'}`, `{id, type:'platform-result', ok, value|error}`
  - Çekirdek → kabuk: `{type:'ready', channels}`, `{id, type:'result', ok, value|error}`, `{type:'event', channel, payload}`, `{id, type:'platform', method, args}`
  - Satır üst sınırı 64 MiB; aşılırsa `{type:'protocol-error', reason:'too-large'}` ve satır atılır. İkili veri her zaman dosya yolu olarak taşınır.

- [ ] **Step 1: Testleri yaz** (sahte bir kabuk çekirdeği alt süreç olarak başlatır):
  - `ready lists channels`, `call returns result` (`preferences` okuma), `unknown channel → ok:false`, `platform round-trip` (çekirdek `dialog.open` ister, sahte kabuk yanıtlar), `events are forwarded` (`engine-event`), `too-large line rejected`, `shutdown exits within 5 s and stops lumen-host`, `exception in a handler → ok:false, process stays up`.
- [ ] **Step 2: Düştüğünü gör.** Run: `node --test tests/core/core-host.test.mjs`. Expected: FAIL.
- [ ] **Step 3: `core-host.cjs`'i yaz.** `platform` her metodu bir `platform` mesajına çeviren vekil nesnedir (`assetBase`, `appDir`, `updateMode` komut satırından gelir).
- [ ] **Step 4: Geçtiğini gör.** Expected: 8/8 PASS.
- [ ] **Step 5: Commit (onaydan sonra).**

### Task 5: Tauri kabuğu, köprü ve ana pencere

**Files:**
- Create: `shell-tauri/` (`Cargo.toml`, `tauri.conf.json`, `capabilities/main.json`, `src/main.rs`, `src/core.rs`, `src/protocol.rs`, `src/window.rs`), `app/bridge-tauri.js`, `scripts/build-tauri.ps1`
- Modify: `tests/harness/launch.mjs` (`shell:'tauri'`)

**Interfaces:**
- Consumes: `core-host.cjs` protokolü (Task 4)
- Produces:
  - Tauri komutları: `lumen_call(channel: String, args: Vec<Value>) -> Result<Value, String>`, `window_action(action: String)`. Olay: `lumen-event` `{channel, payload}`. Yalnızca `main` etiketli webview'e izinli.
  - `bridge-tauri.js`: `window.lumen`, `preload.cjs`'teki her anahtarı aynı imzayla sunar; `onChannel` aynı allowlist'i uygular.
  - `protocol.rs`: `lumen` → `app/` klasörü. Yol `..`, mutlak yol ya da sürücü harfi içeriyorsa 403. `generated/`, `photo/`, `photo-thumb/` rotaları çekirdekten gelen kökten servis edilir.

- [ ] **Step 1: Rust birim testleri:** `protocol::resolve` → `..%2f`, `C:/`, `\\?\` için 403; `index.html` için `app/index.html`. `core::Frame` serde gidiş-dönüşü.
- [ ] **Step 2: Düştüğünü gör.** Run: `cargo test --manifest-path shell-tauri/Cargo.toml`. Expected: FAIL.
- [ ] **Step 3: Kabuğu yaz.**
  - `decorations(false)`, min 780×580 (bugünkü değerler), `on_navigation` yalnızca `http://lumen.localhost/`.
  - `with_webview` ile `PermissionRequested` → reddet; `NewWindowRequested` → reddet; `ProcessFailed` → `<data>/renderer.log`.
  - Çekirdek bir Job Object'e (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) bağlanır. `ready` 20 sn içinde gelmezse ya da süreç ölürse `fatal` olayı gönderilir ve bir kez yeniden başlatılır.
  - Çıkışta önce `shutdown`, 5 sn sonra sonlandırma.
  - `--remote-debugging-port` yalnızca `cfg(feature="ui-check")` + `--ui-check` birlikteyken eklenir.
  - Tek örnek: `tauri-plugin-single-instance`; ikinci açılış mevcut pencereyi öne getirir.
  - Başlık çubuğu sürükleme: `bridge-tauri.js`, bugünkü başlık öğesinde `mousedown` → `getCurrentWindow().startDragging()`; çift tıklama büyütür. Arayüz dosyaları değişmez.
  - `build-tauri.ps1`, resmi Node 22 LTS `node.exe`'yi indirir, SHA-256'sını `scripts/node-manifest.json`'daki sabit değerle doğrular ve `binaries/node-x86_64-pc-windows-msvc.exe` olarak koyar.
- [ ] **Step 4: Rust testleri geçer.** Expected: PASS.
- [ ] **Step 5: Duman testleri (Tauri).** Run: `.\scripts\build-tauri.ps1 -Features ui-check; $env:LUMEN_SHELL='tauri'; node --test tests/ui/smoke.test.mjs`. Expected: 5/5 PASS (ya da Electron'la aynı `todo`).
- [ ] **Step 6: Yetim süreç testi** (`tests/ui/lifecycle.test.mjs`, iki kabuk): yanıt akarken pencereyi kapat; 10 sn sonra `node.exe`, `lumen-host.exe` ve `llama-server.exe`'den test veri klasörüne ait hiçbiri çalışmıyor. Çekirdeği zorla sonlandır → arayüzde `fatal` bildirimi, ardından yeniden bağlanma.
- [ ] **Step 7: Commit (onaydan sonra).**

### Task 6: Platform hizmetleri (Rust)

**Files:**
- Create: `shell-tauri/src/platform/{mod,dialog,clipboard,image,secrets,opener}.rs`, `tests/ui/platform.test.mjs`, `tests/fixtures/electron-secret.mjs` (Electron'da `ELECTRON_RUN_AS_NODE` olmadan çalışıp test veri klasöründe `safeStorage` ile bilinen bir değer şifreleyen betik)

**Interfaces:**
- Consumes: `platform` mesajları (Task 4), metod adları `platform.cjs`'ten (Task 3)
- Produces: Rust'ta her `platform` metodunun işleyicisi. `secrets` Electron `os_crypt` biçimini okur ve yazar: `Local State` → `os_crypt.encrypted_key` (base64, `DPAPI` öneki) → `CryptUnprotectData` → 32 bayt anahtar; değer = `v10` + 12 bayt nonce + AES-256-GCM şifreli metin + etiket. `Local State` yoksa aynı biçimde oluşturulur. `Local State` yolu: Electron'un `userData`'sı (`%APPDATA%\lumen.cpp`; test modunda `<test-data>/electron-userdata`).

- [ ] **Step 1: Testleri yaz.**
  - Rust: `secrets_roundtrip`; `decrypts_electron_fixture` (fixture betiğinin ürettiği değer); `webp_to_png` (fixture `tests/fixtures/sample.webp` → PNG, boyut aynı); `thumbnail_max_side_512`.
  - UI (iki kabuk): `copy text` (pano metni = yanıt); `copy generated image` (panoda görsel var, boyut doğru); `attach document with Turkish path` (`LUMEN_TEST_FILES=["…\\Şubat raporu.pdf"]` → belge çipi doğru adla görünür); `export chat` (kaydetme dialog'u test kancasıyla); `secret survives shell switch` (Electron'da Tavily anahtarı kaydet → Tauri'de Ayarlar "kayıtlı" der → Tauri'de değiştir → Electron'da açılır).
- [ ] **Step 2: Düştüğünü gör.** Run: `cargo test …; node --test tests/ui/platform.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Uygula.** Dialog: `tauri-plugin-dialog`. Pano: `arboard` (PNG → RGBA, `image` crate). Dış bağlantı: `tauri-plugin-opener`, yalnızca `https:`.
- [ ] **Step 4: Geçtiğini gör.** Expected: hepsi PASS. `decrypts_electron_fixture` düşerse spec §7 yedek planı devreye girer: **dur ve kullanıcıya raporla.**
- [ ] **Step 5: Commit (onaydan sonra).**

### Task 7: Önizleme penceresi

**Files:**
- Create: `shell-tauri/src/artifact.rs`, `tests/ui/artifact.test.mjs`

**Interfaces:**
- Consumes: `platform.artifact.open(html, kind)`, `artifacts.cjs`'teki `CSP` ve `documentFor` (Task 3)
- Produces: `artifact` etiketli `WebviewWindow`: `incognito(true)`, ayrı `data_directory` (`<data>/webview/artifact`), `lumen-artifact` protokolü yanıtlarına `CSP` başlığı, köprü betiği yok, komut izni yok. WebView2 `AddWebResourceRequestedFilter("*")`: `http://lumen-artifact.localhost/` dışındaki her isteğe 403.

- [ ] **Step 1: Testleri yaz** (iki kabuk): HTML önizleme açılır ve beyaz zeminde içerik görünür; sayfa içi `fetch('https://example.com')` başarısız; `<img src="https://…">` yüklenmez; `typeof window.lumen === 'undefined'`; ikinci önizleme aynı pencereyi yeniden kullanır; ana pencereden gezinme yok.
- [ ] **Step 2–4:** düşür → uygula → geçir.
- [ ] **Step 5: Commit (onaydan sonra).**

### Task 8: Filtreleyen proxy

**Files:**
- Create: `app/webproxy.cjs`, `tests/core/webproxy.test.mjs`
- Modify: `app/web.cjs` (adres/DNS kontrolü dışa açılır; davranış değişmez)

**Interfaces:**
- Consumes: `web.cjs`'teki mevcut özel adres ve DNS kontrolleri (fonksiyon adı bu görevde dışa açılır: `checkHost(host) -> Promise<void>` hata fırlatarak reddeder)
- Produces: `startProxy({resolver?}) -> {url: 'http://user:token@127.0.0.1:<port>', stop()}`. HTTP ve CONNECT destekler. Kimlik doğrulaması olmayan istek → 407. Reddedilen hedef → HTTP için 403 sayfası, CONNECT için 403.

- [ ] **Step 1: Testleri yaz:** `rejects 127.0.0.1`, `rejects 192.168.1.1`, `rejects 10.x and ::1 and fc00::`, `rejects DNS that resolves to private` (sahte resolver), `rejects DNS rebinding` (ilk sorgu genel, bağlanırken özel → bağlantı kurulmaz; kontrol bağlanılan IP üzerinde yapılır), `allows public via CONNECT` (yerel sahte TLS sunucusu, resolver genel IP döndürür), `requires auth`, `binds only loopback`.
- [ ] **Step 2–4:** düşür → uygula → geçir.
- [ ] **Step 5: Commit (onaydan sonra).**

### Task 9: Tarayıcı paneli ve gizli işleyici (Tauri)

**Files:**
- Create: `shell-tauri/src/browser.rs`, `tests/ui/browser.test.mjs`
- Modify: `shell-tauri/Cargo.toml` (`tauri` `features=["unstable"]`)

**Interfaces:**
- Consumes: `platform.browser.*` (Task 3), `startProxy` (Task 8; çekirdek proxy adresini `browser.show` çağrısında verir)
- Produces: `browser` etiketli alt webview (`Window::add_child`), gizli `render` `WebviewWindow`. İkisi de: ayrı `data_directory` (`<data>/webview/browser`), `proxy_url`, köprü yok, komut izni yok, `on_download → false`, `on_new_window` → `onPopup` olayı + ret. `evalIsolated`, `input`, `find` ve başlıklar spec §6.0'daki CDP metodlarıyla (`CallDevToolsProtocolMethod`).

- [ ] **Step 1: Testleri yaz** (iki kabuk; yerel test sunucusu genel IP gibi gösterilemeyeceği için sunucu `LUMEN_TEST_ALLOW_HOST` ile yalnızca test modunda izinlidir):
  - `navigates and reports state` (başlık, geri/ileri).
  - `blocks private address` (`http://192.168.1.1/` → engel sayfası; sunucuya istek **ulaşmaz**).
  - `blocks private subresource` (izinli sayfa içinden `http://127.0.0.1:<başka port>/x.png` → o sunucuya istek ulaşmaz).
  - `isolated read resists tampering` (sayfa `Object.defineProperty(HTMLElement.prototype,'innerText',…)` ile metni değiştirir; ajanın okuduğu metin gerçek metin).
  - `click and find` (gerçek tıklama sayacı artırır; bul 3 eşleşme).
  - `privacy headers` (`Sec-GPC: 1` ve `DNT: 1` HTTPS isteğinde sunucuya ulaşır; ayar kapalıyken ulaşmaz).
  - `download denied`, `popup goes to panel`, `research renders a JS page` (ajan araştırması gizli işleyiciyle JS'li sayfanın metnini alır).
- [ ] **Step 2–4:** düşür → uygula → geçir. `add_child` sürümü sabitken çözülemeyen bir hata çıkarsa spec §6.1 yedek planına (sahipli ayrı pencere) geçmeden önce **dur ve kullanıcıya raporla.**
- [ ] **Step 5: Commit (onaydan sonra).**

### Task 10: Güncelleme yalnızca denetim modu

**Files:**
- Modify: `app/updates.cjs` (`createUpdater` `mode` alır), `app/updates.js` (not metni), `app/core.cjs` (`platform.updateMode`, `platform.appDir`)
- Create: `tests/core/updates-mode.test.mjs`

**Interfaces:**
- Consumes: `platform.updateMode`, `platform.appDir` (Task 3)
- Produces: `createUpdater({…, mode:'full'|'check-only'})`. `check-only`'de `download` ve `install` `Error('This preview build cannot install updates.')` verir; `status()` `{mode:'check-only'}` içerir. Arayüz notu: EN "This preview build can't install updates." / TR "Bu önizleme sürümü güncellenemez."

- [ ] **Step 1: Testleri yaz:** `check works in check-only` (yerel sunucu + test anahtarı, CLAUDE.md §10b'deki gibi), `download rejected`, `install rejected`, `full mode unchanged`.
- [ ] **Step 2–4:** düşür → uygula → geçir; Tauri UI'da Ayarlar → Genel → Güncellemeler notu TR/EN görünür (smoke'a ek bir adım).
- [ ] **Step 5: Commit (onaydan sonra).**

### Task 11: Tam senaryo seti, ölçüm ve belgeler

**Files:**
- Create: `tests/ui/{models,download,research,documents,images,mcp,localapi,settings,layout}.test.mjs`
- Modify: `docs/MEASUREMENTS.md`, `Lumen WF/CLAUDE.md` (yeni mimari, testlerin yeri, açık işler), `README.md` (geliştirici bölümü)

**Interfaces:**
- Consumes: hepsi.

- [ ] **Step 1: Senaryoları yaz** (spec §8 listesi; mock'lar CLAUDE.md'deki eski testlerle aynı yaklaşım: yerel indirme sunucusu, mock MCP, mock bulut, mock görsel motoru; gerçek model yalnızca sohbet ve araştırmada).
- [ ] **Step 2: İki kabukta koş.** Run: `foreach($s in 'electron','tauri'){ $env:LUMEN_SHELL=$s; node --test tests/ui/ }`. Expected: iki kabukta aynı sonuç; farklar `work/reports/parity.md`'ye yazılır.
- [ ] **Step 3: Ölç.** Run: `node tests/harness/measure.mjs --shell tauri --out ../work/measure/tauri.json`. Expected: Electron referansıyla karşılaştırma tablosu `docs/MEASUREMENTS.md`'ye eklenir. Kazanç yoksa "kazanç yok" yazılır.
- [ ] **Step 4: Belgeleri güncelle.** CLAUDE.md'de: neyin gerçek entegrasyonla, neyin mock ile doğrulandığı ayrı ayrı; doğrulanmayanlar açıkça.
- [ ] **Step 5: Commit (onaydan sonra).** Push yalnızca ayrıca onayla.
