# Construction Antalya — Instagram Otomasyonu

`constructionantalya.com` üzerindeki blog içeriğini her gün bir Instagram gönderisine çeviren bot. Resmî Instagram Graph API kullanır: hesap otomasyonu Meta tarafından onaylı yoldan yapılır, ban riski yoktur.

Her gün otomatik olarak:

1. Sitedeki blog yazılarını çeker ve bölümlere ayırır
2. Sırada olan bölümü seçer (yazılar arasında dönüşümlü)
3. O yazının kendi sayfasındaki görsellerden birini alır
4. Görselin üzerine editoryal tipografi bindirip 1080×1350 kare üretir
5. Claude ile marka sesinde caption yazar
6. İçeriğe göre hashtag seti kurar (her gün farklı kombinasyon)
7. Instagram'da yayınlar ve geçmişe işler

---

## Neden bölüm bazlı?

Sitede 10 blog yazısı var. Yazı başına bir gönderi atsaydık içerik 10 günde biterdi.

Bunun yerine her yazının `##` bölümleri ayrı birer içerik birimi olarak ele alınıyor:

```
10 yazı × ~10 bölüm = 101 benzersiz gönderi ≈ 3,5 ay günlük içerik
```

Siteye yeni yazı eklendiğinde havuza kendiliğinden katılır. Havuz tükenirse bot durmaz; en eski bölüm yeni fotoğraf ve yeni caption ile yeniden dolaşıma girer.

## Görseller nereden geliyor?

Her gönderi, **kaynak yazının kendi sayfasındaki görselleri** kullanır. Yazıyı yazan kişi hangi kareleri seçtiyse gönderi de onları kullanır; bu, konu tahminine dayalı eşleştirmeden daha güvenilir bir editoryal bağlantı kurar. Kaba yapı yazısı iskelet fotoğrafı alır, bitiş işçiliği yazısı detay fotoğrafı.

Yazıların çoğunun kendine ait editoryal görselleri var (`/assets/blog/shell-hero.webp`, `shell-1.webp` …); bir kısmı gövdesine proje fotoğrafı gömmüş. İkisi de aynı şekilde kullanılır. Kapak görseli yazının giriş bölümüne verilir.

`og:image` bilerek kullanılmaz: sitede **her yazının og:image'i aynı** generic hero karesini gösteriyor, gönderi görseli olarak değersiz.

**Havuz büyüklüğü:** 43 benzersiz görsel, 101 gönderi. Yani her görsel ortalama 2-3 kez kullanılır, ama aynı yazının bölümleri ~10 gün arayla yayınlandığı için tekrarlar feed'de yan yana düşmez. Görsel çeşitliliğini artırmanın en doğrudan yolu blog yazılarına görsel eklemek — bot onları kendiliğinden havuza katar.

---

## Kurulum

### 1. Bağımlılıklar

```bash
npm install
cp .env.example .env
```

### 2. Instagram erişimi

Ön koşul: Instagram hesabı **Business** tipinde ve bir **Facebook Sayfası'na bağlı** olmalı.

**a) Meta uygulaması oluştur**

1. [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create App**
2. Tip olarak **Business** seç
3. Ürünlerden **Instagram Graph API**'yi ekle

**b) İzinleri al**

[Graph API Explorer](https://developers.facebook.com/tools/explorer/)'da uygulamanı seç ve şu izinleri işaretle:

```
instagram_basic
instagram_content_publish
pages_show_list
pages_read_engagement
business_management
```

**Generate Access Token** de ve onayla.

**c) Instagram hesap ID'sini bul**

Explorer'da sırayla çalıştır:

```
GET /me/accounts
```

Dönen sayfa ID'sini alıp:

```
GET /{page-id}?fields=instagram_business_account
```

Çıkan `instagram_business_account.id` senin `IG_USER_ID` değerin.

**d) Süresiz token al (önerilen)**

Explorer'ın verdiği token kısa ömürlüdür. 60 günlük uzun ömürlü token da iki ayda bir sessizce ölür. Kalıcı çözüm **System User token**:

1. [business.facebook.com/settings](https://business.facebook.com/settings) → **Users → System Users**
2. **Add** ile bir sistem kullanıcısı oluştur (rol: Admin)
3. **Add Assets** → uygulamanı ve Facebook Sayfanı ata (tam yetki)
4. **Generate New Token** → uygulamanı seç → yukarıdaki beş izni işaretle
5. Süre olarak **Never** seç

Bu token süresiz geçerlidir. `.env` içine `IG_ACCESS_TOKEN` olarak yaz.

### 3. Claude API anahtarı

[console.anthropic.com](https://console.anthropic.com/settings/keys) → API key oluştur → `.env` içine `ANTHROPIC_API_KEY` olarak yaz.

Caption başına maliyet birkaç sent; günde bir gönderi için aylık maliyet ihmal edilebilir.

### 4. Görsel barındırma

Instagram görseli **public bir URL'den** çeker, dosya yüklemesi kabul etmez. İki seçenek var:

**Seçenek A — GitHub (varsayılan, repo public olmalı)**

Üretilen kare ayrı bir `media` branch'ine yazılır ve `raw.githubusercontent.com` üzerinden sunulur. Branch'i bir kez oluştur:

```bash
git checkout --orphan media
git rm -rf .
git commit --allow-empty -m "chore: media branch"
git push origin media
git checkout main
```

**Seçenek B — Cloudinary (repo private kalsın istiyorsan)**

[cloudinary.com](https://cloudinary.com) ücretsiz hesap aç, `.env` içinde `IMAGE_HOST=cloudinary` yap ve üç Cloudinary değişkenini doldur.

### 5. GitHub Actions

Repo → **Settings → Secrets and variables → Actions** altına ekle:

| Secret | Değer |
|---|---|
| `IG_USER_ID` | Instagram hesap ID'si |
| `IG_ACCESS_TOKEN` | System User token |
| `ANTHROPIC_API_KEY` | Claude API anahtarı |

Cloudinary kullanıyorsan `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` de ekle.

İsteğe bağlı **Variables**: `CAPTION_LOCALE` (`en`/`tr`/`ru`), `IMAGE_HOST`, `SITE_BASE_URL`.

Bot her gün **20:00 Türkiye saatinde** çalışır. Değiştirmek için `.github/workflows/daily-post.yml` içindeki cron satırını düzenle (UTC yazılır).

---

## Kullanım

```bash
# Yayın takvimini önizle — API maliyeti yok, hiçbir şey yayınlanmaz
npm run plan          # sıradaki 14 gün
npm run plan 30       # sıradaki 30 gün

# Gerçek gönderiyi üret ama YAYINLAMA (görsel + caption out/ klasörüne yazılır)
npm run post:dry

# Yayınla
npm run post

# Performans
npm run insights     # Instagram metriklerini çek (24 saatten eski gönderiler)
npm run stats        # Performans raporu

# Kurulum kontrolü
npm run doctor       # token, izinler, bağlı hesap, kota

# Testler ve tip kontrolü
npm test
npm run typecheck
```

İlk kez çalıştırmadan önce `npm run post:dry` ile çıktıyı gözden geçirmeni öneririm. GitHub Actions'ta da **Run workflow → dry run** ile deneyebilirsin; çıktı artifact olarak yüklenir.

---

## Özelleştirme

| Ne | Nerede |
|---|---|
| Hashtag havuzları ve strateji | `src/caption/hashtags.ts` |
| Caption tonu ve kuralları | `src/caption/generator.ts` → `SYSTEM_PROMPT` |
| Görsel tasarımı, renkler, tipografi | `src/image/compose.ts` |
| Konu tespiti (hashtag + etiket için) | `src/content/topics.ts` |
| Hangi bölüm hangi görseli alır | `src/image/select.ts` |
| Yayın saati | `.github/workflows/daily-post.yml` → cron |
| Gönderi sırası mantığı | `src/pipeline/select-unit.ts` |

Vurgu rengi `compose.ts` içinde `ACCENT` sabiti (`#c9a227`, mat altın). Fontlar `assets/fonts/` altında: başlık Playfair Display, gövde Inter.

Siteye yeni yazı eklendiğinde hem içerik hem görselleri havuza kendiliğinden katılır; kodda değişiklik gerekmez.

---

## İstatistikler

Bot yayınladığı her gönderinin performansını takip eder. Ayrı bir GitHub Actions işi **her Pazartesi 09:00**'da çalışır, Instagram'dan metrikleri çekip `state/posted.json`'a işler.

Her çalışmada son 30 günün tamamı tazelenir, o yüzden haftalık ritimde veri kaybı olmaz. İstediğin an elle de çalıştırabilirsin: `npm run insights` veya Actions sekmesinden **Run workflow**.

Bu iş Claude API kullanmaz — yalnızca Instagram Graph API'ye sorgu atar, maliyeti yoktur. Claude maliyeti sadece günlük caption üretiminde oluşur (aylık ~$0.30).

Toplanan veriler: erişim, beğeni, yorum, kaydetme, paylaşma, toplam etkileşim.

```bash
npm run stats
```

Rapor dört kırılım verir:

| Kırılım | Cevapladığı soru |
|---|---|
| Konuya göre | Kaba yapı mı, bitmiş iş mi, otel mi daha çok ilgi çekiyor? |
| Kaynak yazıya göre | Hangi blog yazısı Instagram'da daha iyi çalışıyor? |
| Görsele göre | Hangi fotoğraf türü daha güçlü? |
| Hashtag'e göre | Hangi etiketler gerçekten erişim getiriyor? |

Sıralama **etkileşim oranı** (etkileşim ÷ erişim) üzerinden yapılır. Ham beğeni sayısı hesabın o günkü erişimine göre şişip düştüğü için yanıltıcıdır; oran içeriğin gerçekten ilgi çekip çekmediğini gösterir.

Üçten az gönderi içeren gruplar `*` ile işaretlenir — o örneklemde sıralama gürültüden ibarettir. Anlamlı karşılaştırma için ~20-30 gönderi birikmesi gerekir, yani ilk gerçek okuma bir ay sonra mümkün olur.

**Neden ayrı bir iş:** metrikler yayın anında boştur, birikmeleri gün alır. Aynı akışta toplanamaz.

## Bot neyi hatırlıyor?

`state/posted.json` botun hafızası. Hangi bölümlerin paylaşıldığını, hangi fotoğrafların kullanıldığını tutar; hashtag rotasyonu da buna göre ilerler. GitHub Actions her yayından sonra bu dosyayı repoya geri commit eder.

Bu dosyayı silersen bot en baştan başlar ve daha önce paylaşılan içerikleri tekrar paylaşır.

---

## Sorun giderme

**`OAuthException: Invalid OAuth access token`**
Token süresi dolmuş. System User token'a geçmediysen 60 günde bir yenilemen gerekir.

**`The image URL is not accessible`**
Instagram görseli çekemiyor. `IMAGE_HOST=github` kullanıyorsan repo public mi ve `media` branch'i var mı kontrol et.

**`Media ID is not available`**
Container henüz hazır değilken yayınlanmaya çalışılmış. Bot zaten bekliyor; sürekli oluyorsa `POLL_MAX_ATTEMPTS` değerini artır (`src/instagram/client.ts`).

**Gönderi atlandı, hata yok**
Günlük kota (50) dolmuş olabilir ya da state dosyası commit edilememiştir. Actions loglarına bak.

**Aynı görsel sık tekrar ediyor**
Yazının sayfasındaki görsel sayısı bölüm sayısından az olduğunda kaçınılmaz. Kalıcı çözüm o yazıya görsel eklemek; geçici olarak `src/image/select.ts` içindeki `RECENCY_WINDOW` değerini artırabilirsin.

**`"..." yazisinda kullanilabilir gorsel bulunamadi`**
Yazının sayfasında hiç görsel yok (ya da hepsi logo/ikon olarak filtrelendi). O yazıya bir görsel ekle.

---

## Mimari

```
src/
├── index.ts              CLI girişi (--dry-run)
├── config.ts             ortam değişkenlerinin doğrulanması
├── blog/                 sitemap → yazı → bölüm ve görsel ayrıştırma
├── content/              konu tespiti (hashtag ve etiket için)
├── image/                görsel seçimi, kare üretimi, barındırma
├── caption/              Claude ile caption + hashtag stratejisi
├── instagram/            Graph API yayın istemcisi + metrik toplama
├── insights/             performans hesaplama (saf fonksiyonlar)
├── pipeline/             gönderi seçimi ve günlük akış
├── state/                yayın geçmişi ve metrikler
└── cli/                  plan, doctor, insights, stats komutları
```

Ağ erişimi gerektirmeyen tüm mantık saf fonksiyonlarda tutuldu; test kapsamı bu katmanlarda (72 test).

İki GitHub Actions işi var ve ikisi de `state/posted.json`'a yazdığı için aynı eşzamanlılık grubunda tutulur — asla çakışmazlar:

| İş | Saat (TR) | Ne yapar |
|---|---|---|
| `daily-post.yml` | 20:00 | Gönderiyi üretir ve yayınlar |
| `collect-insights.yml` | Pazartesi 09:00 | Önceki gönderilerin metriklerini toplar |
