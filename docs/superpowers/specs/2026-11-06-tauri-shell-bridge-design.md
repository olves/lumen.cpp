# Tauri kabuğu ve Node köprüsü — tasarım (Proje 1/3)

Tarih: 6 Kasım 2026 · Durum: taslak, kullanıcı onayı bekliyor · Kod tabanı: v1.0.5-beta (build 5), commit `4b61155`

## 1. Amaç ve neden

Lumen'i Electron'dan Rust tabanlı **Tauri 2** kabuğuna taşımaya başlamak. Kullanıcı, Beta dönemindeyken Rust'ı gerçek kodla denemek istiyor. Tam yeniden yazım yerine **Tauri + Node köprüsü** yolunu seçti: Tauri penceresi arayüzü WebView2 içinde çalıştırır, mevcut Node modülleri yardımcı süreçte yaşamaya devam eder, sonra modüller zamanla Rust'a taşınır.

Bu belge üç projeden **ilkini** kapsar:

1. **Köprü ve Tauri kabuğu (bu belge):** Lumen, mevcut arayüzle birlikte Tauri'de çalışır, Electron yapısı da çalışmaya devam eder.
2. Yeni arayüz: birleşik tasarım, token tabanlı renk/yazı tipi özelleştirmesi, isteğe bağlı durum çubuğu. Ayrı belge.
3. Modüllerin Rust'a taşınması ve Electron → Tauri güncelleme yolu. Ayrı belge.

Sıranın gerekçesi: bilinmeyenlerin çoğu bu projede. Tarayıcı panelinin yalıtımı, önizleme güvenliği, gizli anahtarlar ve yardımcı süreç yönetimi önce çözülmeli. Yeni arayüz kanıtlanmış bir köprünün üstüne kurulur ve iki kabukta da aynı şekilde çalışır.

## 2. Hedefler, hedef dışı, anti-hedefler

**Hedefler**
- Tauri kabuğunda Lumen'in bugünkü özelliklerinin tamamı çalışır: sohbet, modeller, indirme, ajan/araştırma, tarayıcı paneli, belgeler, görseller, MCP, yerel API, önizleme, ayarlar, güncelleme denetimi. Ölçüt §9'da.
- Electron yapısı aynı kaynaktan çalışmaya devam eder. Tauri sürümü eşdeğerliği kanıtlayana kadar yayın aracı Electron'dur.
- Arayüz (`index.html` + renderer modülleri) iki kabukta **değişmeden** çalışır. Fark yalnızca `window.lumen` köprüsünün altındadır.
- Electron ile Tauri arasında **ölçülmüş** karşılaştırma: boştaki RAM, açılış süresi, paket boyutu.

**Hedef dışı (bu projede yok)**
- Arayüz yeniden tasarımı (Proje 2).
- İş mantığının Rust'a taşınması (Proje 3). Rust yalnızca kabuk, köprü ve Electron'un sağladığı platform hizmetlerini üstlenir.
- Mevcut kullanıcıların Electron'dan Tauri'ye otomatik geçişi ve bunun için bir sürüm (Proje 3).
- Release, imzalama, GitHub yayını. Sürüm numarası değişmez.
- macOS/Linux.

**Anti-hedefler (çalışsa bile başarısızlık sayılır)**
- Electron yapısının bozulması veya davranışının değişmesi.
- Bugünkü güvenlik özelliklerinden herhangi birinin zayıflaması (§6).
- Kullanıcı verisinin değişmesi, kaybolması veya iki kabuk arasında uyumsuz hâle gelmesi. Kayıtlı API anahtarlarının okunamaz olması da buna dahil.
- Üretim yapısında uzaktan hata ayıklama portunun açık kalması.

## 3. Bugünkü durum (incelendi)

