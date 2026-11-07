# Yeni arayüz — tasarım (Proje 2/3)

Tarih: 7 Kasım 2026 · Durum: taslak, kullanıcı onayı bekliyor · Taban: `tauri-shell` dalı

## 1. Amaç ve neden
Kullanıcı bugünkü arayüzü "AI slop" buluyor: harfleri açılmış monospace etiketler, hero başlık, ok'lu öneri satırları, her yerde aynı dolgulu altın düğme. En önemli istek **renk ve yazı tipiyle özelleştirilebilme**. Taslak aşamasında üç yön gösterildi (Yerli Windows, Okuma odaklı, Profesyonel araç); kullanıcı üçünü de beğendi ve **tek bir birleşik tasarım + üç hazır tema** istedi.

## 2. Hedefler, hedef dışı, anti-hedefler
**Hedefler**
- Tek birleşik tasarım (taslak: `work/ui-brainstorm/content/merged-direction.html`): A'nın sade Windows iskeleti, B'nin serif okuma yazısı, C'nin durum bilgisi. Koyu + açık.
- Token tabanlı özelleştirme: vurgu, yüzey, metin, arayüz/okuma/kod yazı tipleri, yazı boyutu, köşe yuvarlaklığı.
- Üç hazır tema (token seti): **Yerli Windows**, **Okuma**, **Profesyonel**. Kullanıcı birini seçer, sonra tek tek değiştirir; "Varsayılana dön".
- İsteğe bağlı **durum çubuğu** (model, context, VRAM, motor, web; bulut modelinde sağlayıcı + token). Varsayılan kapalı; kapalıyken aynı bilgi composer altında tek satır. Bilgi tek kaynaktan, iki yerde birden görünmez. Olay tabanlı, polling yok.
- Desk/Studio kalkar; `prefs.layout` yeni tercihe göç eder (desk → Yerli Windows, studio → Profesyonel), eski alan silinmez.
- Bilinen hatalar düzeltilir: TR'de İngilizce placeholder; bulut modelinde "Yerel yanıt" + "Context – / 8.192" çelişkisi.
- Arayüz iki kabukta (Electron, Tauri) aynı çalışır.

**Hedef dışı:** yerleşimi sürükle-bırak özelleştirme, sekmeler (çoklu sohbet), yeni özellikler, Rust taşıması (Proje 3), release.

**Anti-hedefler:** EN/TR'den birinin eksik kalması; erişilebilirlik kaybı (kontrast 4.5:1, klavye, odak halkaları, reduced motion); 800×600'de taşma; IPC/`window.lumen` sözleşmesinin değişmesi; kullanıcı verisinin bozulması; sürekli animasyon/polling.

## 3. Bugünkü durum
- Framework yok, vanilla JS (~35 modül, ~450 KB). CSS 9+ dosya katman katman birbirini eziyor (`style.css` → `design.css` → `polish.css` → `extras.css` → `themes.css` → özellik dosyaları). Desk/Studio `body[data-layout]` ile ~50 dağınık kural.
- Vurgu temaları (`themes.js/css`) ve yazı boyutu zaten var — yeni sistem bunları kapsar.
- UI testleri `tests/ui/*` (CDP, iki kabuk) ve görünüm matrisi (`layout.test.mjs`) hazır; seçicilere bağlılar.

## 4. Yaklaşımlar
| | Yaklaşım | Artı | Eksi |
|---|---|---|---|
| **A (önerilen)** | DOM ve JS modülleri yerinde kalır; CSS baştan yazılır: tek token katmanı + bileşen başına dosya; eski 9 dosya kaldırılır. JS yalnızca yeni bileşenler (durum çubuğu, tema ayarları) ve slop öğelerinin markup'ı için değişir | IPC ve davranış korunur, testler büyük ölçüde geçerli kalır, iki kabukta risk düşük | DOM yapısındaki eski kararlar kısmen kalır |
| B | Renderer'ı bir framework ile baştan yazmak | En temiz yapı | npm bağımlılığı yasak; bütün davranış ve testler yeniden; aylar |
| C | Mevcut CSS'in üstüne yeni bir katman daha | Hızlı | Sorunun kaynağını (katman yığını) büyütür |

B proje kuralı (bağımlılık yok) ve risk yüzünden, C kök nedeni çözmediği için elendi.

## 5. Tasarım
- **Token'lar** (`:root`, `[data-mode=dark|light]`): `--surface-0..3`, `--text`, `--text-muted`, `--border`, `--accent`, `--accent-text`, `--danger`, `--font-ui`, `--font-reading`, `--font-mono`, `--font-size`, `--radius`, `--focus`. Bileşenler yalnızca token kullanır, ham renk yok.
- **Tema** = token değerleri sözlüğü (`themes.js`). Kullanıcı değişiklikleri temanın üstüne yazılır; `prefs.appearance = {theme, mode, overrides{token:value}, statusBar}`. Geçersiz değer (kontrastı 4.5:1'in altına düşen renk) kaydedilmez, uyarı gösterilir.
- **Yazı tipleri:** yalnızca sistemde kurulu ve uygulamayla gelen yazı tipleri (internetten indirme yok). Varsayılanlar: Segoe UI Variable / Charter→Cambria→Georgia / Cascadia Mono.
- **Monospace** yalnızca kod ve sayısal veride (token, ctx, VRAM).
- **Vurgu rengi** yalnızca gönder düğmesi, seçim, odak, context çubuğu.
- **Boş sohbet ekranı:** hero ve ok'lu öneri satırları kalkar; sade, tek satır ipucu.
- **Ayarlar → Görünüm:** tema seçici (üç kart, küçük canlı önizleme), mod, vurgu, üç yazı tipi, boyut, köşe, durum çubuğu anahtarı, varsayılana dön.
- **Durum çubuğu öğeleri tıklanabilir:** model → model menüsü, context → Ayarlar/Context, web → aç/kapat.
- Animasyonlar kısa (≤150 ms), reduced motion'da kapalı.

## 6. Test ve doğrulama
- Mevcut `tests/ui/*` iki kabukta geçmeye devam eder (seçici değişiklikleri testlerle birlikte güncellenir, assertion gevşetilmez).
- `layout.test.mjs` yeni matrise genişler: 3 tema × koyu/açık × EN/TR + 800×600 taşma + konsol hatası + kontrast denetimi (token çiftleri 4.5:1).
- Yeni: tercih göçü (desk/studio → tema), özelleştirme kalıcılığı, geçersiz renk reddi, durum çubuğu (yerel/bulut, olayla güncelleme), placeholder TR.
- Görsel kontrol: her tema için ekran görüntüleri `work/ui-shots/`; kullanıcıya gösterilir.

## 7. Açık riskler
- Seçicilerin değişmesi testleri kırar → testler aynı commit'te güncellenir.
- WebView2 ile Chromium arasında yazı tipi oluşturma farkı → ekran görüntüleri iki kabukta alınır.
- `polish.css` ile gelen bilinen davranış düzeltmesi (composer `relatedTarget` odak) korunmalı (CLAUDE.md §17).

## 8. Builder'a bırakılanlar
Bileşen CSS dosyalarının bölümü, token adlarının son hâli, tema renk değerlerinin ince ayarı (kontrast testi geçmek şartıyla), ayarlar ekranının iç yerleşimi.
