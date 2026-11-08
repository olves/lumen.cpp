# Kodlama ajanı — tasarım (Aşama 1: oku, ara, düzenle)

Tarih: 8 Kasım 2026 · Durum: taslak, kullanıcı onayı bekliyor · Yol: C (iki aşama), kullanıcı seçti.

## 1. Niyet ve neden

Kullanıcının bir arkadaşı Lumen'i Claude Code / OpenCode gibi bir **kodlama ajanı** olarak kullanmak istiyor ve bu olmadan
kullanmayacağını söylüyor. İstekleri (kendi sözleriyle): "model hem daha sağlam kalite çıkarsın, harness de", "hem de daha
uyguna yapsın", "context yönetimini optimize et". Bir karşılaştırma grafiği paylaştı: aynı model (DeepSeek V4 Pro) farklı
ajan araçlarında görev başına 0,028–0,074 $ tutuyor; fark ajan aracının (harness) kalitesinden geliyor.

Yani hedef: **aynı modelle daha az token harcayıp daha çok görevi doğru bitiren** bir ajan. Başarı ölçütü "görev başına
maliyet" ve "görevin doğru bitmesi"dir; özellik sayısı değil.

Lumen'in bugünkü ilkesi "dosya yazmaz, program başlatmaz". Kullanıcı bunu değiştirmeyi seçti, ama iki aşamada:
- **Aşama 1 (bu belge):** proje klasöründe okuma, arama ve **onaylı düzenleme**; önbellek dostu istekler, context
  sıkıştırma, maliyet göstergesi. Komut çalıştırma yok.
- **Aşama 2 (ayrı belge, sonra):** onaylı komut çalıştırma (test, derleme). Burada yalnızca sınırları not edilir (§10).

## 2. Hedefler, hedef olmayanlar, anti-hedefler

**Hedefler (Aşama 1)**
1. Bağlı bir proje klasöründe modelin dosya okuması, araması, **var olan dosyayı değiştirmesi ve yeni dosya oluşturması**.
2. Her değişikliğin uygulanmadan önce **fark (diff) olarak gösterilmesi** ve kullanıcı onayı; görevdeki tüm değişikliklerin
   **tek tıkla geri alınabilmesi**.
3. Bulut modellerinde (öncelik: DeepSeek `deepseek-flash` ve `deepseek-v4-pro`) **sağlayıcı önbelleğini en çok kullanan**
   istek düzeni; yerel modellerde de aynı döngü (daha düşük beklentiyle).
4. **Context yönetimi:** büyük araç çıktılarının kırpılması, eski araç sonuçlarının seyreltilmesi, gerektiğinde tek seferlik
   özetleme; context penceresi hiçbir zaman sessizce taşmaz.
5. **Maliyet göstergesi:** her görevde girdi (önbellekten / önbelleksiz) ve çıktı token'ları ile tahmini tutar; görev başına
   isteğe bağlı bütçe sınırı.
6. TR/EN arayüz, iki kabuk (Electron ve Tauri) aynı çekirdek.

**Hedef olmayanlar (Aşama 1)**
- Komut, test, derleme veya git çalıştırma (Aşama 2).
- Dosya silme, yeniden adlandırma, klasör taşıma.
- Birden çok proje klasörü aynı anda; arka planda veya zamanlanmış görevler; birden çok ajanın paralel çalışması.
- Proje dışındaki dosyalara erişim; ikili (binary) dosya düzenleme.

**Anti-hedefler (çalışsa bile başarısızlık sayılır)**
- Kullanıcının görmeden ve onaylamadan diske yazılan tek bir bayt.
- Proje kökü dışına yazma (symlink, `..`, büyük/küçük harf hileleri dahil).
- Gizli dosyaların (`.env`, anahtarlar, `SENSITIVE` listesi) kullanıcı açıkça izin vermeden okunması veya sağlayıcıya gitmesi.
- Kullanıcının haberi olmadan büyüyen fatura: bütçe aşılırsa ajan durur ve sorar.
- Geri alınamayan değişiklik.

## 3. Kısıtlar

