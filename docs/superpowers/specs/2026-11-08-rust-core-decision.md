# Proje 3 — Çekirdeği Rust'a taşımak: karar belgesi

Tarih: 8 Kasım 2026 · Durum: **karar verildi — A** (kullanıcı, 8 Kasım) · Ölçüm betiği: `work/measure/breakdown.mjs`

> **Karar:** Electron ürün kabuğu olarak kalır, çekirdek Rust'a taşınmaz, Tauri önizleme olarak bakımda kalır.
> Yeniden açma koşulu: indirme boyutu öncelik olursa B (Tauri + Node çekirdeği) yeniden değerlendirilir.

## 1. Soru
Tauri kabuğu hazır (Proje 1), ama ölçümde RAM ve açılış kazancı çıkmadı. "Çekirdek de Rust'a geçerse kazanç gelir mi?"
sorusu ölçülmeden cevaplanamazdı. Bu belge o ölçümü ve önerilen kararı içerir.

## 2. Ölçüm (8 Kasım, boşta 30 sn, aynı makine, model yüklü değil, ui-check derlemesi)

| Süreç | Tauri WS / özel (MB) | Electron WS / özel (MB) |
|---|---|---|
| Kabuk (`lumen.exe` / Electron ana) | 25 / 6 | — (aşağıdakine dahil) |
| **Node çekirdeği (`node.exe`)** | **50 / 56** | — (Electron ana süreç içinde) |
| Tarayıcı motoru (WebView2 5 süreç / Electron 4 süreç) | 374 / 219 | 366 / 239 |
| `lumen-host.exe` (C#, llama.cpp yönetimi) | 34 / 21 | 35 / 22 |
| conhost | 16 / 2 | 8 / 1 |
| **Toplam** | **499 / 304** | **409 / 262** |

(WS = working set; tek ölçüm, ±%10 oynar. Önceki 5 koşuluk ortalama: Tauri 453, Electron 371 MB.)

## 3. Sonuç
- Node çekirdeği Tauri'deki belleğin yalnızca **~%10'u** (50 MB WS). Rust'a taşınsa en iyi durumda ~40–50 MB kazanılır;
  Tauri toplamı ~450 MB olur, **yine Electron'un (409) üstünde kalır**. Belleğin %75'i WebView2'dir ve Rust bunu değiştirmez.
- Açılış: çekirdek ~60 ms'lik farkın bir kısmıdır (node.exe başlatma + stdio el sıkışması); kalanı WebView2 başlangıcıdır.
- Gerçek kazanç **paket boyutu**: `node.exe` 85 MB. Tauri paketi 97 MB → ~15 MB olabilir (WebView2 Windows'ta hazır).
  Electron paketi 373 MB.
- Maliyet: `core.cjs` + bağlı modüller (~40 dosya: indirici, ajan, web/SSRF koruması, MCP, belgeler/pdf.js işçisi,
  görseller, plugin'ler, yerel API, güncelleyici…) yeniden yazılır. pdf.js, markdown/KaTeX gibi JS bağımlılıkları Rust'ta
  karşılıksız ya da ayrı iş. Bütün core testleri (`tests/core`, 98 test) yeniden yazılır. Kaba tahmin: Proje 1'in 2–3 katı.

## 4. Seçenekler
| | Seçenek | Kazanç | Maliyet/risk |
|---|---|---|---|
| **A (önerilen)** | Electron ürün kabuğu olarak kalır; Tauri önizleme olarak bakımda kalır; Rust taşıması yapılmaz | Yok (bugünkü durum) | Yok |
| B | Tauri'yi ürüne almak, çekirdek Node kalır | İndirme 373 → 97 MB | RAM +80 MB, installer/güncelleyici Tauri için yeniden yapılır, node.exe imzasız (antivirüs riski) |
| C | B + çekirdeği Rust'a taşımak | İndirme ~15 MB, RAM −~50 MB (yine Electron'dan fazla) | Çok büyük yeniden yazım, regresyon riski yüksek |

## 5. Öneri
**A.** Kullanıcının hedefi "daha hafif uygulama" ise ölçüm, kazancın yalnızca indirme boyutunda olduğunu gösteriyor; RAM ve
açılışta Electron zaten önde. İndirme boyutu önemliyse önce **B** (çekirdek Node kalır) değerlendirilmeli; C'nin ek
kazancı (~50 MB RAM, ~80 MB indirme) maliyetini karşılamıyor.

## 6. Açık sorular (kullanıcıya)
1. Öncelik nedir: indirme boyutu mu, RAM mi, "Rust'a geçtik" demek mi?
2. B seçilirse: Tauri için installer ve güncelleyici işine onay.