- **Bağımlılık yok:** `app/package.json` yalnızca ad/sürüm/build içeriyor, npm bağımlılığı yok. Kütüphaneler `vendor/` altında.
- **Köprü yüzeyi küçük ve düzenli:** `preload.cjs`, `window.lumen` altında yaklaşık 34 `invoke` kanalı, 1 `send` (`window`) ve 10 olay kanalı sunuyor. Olay kanalları allowlist ile korunuyor: `engine-event`, `agent-event`, `browser-event`, `download-event`, `models-meta`, `update-event`, `engine-update-event`, `import-event`, `document-event`, `image-event`.
- **Electron'a bağımlılık iki dosyada toplanmış:**
  - `main.cjs` (92 KB): `app, BrowserWindow, ipcMain, dialog, session, protocol, clipboard, nativeImage, safeStorage`, `shell.openExternal`, `ClipboardItem`.
  - `browser.cjs`: `BrowserWindow` (gizli işleyici), `WebContentsView` (panel), `session.fromPartition` + `webRequest.onBeforeRequest`, `shell`.
  - Ayrıca `artifacts.cjs` (`protocol.handle`, ayrı partition, `webRequest`), `connections.cjs` ve `toolsettings.cjs` (`safeStorage`) Electron nesnelerini parametre olarak alıyor.
  - Kalan modüller (`agent`, `web`, `downloader`, `mcp`, `apiserver`, `cloud`, `documents`, `imagegen`, `plugins`, `updates`, `engine`…) saf Node.
