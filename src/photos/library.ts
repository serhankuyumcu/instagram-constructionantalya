import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Topic } from '../content/topics.js';

/**
 * Elle secilmis fotograf havuzu.
 *
 * Reels bu havuzdan beslenir. Onceki durumda kareler yazinin kendi
 * gorsellerinden geliyordu; bir yazida 4-6 gorsel oldugu ve reel 4 kare
 * istedigi icin ayni yazidan cikan videolar hep ayni fotograflari
 * gosteriyordu.
 *
 * Konu etiketleri elle atandi: dosya adlari (pexels-<fotografci>-<id>)
 * icerik hakkinda hicbir sey soylemiyor, otomatik cikarim mumkun degil.
 * Yeni fotograf eklenince manifest.json guncellenmelidir.
 */

const entrySchema = z.object({
  path: z.string(),
  topics: z.array(z.string()),
  orientation: z.enum(['landscape', 'portrait']),
  width: z.number().optional(),
  height: z.number().optional(),
  project: z.string().optional(),
});

const manifestSchema = z.array(entrySchema);

export type Photo = z.infer<typeof entrySchema>;

const manifestPath = fileURLToPath(new URL('../../assets/photos/manifest.json', import.meta.url));

let cached: Photo[] | null = null;

export async function loadPhotos(): Promise<Photo[]> {
  if (cached) return cached;

  const raw = await readFile(manifestPath, 'utf8');
  cached = manifestSchema.parse(JSON.parse(raw));
  return cached;
}

/** Son N gonderide kullanilan fotograflar mumkunse tekrar secilmez. */
const RECENCY_WINDOW = 40;

/**
 * Reels 9:16 dikey kirpiyor ve uzerine hafif zoom uyguluyor; bunun icin
 * yaklasik 2150 piksel yukseklik gerekiyor. Sitedeki proje fotograflari
 * 1500 piksel, yani buyutme gerektiriyorlar. Tamamen elemek havuzu
 * gereksiz daraltirdi, bu yuzden kisa olanlar yalnizca geriye dusuruluyor:
 * once yeterince buyuk kareler kullaniliyor.
 */
const REEL_MIN_HEIGHT = 1500;

/**
 * Konuya uyan fotograflari secer.
 *
 * Siralama: once konu eslesmesinin gucu, sonra yakin zamanda kullanilmamis
 * olma. Konu hic eslesmezse havuzun tamami aday olur; bir reel'in gorselsiz
 * kalmasindansa konusu zayif eslesen bir kare daha iyidir.
 */
export interface SelectOptions {
  /** Reels icin: dusuk cozunurluklu kareler geriye dusurulur. */
  readonly preferTall?: boolean;
}

export function selectPhotos(
  photos: readonly Photo[],
  topics: readonly Topic[],
  count: number,
  recentlyUsed: readonly string[],
  options: SelectOptions = {},
): Photo[] {
  if (photos.length === 0) throw new Error('Fotograf havuzu bos (assets/photos/manifest.json).');

  // Her fotografin en son kacinci gonderide kullanildigi. Hic kullanilmamis
  // olanlar -1 alir ve her zaman once gelir.
  const lastUsed = new Map<string, number>();
  recentlyUsed.forEach((path, index) => lastUsed.set(path, index));

  const topicScore = (photo: Photo): number =>
    photo.topics.reduce((sum, topic) => {
      const rank = topics.indexOf(topic as Topic);
      return rank === -1 ? sum : sum + (10 - Math.min(rank, 9));
    }, 0);

  const scored = photos.map((photo) => ({
    photo,
    topic: topicScore(photo),
    // Dikey videoda kisa kaynak buyutulmek zorunda kalir ve yumusar.
    short: options.preferTall === true && (photo.height ?? 0) < REEL_MIN_HEIGHT,
    lastUsed: lastUsed.get(photo.path) ?? -1,
  }));

  // Konuya uyan kare varsa yalnizca onlar aday; hicbiri uymuyorsa havuzun
  // tamami aday olur. Gorselsiz reel uretmektense konusu zayif eslesen bir
  // kare daha iyidir.
  const matching = scored.filter((entry) => entry.topic > 0);
  const pool = matching.length >= count ? matching : scored;

  /**
   * Siralama onceligi: once hic kullanilmamislar, sonra en uzun suredir
   * kullanilmayanlar. Konu puani bundan sonra geliyor.
   *
   * Tersi denendi ve tekrara yol acti: konu puani basta oldugunda ayni
   * yuksek puanli kareler, tekrar penceresi gecer gecmez geri geliyordu.
   * Havuzda taze kare varken kullanilmisa donmek dogru degil.
   */
  const sorted = [...pool].sort((a, b) => {
    if (a.short !== b.short) return a.short ? 1 : -1;
    if (a.lastUsed !== b.lastUsed) return a.lastUsed - b.lastUsed;
    if (a.topic !== b.topic) return b.topic - a.topic;
    return a.photo.path.localeCompare(b.photo.path);
  });

  const picked = sorted.slice(0, count).map((entry) => entry.photo);

  // Havuz istenen sayidan kucukse bastan dolanilir.
  const base = [...picked];
  while (picked.length < count && base.length > 0) {
    picked.push(base[picked.length % base.length]!);
  }

  return picked;
}
