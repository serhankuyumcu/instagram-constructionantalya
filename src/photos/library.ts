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
const RECENCY_WINDOW = 20;

/**
 * Konuya uyan fotograflari secer.
 *
 * Siralama: once konu eslesmesinin gucu, sonra yakin zamanda kullanilmamis
 * olma. Konu hic eslesmezse havuzun tamami aday olur; bir reel'in gorselsiz
 * kalmasindansa konusu zayif eslesen bir kare daha iyidir.
 */
export function selectPhotos(
  photos: readonly Photo[],
  topics: readonly Topic[],
  count: number,
  recentlyUsed: readonly string[],
): Photo[] {
  if (photos.length === 0) throw new Error('Fotograf havuzu bos (assets/photos/manifest.json).');

  const recent = recentlyUsed.slice(-RECENCY_WINDOW);

  const scored = photos.map((photo) => {
    // Metnin baskin konusu daha cok puan getirir.
    const topicScore = photo.topics.reduce((sum, topic) => {
      const rank = topics.indexOf(topic as Topic);
      return rank === -1 ? sum : sum + (10 - Math.min(rank, 9));
    }, 0);

    const recentIndex = recent.indexOf(photo.path);
    const penalty = recentIndex === -1 ? 0 : 100 - recentIndex;

    return { photo, score: topicScore - penalty };
  });

  // Esitlikte yola gore sirala: secim deterministik olsun, deneme
  // calistirmasi ile gercek yayin ayni sonucu versin.
  scored.sort((a, b) => b.score - a.score || a.photo.path.localeCompare(b.photo.path));

  const picked: Photo[] = [];
  for (const entry of scored) {
    if (picked.length >= count) break;
    picked.push(entry.photo);
  }

  // Havuz istenen sayidan kucukse bastan dolanilir.
  const base = [...picked];
  while (picked.length < count && base.length > 0) {
    picked.push(base[picked.length % base.length]!);
  }

  return picked;
}
