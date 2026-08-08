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

/**
 * Icerik takvimiyle ortusen kareler.
 *
 * Takvimdeki proje fotograflari havuzda da var — ayni cekim, farkli isim ve
 * kodlama. Dosya adi eslesmedigi icin tekrar onleme bunu goremiyor ve ayni
 * kare sabah carousel'inde, aksam reel'inde cikabiliyordu. Liste `plan:sync`
 * sirasinda algisal karsilastirmayla uretiliyor.
 */
const overlapPath = fileURLToPath(new URL('../../assets/plan/overlap.json', import.meta.url));

export async function loadPhotos(): Promise<Photo[]> {
  if (cached) return cached;

  const raw = await readFile(manifestPath, 'utf8');
  const all = manifestSchema.parse(JSON.parse(raw));

  // Takvim yoksa (ya da henuz senkronlanmadiysa) havuzun tamami kullanilir.
  const overlap = await readFile(overlapPath, 'utf8')
    .then((text) => new Set(z.array(z.string()).parse(JSON.parse(text))))
    .catch(() => new Set<string>());

  cached = all.filter((photo) => !overlap.has(photo.path));
  return cached;
}

/**
 * Reels 9:16 dikey kirpiyor ve uzerine hafif zoom uyguluyor; bunun icin
 * yaklasik 2150 piksel yukseklik gerekiyor. Sitedeki proje fotograflari
 * 1500 piksel, yani buyutme gerektiriyorlar. Tamamen elemek havuzu
 * gereksiz daraltirdi, bu yuzden kisa olanlar yalnizca geriye dusuruluyor:
 * once yeterince buyuk kareler kullaniliyor.
 */
const REEL_MIN_HEIGHT = 1500;

export interface SelectOptions {
  /** Reels icin: dusuk cozunurluklu kareler geriye dusurulur. */
  readonly preferTall?: boolean;
}

interface Ranked {
  readonly photo: Photo;
  readonly topic: number;
  readonly short: boolean;
  /** Kacinci sirada kullanildigi; hic kullanilmamissa -1. */
  readonly usedAt: number;
}

/**
 * Konuya uyan fotograflari secer.
 *
 * Iki kural bu fonksiyonun tamamini belirliyor:
 *
 * 1. BIR KEZ KULLANILAN KARE GERI GELMEZ. Once "son N gonderi" penceresi
 *    vardi ve tekrara yol acti: pencere kaydikca eski kareler yeniden
 *    aday oluyordu. 300 karelik havuzda pencereye gerek yok; kullanilmis
 *    olan tamamen eleniyor ve ancak havuz bitince geri aliniyor.
 *
 * 2. BIR REEL'DE AYNI PROJEDEN TEK KARE. Siralama esitliginde yola gore
 *    diziliyordu ve ayni galerinin ardisik dosyalari (g01, g02, g03, g04)
 *    tek videoya doluyordu; izleyen icin bu "ayni fotograf dort kez"
 *    demek. Cesitlilik ancak havuz zorlarsa gevsetiliyor.
 */
export function selectPhotos(
  photos: readonly Photo[],
  topics: readonly Topic[],
  count: number,
  usedPaths: readonly string[],
  options: SelectOptions = {},
): Photo[] {
  if (photos.length === 0) throw new Error('Fotograf havuzu bos (assets/photos/manifest.json).');

  const usedAt = new Map<string, number>();
  usedPaths.forEach((path, index) => usedAt.set(path, index));

  const ranked: Ranked[] = photos.map((photo) => ({
    photo,
    topic: topicScore(photo, topics),
    // Dikey videoda kisa kaynak buyutulmek zorunda kalir ve yumusar.
    short: options.preferTall === true && (photo.height ?? 0) < REEL_MIN_HEIGHT,
    usedAt: usedAt.get(photo.path) ?? -1,
  }));

  const fresh = ranked.filter((entry) => entry.usedAt === -1);
  const spent = ranked.filter((entry) => entry.usedAt !== -1);

  /**
   * Aday siralamasi, katman katman:
   *   1. konuya uyan taze kareler
   *   2. konusu uymayan taze kareler — gorselsiz reel uretmektense
   *      konusu zayif eslesen taze bir kare daha iyi
   *   3. havuz tukendiyse en uzun suredir kullanilmayanlar
   */
  const candidates = [
    ...byQuality(fresh.filter((entry) => entry.topic > 0)),
    ...byQuality(fresh.filter((entry) => entry.topic === 0)),
    ...[...spent].sort((a, b) => Number(a.short) - Number(b.short) || a.usedAt - b.usedAt),
  ];

  return pickDiverse(candidates, count).map((entry) => entry.photo);
}

/**
 * Havuzda daha once yayinlanmamis kac kare kaldigi.
 *
 * Tekrarsizlik havuzun buyuklugu kadar surer: reel basina 4, fotograf
 * gonderisinde 1 kare gidiyor. Sifira yaklastiginda havuza yeni fotograf
 * eklenmesi gerekiyor, bu yuzden her calistirmada raporlaniyor.
 */
export function freshCount(photos: readonly Photo[], usedPaths: readonly string[]): number {
  const used = new Set(usedPaths);
  return photos.filter((photo) => !used.has(photo.path)).length;
}

/** Metnin baskin konusu daha cok puan getirir; hic eslesme yoksa 0. */
function topicScore(photo: Photo, topics: readonly Topic[]): number {
  return photo.topics.reduce((sum, topic) => {
    const rank = topics.indexOf(topic as Topic);
    return rank === -1 ? sum : sum + (10 - Math.min(rank, 9));
  }, 0);
}

/** Once yeterince buyuk kareler, sonra konuya en cok uyan. Deterministik. */
function byQuality(entries: readonly Ranked[]): Ranked[] {
  return [...entries].sort(
    (a, b) =>
      Number(a.short) - Number(b.short) ||
      b.topic - a.topic ||
      a.photo.path.localeCompare(b.photo.path),
  );
}

/**
 * Siradan `count` kare secer, ayni projeden ikinciyi almadan.
 *
 * Havuz bu kadar farkli proje sunamiyorsa ikinci gecis kisiti gevsetir;
 * eksik kare birakmak yerine benzer iki kareyi kabul etmek daha iyi.
 */
function pickDiverse(candidates: readonly Ranked[], count: number): Ranked[] {
  const picked: Ranked[] = [];
  const seenProjects = new Set<string>();

  for (const entry of candidates) {
    if (picked.length >= count) break;
    // Projesi olmayan kareler elle secilmis tekil fotograflar; her biri
    // kendi basina bir "proje" sayilir ki birbirlerini elemesinler.
    const project = entry.photo.project ?? entry.photo.path;
    if (seenProjects.has(project)) continue;
    seenProjects.add(project);
    picked.push(entry);
  }

  for (const entry of candidates) {
    if (picked.length >= count) break;
    if (!picked.includes(entry)) picked.push(entry);
  }

  // Havuz istenen sayidan kucukse bastan dolanilir.
  const base = [...picked];
  while (picked.length < count && base.length > 0) {
    picked.push(base[picked.length % base.length]!);
  }

  return picked;
}
