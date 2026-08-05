import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

/**
 * Yayin gecmisi. Repo'ya commit edilir; botun "hafizasi" budur.
 *
 * Bu dosya olmadan bot her calistiginda ayni ilk bolumu paylasir. Ayrica
 * gorsel tekrarini onlemek ve hashtag rotasyonunu ilerletmek icin de
 * gecmisteki kayitlara bakilir.
 */

/**
 * Bir gonderinin Instagram'daki performansi. Yayin aninda bos olur;
 * insights toplama isi sonraki gunlerde doldurur ve gunceller.
 */
const insightsSchema = z.object({
  reach: z.number().nullable().default(null),
  likes: z.number().nullable().default(null),
  comments: z.number().nullable().default(null),
  saved: z.number().nullable().default(null),
  shares: z.number().nullable().default(null),
  totalInteractions: z.number().nullable().default(null),
  collectedAt: z.string(),
});

const recordSchema = z.object({
  unitId: z.string(),
  articleSlug: z.string(),
  heading: z.string(),
  imageUrl: z.string(),
  mediaId: z.string(),
  permalink: z.string().nullable().default(null),
  publishedAt: z.string(),

  /**
   * Rapor kirilimlari icin yayin anindaki kararlar. Sonradan yeniden
   * hesaplanamazlar (hashtag rotasyonu gecmise bagli, konu tespiti kod
   * degisirse farkli sonuc verir), bu yuzden o an kaydedilirler.
   *
   * Varsayilanlari bos: bu alanlar eklenmeden once yazilmis kayitlar
   * gecerliligini korur.
   */
  topics: z.array(z.string()).default([]),
  hashtags: z.array(z.string()).default([]),

  /** Gonderi bicimi. Eski kayitlarda yok; hepsi fotograf gonderisiydi. */
  format: z.enum(['image', 'reel']).default('image'),

  /**
   * Gonderide kullanilan TUM gorseller.
   *
   * Yalnizca imageUrl kaydetmek yetmiyordu: bir reel dort fotograf
   * kullaniyor ama kayda biri giriyordu, kalan uc kare tekrar onleyiciye
   * hic gorunmuyor ve surekli yeniden seciliyordu. Tekrar sikayetinin
   * kok sebebi buydu.
   */
  mediaUsed: z.array(z.string()).default([]),

  insights: insightsSchema.nullable().default(null),
});

const stateSchema = z.object({
  posts: z.array(recordSchema).default([]),
});

export type PostInsights = z.infer<typeof insightsSchema>;
export type PostRecord = z.infer<typeof recordSchema>;
export type State = z.infer<typeof stateSchema>;

const EMPTY_STATE: State = { posts: [] };

export async function loadState(path: string): Promise<State> {
  try {
    const raw = await readFile(path, 'utf8');
    return stateSchema.parse(JSON.parse(raw));
  } catch (error) {
    // Ilk calistirmada dosya yoktur; bu bir hata degil.
    if (isNotFound(error)) return EMPTY_STATE;
    throw new Error(`Durum dosyasi okunamadi (${path}): ${String(error)}`);
  }
}

/** Kayitlar degistirilmez; her yayin yeni bir state nesnesi uretir. */
export function withPost(state: State, record: PostRecord): State {
  return { posts: [...state.posts, record] };
}

export async function saveState(path: string, state: State): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/** Bir gonderinin performans verisini gunceller; digerlerine dokunmaz. */
export function withInsights(state: State, mediaId: string, insights: PostInsights): State {
  return {
    posts: state.posts.map((post) => (post.mediaId === mediaId ? { ...post, insights } : post)),
  };
}

export function postedUnitIds(state: State): Set<string> {
  return new Set(state.posts.map((post) => post.unitId));
}

/**
 * Yakin zamanda kullanilan tum gorseller, eskiden yeniye.
 * Eski kayitlarda mediaUsed yok; onlarda imageUrl'e duseriz.
 */
export function recentImageUrls(state: State): string[] {
  return state.posts.flatMap((post) =>
    post.mediaUsed.length > 0 ? post.mediaUsed : [post.imageUrl],
  );
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';
}