- **Arayüz** `lumen://app/` özel protokolünden yükleniyor, göreli yollar kullanıyor.
- **Veri klasörü:** `%LOCALAPPDATA%\lumen.cpp` (`main.cjs:5`). Electron'un kendi `userData` klasörü ise varsayılan `%APPDATA%\lumen.cpp`. `safeStorage`'ın şifreleme anahtarı oradaki `Local State` dosyasında duruyor (Chromium `os_crypt`).
- **WebP çözme** renderer'da `executeJavaScript` + `createImageBitmap` ile yapılıyor (`main.cjs` `decodeWebp`).
- **Motor süreci:** `backend/lumen-host.exe --bridge <data>` main'den başlatılıyor, stdio üzerinden konuşuyor. Kabuktan bağımsız, değişmeden kalır.
- **Testler kayıp:** CLAUDE.md'deki test betikleri (`work/test-*.cjs|mjs`, `run-*.ps1`) ve test kancası `app/ui-check.cjs` diskte yok. `ui-check.cjs` `.gitignore`'da, `work/` repo dışındaydı. Kullanıcı klasörlerinde aranınca da bulunamadılar. UI test altyapısının yeniden kurulması bu projenin parçasıdır (§8).
- **Araç zinciri:** Rust (`rustup/cargo`) ve MSVC C++ Build Tools kurulu değil. WebView2 Runtime 156 kurulu. Node 22.23 kurulu (kullanıcının kendi Node'u, paketlenmez).
- **Boyut referansı:** Electron dağıtımında `lumen.cpp.exe` 245 MB, Chromium dosyalarıyla birlikte yaklaşık 330 MB çalışma zamanı.

## 4. Yaklaşımlar

| | Yaklaşım | Artı | Eksi |
|---|---|---|---|
| **A (seçildi)** | Tauri kabuğu + Node yardımcı süreci, sonra parça parça Rust | Kısa sürede çalışan sürüm; her adım test edilebilir; Electron güvenlik ağı olarak kalır; arayüz bir kez yazılır | Bir süre iki çalışma zamanı (Rust + Node); `node.exe` (~80 MB) paketlenir |
| B | Her şeyi baştan Rust'ta yazmak | En temiz ve en hafif son durum | Aylarca sürüm yok; test edilmiş her davranış yeniden doğrulanmalı; Beta'da en riskli yol |
| C | Önce yeni arayüzü Electron'da yayınlamak, Tauri sonra | En düşük risk, kullanıcı yeni arayüzü erken görür | Rust deneyimi gecikir; kullanıcının "Beta'da deneyelim" isteğini karşılamaz |

Kullanıcı A'yı seçti (6 Kasım).

## 5. Mimari

```
lumen.exe (Tauri / Rust)
 ├─ ana pencere: WebView2  ── http://lumen.localhost/  (arayüz, değişmeden)
 │     window.lumen  ──invoke('lumen_call')──►  Rust köprü  ──stdio JSON──►  lumen-core (node.exe)
 │     ◄── Tauri olayı 'lumen-event' ───────────  Rust köprü  ◄── olay mesajı ──  lumen-core
 ├─ tarayıcı paneli: alt WebView2 (ayrı veri klasörü, filtreleyen proxy üzerinden)
 ├─ gizli işleyici: gizli WebviewWindow (aynı proxy)
 ├─ önizleme: ayrı WebviewWindow (lumen-artifact protokolü, incognito)
 └─ platform hizmetleri (Rust): pencere, dialog, pano, gizli anahtar (DPAPI), görsel çözme, dış bağlantı

lumen-core (node.exe + mevcut .cjs modülleri, Electron'suz)
 ├─ iş mantığı: agent, web, downloader, mcp, apiserver, cloud, documents, imagegen, plugins, updates, engine…
 ├─ platform arayüzü (platform.cjs) ── Electron'da doğrudan Electron API'si, Tauri'de Rust'a geri çağrı
 └─ lumen-host.exe (değişmez)
```

### 5.1 Çekirdeğin Electron'dan ayrılması (önce Electron'da yapılır)
- `main.cjs` ikiye bölünür:
  - **`core.cjs`:** bütün IPC işleyicileri ve iş mantığı, Electron'a hiç `require` yapmaz.
  - **`shell-electron.cjs`:** pencere, protokol, preload, `ipcMain` kaydı ve `platform` uygulaması.
- **`platform` arayüzü** (yalnızca bugün kullanılanlar):
  - pencere: `send(channel, payload)` ve pencere eylemleri (küçült, büyüt, kapat)
  - dialog: `showOpenDialog`, `showSaveDialog`, `showMessageBox`
  - pano: `clipboardWriteText`, `clipboardWriteImage(pngPath)`, `clipboardRead()`
  - görsel: `decodeWebp(buffer)`, küçük resim üretme (bugün `nativeImage`)
  - gizli anahtar: `secretEncrypt`, `secretDecrypt`, `secretAvailable` (bugün `safeStorage`)
  - `openExternal(url)`
  - `assetBase`: arayüzün varlık adresi kökü. Electron'da `lumen://app/`, Tauri'de `http://lumen.localhost/`. *(Benim kararım)* `photos.cjs` ve görsel modülü `lumen://app/photo/…` gibi adresleri dekorasyon anında üretiyor, diske yazmıyor. Bu yüzden sabit yerine `platform.assetBase` kullanmaları yeterli; kayıtlı veri değişmez.
  - tarayıcı paneli ve gizli işleyici denetimi (`browser.cjs`'in Electron'a dokunan kısmı)
  - önizleme penceresi (`artifacts.cjs`'in Electron'a dokunan kısmı)
- Bu adımın sonunda Electron yapısı **davranış değişmeden** çalışır. İlk ve ayrı doğrulanan kilometre taşı budur.

### 5.2 Tauri kabuğu
- **Yeni klasör:** `repo/shell-tauri/` (Cargo projesi). Tauri sürümü **tam olarak sabitlenir** (`=2.x.y`), çünkü kullanılan `unstable` özelliği sürümler arasında değişebilir.
- **Ana pencere:**
  - `decorations(false)`; mevcut özel başlık çubuğu çalışır. Sürükleme bölgesi `data-tauri-drag-region` ile, pencere eylemleri köprüden.
  - Arayüz özel `lumen` protokolünden servis edilir (Windows'ta `http://lumen.localhost/`); göreli yollar korunur.
  - `on_navigation` uygulama kökeni dışındaki gezinmeyi reddeder.
  - Yeni pencere açılması engellenir.
  - WebView2 izin istekleri (`PermissionRequested`) reddedilir (bugünkü `setPermissionRequestHandler(false)` karşılığı).
  - `ProcessFailed` olayı loglanır (bugünkü `render-process-gone`).
- **Tek örnek:** `tauri-plugin-single-instance`.
- **Rust'a eklenecek yetenekler:** Tauri izinleri (capabilities) yalnızca ana pencerede `lumen_call` komutuna ve pencere eylemlerine izin verir. `shell`, `fs` ve benzeri eklentiler JS'e **açılmaz**. Yardımcı süreç yalnızca Rust'tan başlatılır.

### 5.3 Köprü protokolü (Rust ↔ lumen-core)
- **Taşıma:** `node.exe`'nin stdin/stdout'unda satır başına bir JSON mesajı. stderr log dosyasına gider.
- **Mesaj tipleri:**
  - `{id, type:'call', channel, action, args}` ve `{id, type:'result', ok, value|error}`
  - `{type:'event', channel, payload}`
  - Çekirdeğin platform hizmeti istemesi için ters yönde: `{id, type:'platform', method, args}` ve yanıtı
- **Sınırlar:** Mesaj başına üst sınır var (öneri 64 MB; büyük ikili veri dosya yolu olarak taşınır). Bilinmeyen kanal reddedilir. Allowlist `preload.cjs` ile aynıdır.
- **Renderer tarafı:** Tauri'de `window.lumen`, bir başlatma betiğiyle (`bridge-tauri.js`) aynı imzayla tanımlanır: `invoke('lumen_call', …)` ve `listen('lumen-event', …)`. Arayüz kodu değişmez.
- **Yaşam döngüsü:**
  - Rust çekirdeği başlatır, `ready` mesajını bekler.
  - Çekirdek çökerse arayüze bugünkü `fatal` olayı gönderilir, bir kez yeniden başlatma denenir.
  - Pencere kapanırken çekirdeğe `shutdown` gönderilir, 5 sn içinde kapanmazsa süreç sonlandırılır.
  - Çekirdek, Windows Job Object ile kabuğa bağlanır; kabuk ölürse çekirdek de ölür. `lumen-host` bugün de Job Object kullanıyor.

### 5.4 Electron özelliklerinin Tauri karşılıkları

| Electron (bugün) | Tauri'de | Not |
|---|---|---|
| `dialog.*` | `tauri-plugin-dialog` (Rust tarafında çağrılır) | TR/EN metinler çekirdekten gelir |
| `clipboard.writeText` / `ClipboardItem` PNG / `clipboard.read` | Rust `arboard` (metin + RGBA görsel) | PNG → RGBA dönüşümü Rust `image` ile |
| `nativeImage` küçük resim, WebP çözme (`executeJavaScript`) | Rust `image` crate | Renderer'a betik enjekte etme hilesi kalkar |
| `safeStorage` | Rust DPAPI (`CryptProtectData`, kullanıcı kapsamı) | Taşıma için §7 |
| `protocol.handle('lumen')` | `register_asynchronous_uri_scheme_protocol('lumen')` | `generated/`, logolar vb. aynı yollar |
| `shell.openExternal` | `tauri-plugin-opener` | Yalnızca https, bugünkü kontrol korunur |
| Tarayıcı paneli `WebContentsView` | `Window::add_child` ile alt webview (**`unstable` özellik**) | §6.1 |
| Gizli işleyici `BrowserWindow{show:false}` | Gizli `WebviewWindow` | Aynı proxy ve gezinme kuralları |
| Önizleme penceresi + `lumen-artifact://` + `webRequest` | Ayrı `WebviewWindow`, `incognito`, ayrı `data_directory`, `lumen-artifact` protokolü + CSP başlığı | Dış istek engeli: CSP + WebView2 `WebResourceRequested` (§6.2) |
| `requestSingleInstanceLock` | `tauri-plugin-single-instance` | |
| Güncelleyici (`updates.cjs` + `LumenUpdater.cs`) | **Aynen kalır** | `tauri-plugin-updater` kullanılmaz; bizim manifest'imiz zaten imzalı |

## 6. Güvenlik (bugünkü özellikler korunur)

1. **IPC kaynağı:** Bugün `event.sender === win.webContents && mainFrame` kontrolü yapılıyor. Tauri'de komutlar yalnızca `main` etiketli webview'e izinli; Rust da çağıranın etiketini kontrol eder. Tarayıcı paneli ve önizleme webview'lerinde hiçbir komut izni yok, köprü betiği de yüklenmez.
2. **Ana pencere:** Dış gezinme yok, yeni pencere yok, izinler reddedilir, CSP bugünküyle aynı.
3. **Tarayıcı paneli ve gizli işleyici:**
   - Ayrı `data_directory` (bugünkü ayrı partition karşılığı).
   - Bugünkü `webRequest` kontrolleri (özel ağ adresleri, DNS ile yeniden bağlama, şema kısıtı) **çekirdekte çalışan yerel bir filtreleyen HTTP proxy'ye** taşınır. Proxy, `web.cjs`'teki mevcut adres/DNS kontrollerini yeniden kullanır. Webview `proxy_url` ile ona bağlanır. Böylece alt kaynaklar ve iframe'ler dahil her istek denetlenir.
   - Proxy yalnızca 127.0.0.1'de, rastgele portta ve rastgele kimlik doğrulamayla dinler. Yalnızca bu webview'ler kullanır.
   - İndirmeler `on_download` ile reddedilir; pop-up'lar `on_new_window` ile panele yönlendirilir (bugünkü davranış).
4. **Önizleme:** Bağlantı, form ve frame yok; inline betiğe izin var (bugünkü CSP). Kalıcı veri yok (`incognito`). Uygulama protokolü dışındaki her istek iptal edilir. Köprü yok, izin yok.
5. **Uzaktan hata ayıklama:** WebView2'nin `--remote-debugging-port` argümanı yalnızca test modunda eklenir. Test modu ancak hem özel bir derleme bayrağı hem de komut satırı bayrağı birlikteyse açılır; üretim yapısında kod yolu yoktur.
6. **Gizli anahtarlar** Rust'ta çözülür ve yalnızca çekirdeğe gider. Renderer'a hiçbir zaman ulaşmaz (bugünkü kural).

### 6.0 Tarayıcı panelinde Electron'la eşdeğerlik *(benim kararım)*
`browser.cjs` dört Electron özelliğine dayanıyor. Bunların WebView2'de doğrudan bir karşılığı yok. Davranış **birebir korunur**; bunun için WebView2'nin süreç içi DevTools kanalı (`CallDevToolsProtocolMethod`) kullanılır. Bu kanal bir ağ portu açmaz, §6.5'teki yasak kapsamına girmez.
- `executeJavaScriptInIsolatedWorld` → `Page.createIsolatedWorld` + `Runtime.evaluate` (contextId ile). Sayfa, ajanın okuma betiğine müdahale edemez. Bu bir güvenlik gereği; sayfanın kendi dünyasında çalıştırmaya **izin yok**.
- `sendInputEvent` → `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`.
- `findInPage` → WebView2 Find API'si (varsa), yoksa yalıtılmış dünyada çalışan bir bulma betiği.
- `Sec-GPC` / `DNT` başlıkları → `Network.setExtraHTTPHeaders`. Bu yol HTTPS'te de çalışır; proxy'nin başlık eklemesi gerekmez.

### 6.1 Risk: çoklu webview `unstable`
- `Window::add_child` ve `WebviewBuilder` Tauri 2.12.5'te hâlâ `unstable` özelliği arkasında. Yakın tarihli hata kayıtları da var.
- **Önlem:** Tauri sürümü sabitlenir. Panel kodu tek bir Rust modülünde izole edilir.
- **Yedek plan:** Panel sorun çıkarırsa ana pencereye bağlı, kenarlıksız ayrı bir pencere olarak açılır ve ana pencerenin konumunu izler. Aynı yalıtım bu durumda da geçerlidir.

### 6.2 Risk: istek engelleme
- Tauri'nin `on_web_resource_request` işleyicisi yalnızca uygulama protokolü için çalışıyor. Dış istekleri iptal etmek için `with_webview` ile WebView2'nin `AddWebResourceRequestedFilter` + `WebResourceRequested` API'sine inilir (`webview2-com`).
- Tarayıcı panelinde ana mekanizma proxy'dir; WebView2 filtresi ek savunma katmanıdır.

## 7. Veri uyumluluğu

- Veri klasörü aynı kalır: `%LOCALAPPDATA%\lumen.cpp`. Dosya biçimleri değişmez. İki kabuk aynı klasörü kullanabilir, ama **aynı anda değil**. *(Benim kararım)* Ortak kilit çekirdekte tutulur: `core.cjs` açılışta veri klasöründe `core.lock` dosyasını PID ile oluşturur (`wx`); dosya varsa ve o PID canlıysa açılmayı reddeder. Kilit iki kabukta da aynı kodla çalışır, Electron'un kendi tek örnek kilidi de yerinde kalır. Electron'a Windows çağrısı eklemek gerekmez.
- **Gizli anahtarlar** *(benim kararım)*: Tauri kabuğu yeni bir biçim üretmez, Electron'un biçimini **hem okur hem yazar**.
  - Bugünkü değerler Electron `safeStorage` biçiminde: `v10` önekli AES-256-GCM. Anahtar `%APPDATA%\lumen.cpp\Local State` içindeki `os_crypt.encrypted_key`'de, DPAPI ile korunuyor.
  - Rust bu anahtarı DPAPI ile açar, aynı biçimde şifreler ve çözer. Böylece Electron yapısında **hiçbir değişiklik gerekmez** ve kabuklar arasında geçiş yapmak anahtarları kaybettirmez.
  - `Local State` yoksa (Electron hiç çalışmamış bir makine) Rust aynı biçimde yeni bir anahtar üretip dosyayı oluşturur.
  - Biçim ayrıntısı 3. adımın başında gerçek bir değerle doğrulanır. Doğrulanamazsa **yedek plan**: kullanıcıdan anahtarları yeniden girmesi istenir (açık bir uyarıyla, sessizce silmeden).
- Test verisi yalnızca `work/` altında. Kullanıcının gerçek sohbetleri ve modelleri kullanılmaz; modeller hard link ile okunur.

## 7a. Tauri yapısının dağıtımı *(benim önerim; kullanıcı görüşümü sordu)*

- Bu projede Tauri yapısı **yalnızca geliştirme** amaçlıdır, kullanıcılara verilmez. Klasörü: `Lumen WF/work/tauri-build/`. `outputs/Lumen-Beta`, setup ve ZIP'e dokunulmaz.
- Güncelleme: Tauri yapısında `updates.cjs` yalnızca **denetler** (sürüm satırı ve notlar görünür), indirme ve kurulum kapalıdır; arayüzde "Bu önizleme sürümü güncellenemez" notu gösterilir. Bugünkü güncelleyici klasörü Electron sürümüyle değiştirir ve `process.execPath`'i (Tauri'de `node.exe`) yeniden başlatırdı.
- `backend/` (lumen-host, motorlar) yeri: çekirdek, kabuktan gelen `appDir` parametresiyle bulur; `process.execPath` / `__dirname` varsayımı kalkar.
- Paket boyutu, Tauri yapı klasörünün tamamı üzerinden ölçülür ve aynı içerikteki Electron klasörüyle karşılaştırılır (modeller ve motorlar iki tarafta da hariç).
- Beta testçilerine bir önizleme vermek, Proje 1 bittikten sonra ayrı bir karar olarak ele alınır; release adımı her zaman ayrıca onay ister.

## 8. Test altyapısı (yeniden kurulur)

- **Ortak test sürücüsü:** CDP (Chrome DevTools Protocol) ile iki kabuğu da süren bir sürücü. Electron'da `--remote-debugging-port`, Tauri'de WebView2 için aynı argüman, ikisi de yalnızca test modunda. Node 22'nin yerleşik `WebSocket`'i kullanılır; yeni bağımlılık yok.
- **Test kancası:** Kayıp `ui-check.cjs`'in yerini, çekirdekte test modunda açılan bir kanca alır: geçici veri klasörü, sahte dosya seçimi, mock sunucu adresleri. Bu kez repoya girer, ama üretimde etkisizdir; bugünkü `LUMEN_*` override'larının `--ui-check` kısıtı korunur.
- **Çekirdek testleri:** `lumen-core` Electron'suz çalıştığı için modül testleri doğrudan Node'da koşar.
- **Öncelikli UI senaryoları** (CLAUDE.md'deki eski testlerden): sohbet + iptal + kalıcılık; model menüsü; indirme duraklat/devam; araştırma + kaynaklar; tarayıcı paneli + engelli adres; belge ekleme; görsel üretme (mock motorla); MCP onayı (mock sunucu); yerel API; önizleme yalıtımı; ayarlar + TR/EN; 800×600 taşma.
- Testler ve kanıtlar `Lumen WF/work/` altına yazılır.

## 9. Kilometre taşları ve bitti tanımı

| # | Adım | Bitti sayılması için |
|---|---|---|
| 0 | Araç zinciri | Rust (rustup, MSVC hedefi) ve VS Build Tools (C++) kurulu. **Kurulum kullanıcı onayıyla yapılır.** |
| 1 | Çekirdeği ayırma (Electron'da) | `core.cjs` Electron'a `require` yapmaz; Electron yapısı açılır, sohbet/indirme/ayarlar elle ve CDP testleriyle doğrulanır |
| 2 | Kabuk + yardımcı süreç + köprü | Tauri'de arayüz açılır, gerçek bir modelle sohbet akar, iptal çalışır, olaylar gelir |
| 3 | Platform hizmetleri | Dialog'lar, pano (metin + görsel), WebP, gizli anahtar (taşıma dahil), `lumen` protokolü, önizleme penceresi |
| 4 | Tarayıcı paneli + gizli işleyici | Panel gezinir; özel adres/DNS engeli proxy ile çalışır (test: `127.0.0.1`, `192.168.x`, DNS yeniden bağlama); araştırmada sayfa işleme |
| 5 | Testler + ölçüm | §8'deki senaryolar iki kabukta geçer; RAM/açılış/boyut karşılaştırma raporu `docs/MEASUREMENTS.md`'ye eklenir |

Her adımın sonunda kullanıcıya neyin gerçek entegrasyonla, neyin mock ile doğrulandığı ayrı ayrı raporlanır.

## 10. Builder'a bırakılanlar

- `platform` arayüzünün tam metod imzaları ve hata türleri.
- Rust crate seçimleri: `arboard`, `image`, `windows`/`webview2-com` sürümleri; proxy'nin CONNECT tünel ayrıntıları.
- `node.exe`'nin hangi resmi Node 22 LTS sürümünün paketleneceği; SHA-256 ile sabitlenir.
- Dev akışı: `cargo tauri dev` ile arayüz klasörünün nasıl servis edileceği.

## 11. Açık riskler

- `unstable` çoklu webview API'si (§6.1).
- Electron `safeStorage` biçiminin Tauri tarafında çözülmesi (§7); ilk denemede doğrulanacak.
- WebView2 sürümü kullanıcıdan kullanıcıya değişir; test edilen sürüm kayda geçirilir.
- `node.exe` boyutu kazancın bir kısmını geri alır. Gerçek boyut ölçülmeden "küçüldü" denmez.
- Yardımcı süreç olarak paketlenen `node.exe`, imzasız uygulamada antivirüs uyarısına yol açabilir; test edilmeli.
