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

/** Bu pencere icinde kullanilmis bir gorsel, mumkunse tekrar secilmez. */
const RECENCY_WINDOW = 12;

export interface ImageChoice {
  readonly image: ArticleImage;
  /** Yazinin gorselleri arasindaki sirasi; gunluk kayitlarda faydali. */
  readonly position: number;
}

export function selectImage(unit: PostUnit, recentlyUsedUrls: readonly string[]): ImageChoice {
  const images = unit.images;

  if (images.length === 0) {
    throw new Error(`"${unit.articleSlug}" yazisinda kullanilabilir gorsel bulunamadi.`);
  }

  const recent = recentlyUsedUrls.slice(-RECENCY_WINDOW);

  // Giris bolumu kapak karesini alir; sonraki bolumler sirayla ilerler.
  const preferred = unit.sectionIndex % images.length;

  // Tercih edilen konumdan baslayip dairesel olarak ilk "taze" gorseli ara.
  for (let offset = 0; offset < images.length; offset++) {
    const position = (preferred + offset) % images.length;
    const image = images[position]!;

    if (!recent.includes(image.url)) {
      return { image, position };
    }
  }

  // Yazinin butun gorselleri yakin zamanda kullanilmis: en eskisine don.
  const oldest = images.reduce<{ image: ArticleImage; position: number; lastSeen: number }>(
    (best, image, position) => {
      const lastSeen = recent.lastIndexOf(image.url);
      return lastSeen < best.lastSeen ? { image, position, lastSeen } : best;
    },
    { image: images[0]!, position: 0, lastSeen: recent.lastIndexOf(images[0]!.url) },
  );

  return { image: oldest.image, position: oldest.position };
}