- Çekirdek `app/core.cjs` + modüller, Electron'suz; iki kabuk aynı kodu kullanır. Yeni npm bağımlılığı yok.
- Windows; yollar büyük/küçük harf duyarsız karşılaştırılır (mevcut `projects.cjs` `inside()` kuralı).
- Sırlar asla yazdırılmaz; API anahtarları mevcut `connections` (DPAPI) üzerinden.
- Yerel model aynı anda tek çıkarım yapar (llama-server `--parallel 1`).
- Bulut modeli seçildiğinde proje dosyalarının içeriği o sağlayıcıya gider: mevcut bulut onayına ek olarak kodlama modunda
  bir kez "proje dosyaların <sağlayıcı>'ya gönderilecek" onayı alınır.
- Test kuralları: kullanıcının gerçek verisine yazılmaz; UI testleri `tests/ui`, çekirdek testleri `tests/core`; gerçek bulut
  çağrısı testlerde yok (mevcut `cloudServer` sahte sunucusu genişletilir).

## 4. Yaklaşımlar

| | Yol | Artı | Eksi |
|---|---|---|---|
| A | Tam ajan tek seferde (okuma + düzenleme + komut) | Arkadaşın istediği her şey bir anda | En büyük iş; en riskli parça (komut) ilk sürüme girer |
| B | Lumen'i başka ajanlara (OpenCode vb.) arka uç yapmak | Küçük iş | Ajan Lumen'in olmaz; "harness kalitesi" istek dışında kalır |
| **C** | **A'yı iki aşamada: önce oku/ara/düzenle + maliyet, sonra komut** | Değerin çoğu ilk aşamada; komut ayrı ve dikkatle tasarlanır | Arkadaş test çalıştırmayı Aşama 2'ye kadar elle yapar |

**Seçilen: C** (kullanıcı, 8 Kasım). Gerekçe: görev başına maliyetin ve doğruluğun çoğu "doğru dosyayı bul, küçük ve doğru
değişikliği yap, context'i şişirme" adımlarından gelir; komut çalıştırma Lumen'in güvenlik ilkesini en çok zorlayan parçadır.

## 5. Kullanıcı deneyimi

- **Giriş noktası:** mevcut "+ → Proje klasörü" akışı. Klasör bağlıyken bir anahtar: **"Düzenlemeye izin ver"** (varsayılan
  kapalı; kapalıyken bugünkü salt okunur proje ajanı aynen çalışır). Anahtar sohbet başınadır.
- **Bir görev = bir kullanıcı mesajı.** Ajan adım adım çalışır; faaliyet satırında adımlar görünür (bugünkü proje ajanı gibi):
  "src/app.js okundu (1–80)", "‘parseConfig’ arandı · 3 eşleşme", "Değişiklik önerildi: src/app.js".
- **Değişiklik kartı:** dosya adı, eklenen/çıkarılan satır sayısı, renkli fark (bağlamla birlikte, uzunsa katlanır).
  Düğmeler: **Uygula**, **Atla**, **Bu görevde hepsini uygula**. "Atla" modele "kullanıcı bu değişikliği reddetti" diye
  bildirilir; model başka yol dener veya biter.
