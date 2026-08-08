import type { ArticleImage, PostUnit } from '../blog/types.js';

/**
 * Gonderi gorselinin secimi.
 *
 * Gorsel daima yazinin KENDI sayfasindan gelir: yazi hangi kareleri secmisse
 * gonderi de onlari kullanir. Bu, konu tahminine dayali eslestirmeden daha
 * guvenilir bir editoryal baglanti kurar.
 *
 * Bir yazida ortalama bes gorsel, on kadar bolum var. Bu yuzden gorseller
 * bolumler arasinda donusumlu dagitilir ve son gonderilerde kullanilmis
 * olanlar mumkun oldugunca atlanir.
 */

export interface ImageChoice {
  readonly image: ArticleImage;
  /** Yazinin gorselleri arasindaki sirasi; gunluk kayitlarda faydali. */
  readonly position: number;
  /** false ise bu kare daha once yayinlanmis; cagiran taraf havuza dusmeli. */
  readonly isFresh: boolean;
}

/**
 * Yazinin kendi gorselleri arasindan daha once yayinlanmamis olani secer.
 *
 * Onceden "son 12 gonderi" penceresi vardi ve iki nedenle yetersizdi:
 * pencere kaydikca eski kareler geri geliyordu, ve reel'ler tek gonderide
 * 4 kare harcadigi icin pencerenin uctan fazlasi bir videoya gidiyordu —
 * fotograf gonderileri icin gercek hafiza uc dorde dusmustu.
 *
 * Artik pencere yok: bir kez yayinlanan kare bir daha secilmez. Bir yazinin
 * tum gorselleri tukendiginde `isFresh: false` donuyor; cagiran taraf o
 * durumda proje fotograf havuzuna dusuyor.
 */
export function selectImage(unit: PostUnit, usedUrls: readonly string[]): ImageChoice {
  const images = unit.images;

  if (images.length === 0) {
    throw new Error(`"${unit.articleSlug}" yazisinda kullanilabilir gorsel bulunamadi.`);
  }

  const usedAt = new Map<string, number>();
  usedUrls.forEach((url, index) => usedAt.set(url, index));

  // Giris bolumu kapak karesini alir; sonraki bolumler sirayla ilerler.
  const preferred = unit.sectionIndex % images.length;

  // Tercih edilen konumdan baslayip dairesel olarak ilk "taze" gorseli ara.
  for (let offset = 0; offset < images.length; offset++) {
    const position = (preferred + offset) % images.length;
    const image = images[position]!;

    if (!usedAt.has(image.url)) {
      return { image, position, isFresh: true };
    }
  }

  // Yazinin butun gorselleri kullanilmis: en eskisini isaretleyip dondur.
  const oldest = images.reduce<{ image: ArticleImage; position: number; usedAt: number }>(
    (best, image, position) => {
      const seen = usedAt.get(image.url) ?? -1;
      return seen < best.usedAt ? { image, position, usedAt: seen } : best;
    },
    { image: images[0]!, position: 0, usedAt: usedAt.get(images[0]!.url) ?? -1 },
  );

  return { image: oldest.image, position: oldest.position, isFresh: false };
}