- **Görev sonu:** yanıtın altında özet: değişen dosyalar (tıklanınca fark), **"Bu görevdeki değişiklikleri geri al"**, ve
  maliyet satırı: `Girdi 48.2K (%91 önbellek) · Çıktı 3.1K · ≈ 0,9 ¢` (para birimi fiyat tablosundan; yerel modelde "yerel ·
  ücretsiz").
- **Bütçe:** Ayarlar → Kodlama: görev başına üst sınır (varsayılan 0,20 $). Aşılınca ajan durur, "devam etmek için onay"
  kartı gösterir.
- **Durdur:** mevcut gönder/durdur düğmesi görevi keser; o ana kadar uygulanmış değişiklikler kalır ve geri alınabilir.

Taslak görünüm (değişiklik kartı):

```
┌ Değişiklik önerildi · src/config.js   +6 −2 ──────────────┐
│  12   function parseConfig(text) {                         │
│ −13     const lines = text.split('\n');                    │
│ +13     const lines = String(text || '').split(/\r?\n/);   │
│  ...                                                       │
│  [ Uygula ]  [ Atla ]   [ Bu görevde hepsini uygula ]      │
└────────────────────────────────────────────────────────────┘
```

## 6. Ajan döngüsü (harness)

**Araçlar (Aşama 1):**

| Araç | Ne yapar | Sınır |
|---|---|---|
| `list_dir(path, depth)` | mevcut | mevcut |
| `find_files(pattern)` | mevcut | mevcut |
| `search_text(query, path)` | mevcut | mevcut |
| `read_file(path, start_line, end_line)` | mevcut; satır numaralı döner | tek okumada en çok ~400 satır |
| `edit_file(path, edits[{old, new}])` | var olan dosyada **birebir metin değiştirme**; her `old` dosyada tam bir kez geçmeli | dosya ≤ 1 MB, metin, UTF-8 |
| `create_file(path, content)` | yeni dosya; varsa hata | ≤ 200 KB |
| `finish(summary)` | görevi bitirir | — |

- **Neden birebir değiştirme (search/replace):** model dosyanın tamamını yeniden yazmaz; çıktı token'ı en pahalı kalem olduğu
  için en büyük tasarruf buradan gelir, ve "dosyanın geri kalanını bozma" riski kalkar. `old` bulunamazsa veya birden çok
  kez geçerse araç hata döner (hangi satırlara yakın olduğunu söyleyerek); model yeniden okur ve tekrar dener.
- **Bulut modelleri:** sağlayıcının yerel araç çağrısı (OpenAI biçimi `tools` / `tool_calls`; DeepSeek'te doğrulandı,
  8 Kasım). `cloud.cjs` `chat`'e `tools` desteği eklenir (akışta `delta.tool_calls` birleştirilir).
- **Yerel modeller:** bugünkü JSON şemalı adım (`projectSchemas` + gramer) yeni araçlarla genişletilir.
- **Kalite önlemleri:** bozuk araç çağrısı → bir kez açıklamalı hata ile tekrar; aynı başarısız çağrının üçüncü tekrarı →
  durdur. Bir düzenlemeden sonra o bölge kullanıcıya gösterilecek fark için zaten yeniden okunur; araç sonucu modele
  "uygulandı, satır 12–19 şimdi şöyle" diye kısa bir doğrulama döner. Adım sınırı (varsayılan 40) ve süre sınırı.
- **Sistem talimatı:** kısa ve sabit (proje adı, kurallar, araç kullanım ilkeleri: "önce ara, sonra yalnızca gereken satırları
  oku; küçük düzenlemeler yap; bitirince ne değiştiğini özetle"). Proje ağacı ilk kullanıcı mesajına eklenir, sisteme değil.

## 7. Context ve maliyet yönetimi

1. **Sabit başlangıç (önbellek):** sistem talimatı + araç tanımları bir proje oturumu boyunca **değişmez**; tarih/saat sisteme
   girmez (1.0.8'deki bulut kuralı). Konuşma yalnızca **sona eklenir**; geçmişteki bir mesaj asla yerinde değiştirilmez
   (sıkıştırma hariç, aşağıda). Ölçüm: DeepSeek ikinci istekte 2005 girdi token'ının 1792'sini önbellekten saydı.
2. **Görevler arası süreklilik:** aynı sohbette sonraki mesaj, ajanın önceki görev dökümünün (araç çağrıları dahil) üstüne
   eklenir; böylece önceki okumalar hem önbellekten gelir hem de yeniden okunmaz. Döküm sohbet başına yan dosyada saklanır.
3. **Araç çıktısı kırpma:** her araç sonucu tek başına bir üst sınıra kırpılır (ör. arama ≤ 60 eşleşme, okuma ≤ 400 satır);
   kırpıldığında model bunu ve nasıl daraltacağını görür.
4. **Seyrek ve toplu sıkıştırma:** her sıkıştırma önbelleği bir kez bozar (başlangıç değişir). Bu yüzden adım adım
   budama yapılmaz; döküm, context bütçesinin (modelin penceresi ile bütçe ayarından küçüğü) %75'ine ulaşınca tek seferde
   sıkıştırılır.
5. **Sıkıştırma:** en son N adım (varsayılan 8) aynen kalır; daha eskilerin araç sonuçları kısa notlara
   iner ("src/app.js 1–80 okunmuştu; gerekirse yeniden oku"), düzenleme sonuçları "uygulandı/atlandı" olarak kalır; görev
   hedefi ve kullanıcının mesajları aynen kalır. Gerekirse model tek bir çağrıyla "şimdiye kadar öğrendiklerin" özetini yazar
   ve bu özet dökümün başına (sistemden hemen sonra) konur. Sonuç: yeni ve tekrar sabit bir başlangıç.
6. **Maliyet hesabı:** her yanıtın `usage` alanı (DeepSeek: `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`,
   `completion_tokens`; OpenAI: `prompt_tokens_details.cached_tokens`) adım adım toplanır. Fiyat tablosu
   (model → girdi-önbellek, girdi, çıktı, para birimi; milyon token başına) Ayarlar → Kodlama'da düzenlenebilir;
   DeepSeek için varsayılan değerler uygulama sırasında resmî fiyat sayfasından doldurulur ve kaynağı/tarihi yazılır.
   Bilinmeyen modelde tutar yerine yalnızca token sayıları gösterilir.

## 8. Güvenlik

- **Yazma yolu tek bir modülden geçer** (`projects.cjs` içinde yeni `write` katmanı): `realpath` + `inside(root)` kontrolü
  hem hedef dosya hem de en yakın var olan üst klasör için; symlink/junction ile dışarı çıkan hedef reddedilir; `SENSITIVE`
  ve `.gitignore`'da gizli sayılanlar düzenlenemez (okuma kuralıyla aynı izin istisnası); ikili dosya düzenlenemez.
- **Atomik yazma:** geçici dosyaya yaz → yeniden adlandır. Satır sonu (CRLF/LF) ve BOM korunur.
- **Kontrol noktası:** bir görevde bir dosyaya ilk yazmadan önce özgün içerik `<data>/agent-checkpoints/<görev>/` altına
  kopyalanır (yeni dosyalar "oluşturuldu" olarak not edilir). "Geri al" bu kopyaları geri koyar ve oluşturulanları siler;
  geri almadan önce dosya ajan dışında değiştiyse o dosya için uyarı gösterilir ve üzerine yazılmaz. Kontrol noktaları
  sohbet silinince veya 30 gün sonra temizlenir.
- **Onay:** her `edit_file`/`create_file` uygulanmadan önce kullanıcı onayı (ya da o görev için "hepsini uygula"). Onay
  bekleyen çağrı 10 dakika sonra "atlandı" sayılır.
- **Gizlilik:** bulut modelinde araç sonuçları sağlayıcıya gider; gizli dosya içerikleri hiçbir zaman (okuma kuralı).

## 9. Kalıcı veri

- `conversation-coding.json`: sohbet başına `{allowEdits, transcript (ajan dökümü, sıkıştırılmış hali), costs[]}`; dallanmada
  kopyalanır, silmede temizlenir (mevcut yan dosya düzeni).
- `coding-settings.json`: fiyat tablosu, görev bütçesi, adım sınırı.
- `agent-checkpoints/`: §8.

## 10. Aşama 2 için sınırlar (bu aşamada yapılmaz)

Komut çalıştırma ayrı bir tasarım belgesiyle gelecek. Şimdiden kararlaştırılanlar: her komut onaylı; çalışma klasörü proje
kökü; zaman sınırı ve Job Object ile tüm alt süreçlerin kapatılması; çıktı kırpılarak modele verilir; ortam değişkenlerinden
anahtar/token'lar temizlenir. Aşama 1'in araç ve onay altyapısı buna göre genişletilebilir yazılır.

## 11. Doğrulama

- Çekirdek birim testleri: `edit_file` (tek eşleşme, yok, çoklu, CRLF/BOM korunur), kök dışı/symlink/gizli dosya reddi,
  kontrol noktası ve geri alma (dış değişiklik uyarısı dahil), sıkıştırma (son N adım aynen, başlangıç sabit), maliyet
  hesabı (DeepSeek ve OpenAI `usage` biçimleri).
- UI testleri (iki kabuk): sahte bulut sunucusu senaryolu araç çağrıları döndürür → fark kartı, Uygula/Atla, hepsini uygula,
  geri al, bütçe durdurması, maliyet satırı; yerel modelle küçük bir gerçek düzenleme görevi.
- Önbellek ölçümü: sahte sunucu gelen isteklerin başlangıcının adımlar arasında bayt bayt aynı kaldığını denetler.

## 11a. Netleştirilen noktalar (bağımsız okuyucu kontrolünden; hepsi **Claude'un kararı**, kullanıcı onayında gözden geçirilir)

1. **Geri alma kapsamı:** yalnızca **en son değişiklik yapan görev** geri alınabilir; daha eskilerin özetinde düğme kapalıdır
   ("sonraki görevler aynı dosyalara dokunmuş olabilir"). Kontrol noktası görev başına tek anlık görüntüdür (zincir yok).
   Geri alınca döküm yeniden yazılmaz; sonuna kısa bir not eklenir ("kullanıcı görev N'nin değişikliklerini geri aldı:
   dosyalar…") — böylece sonraki görev diskte ne olduğunu bilir ve önbellek bozulmaz.
2. **Dallanma, yeniden üretme, geçmiş mesajı düzenleme:** diskteki dosyalara **asla dokunmaz**. Döküm kayıtları hangi kullanıcı
   mesajına ait olduklarını taşır; dal açılınca döküm o mesaja kadar kesilerek kopyalanır ve başına "diskteki dosyalar bu dalın
   başlangıcından sonra değişmiş olabilir" notu eklenir. Kodlama görevi yanıtlarında **Yeniden üret gizlidir** (görsel
   yanıtlarındaki gibi); kullanıcı isterse önce geri alır, sonra mesajı yeniden gönderir.
3. **Son yanıt ve tek döngü:** `finish(summary)` metni **yanıtın kendisidir**; ayrı bir "yanıt yazma" çağrısı yapılmaz (maliyet).
   Atıflar için model özetinde dosya yollarını yazar; arayüz görev içinde okunan/değişen dosyaları yanıtın altında listeler.
   **Tek döngü** vardır: "Düzenlemeye izin ver" yalnızca `edit_file`/`create_file` araçlarını açar. Bu döngü bulut
   modellerini de kabul eder; yani anahtar kapalıyken bile bulut modeliyle salt okunur proje çalışması mümkün olur (bugün
   reddediliyor). Bugünkü proje ajanı bu döngüyle değiştirilir; araştırma (web) seçeneği aynen korunur.
4. **Yerel modeller ve host sınırları:** Aşama 1'de `LumenHost.cs` değişmez. Yerel modelde görevler arası döküm taşınmaz;
   yalnızca önceki görevin `finish` özeti ve değişen dosya listesi taşınır. Yerel adım çıktısı en çok 4096 token; yerelde
   `create_file` için içerik sınırı buna göre ~12 KB'tır (daha büyüğü için model önce iskelet oluşturur, sonra
   `edit_file` ile büyütür). Adım ve mesaj sayısı host'un 80 mesaj sınırının altında kalacak şekilde ayarlanır.
5. **Model değiştirme:** döküm Lumen'in kendi nötr biçiminde saklanır (`{role, text, toolCall:{name,args,id}, toolResult}`);
   her istekte modele göre ya yerel araç çağrısı biçimine ya da JSON adımlara çevrilir. Sağlayıcı/model değişince yalnızca
   önbellek bir kez boşa gider; yerelden buluta geçişte döküm taşınır, buluttan yerele geçişte 4. maddedeki kural uygulanır.
6. **Bütçe:** iki sınır birlikte çalışır: **token sınırı** (görev başına toplam girdi+çıktı, varsayılan 3 milyon; her modelde,
   fiyat bilinmese de geçerli) ve **para sınırı** (varsayılan 0,20 $; yalnızca fiyatı bilinen modellerde). Hangisi önce
   dolarsa ajan durur ve onay ister. §7.4'teki "context bütçesi" ayrı bir ayar değildir: modelin penceresidir.
7. **Düşünme (thinking):** ajan adımlarında DeepSeek'e `reasoning_effort: 'low'` gönderilir (varsayılan); Ayarlar → Kodlama'da
   "Adımlarda daha çok düşün" (high) seçilebilir. Düşünme metni sonraki isteklere **gönderilmez** (yalnızca sonuç ve araç
   çağrısı), böylece döküm küçük ve başlangıç sabit kalır; sağlayıcı geri gönderilmesini zorunlu kılarsa bu, uygulama
   sırasında ölçülüp belgeye yazılır. Yerel modellerde adım düşünmesi bugünkü gibi kapalıdır.

## 12. Uygulayıcıya bırakılanlar

Talimat metinlerinin tam ifadesi; fark görünümünün çizimi; eşik değerlerinin (%60/%75, N=8, satır sınırları) ölçümle
ayarlanması; Ayarlar → Kodlama sayfasının düzeni; faaliyet satırı metinleri.
