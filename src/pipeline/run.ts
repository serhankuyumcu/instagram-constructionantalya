import Anthropic from '@anthropic-ai/sdk';
import { blogUrlsFromSitemap, fetchSitemap } from '../blog/sitemap.js';
import { fetchArticle } from '../blog/scraper.js';
import { mapWithConcurrency } from '../lib/http.js';
import { toPostUnits } from '../blog/units.js';
import type { PostUnit } from '../blog/types.js';
import { assembleCaption, generateCaption } from '../caption/generator.js';
import { buildHashtags } from '../caption/hashtags.js';
import { composePostImage } from '../image/compose.js';
import { composeReel } from '../video/compose.js';
import { resolveFormat } from './format.js';
import type { PostFormat } from './format.js';
import { selectImage } from '../image/select.js';
import { detectTopics } from '../content/topics.js';
import { hostImage } from '../image/host.js';
import { InstagramClient } from '../instagram/client.js';
import { loadState, recentImageUrls, saveState, withPost } from '../state/store.js';
import { selectNextUnit } from './select-unit.js';
import type { Config } from '../config.js';

export const STATE_PATH = 'state/posted.json';

export interface RunResult {
  readonly unit: PostUnit;
  readonly isRecycled: boolean;
  readonly format: PostFormat;
  readonly sourceImageUrl: string;
  readonly caption: string;
  /** Fotograf gonderisinde JPEG, reel'de MP4. */
  readonly media: Buffer;
  readonly published: { mediaId: string; permalink: string | null } | null;
}

type Logger = (message: string) => void;

/**
 * Gunluk gonderi akisi.
 *
 * Sira: icerik havuzunu kur -> siradaki bolumu sec -> ona uygun proje
 * fotografini bul -> kareyi uret -> caption yaz -> yayinla -> gecmise isle.
 */
export async function runDailyPost(config: Config, log: Logger): Promise<RunResult> {
  const format = resolveFormat(process.argv);
  log(`Gonderi bicimi: ${format === 'reel' ? 'Reels (video)' : 'fotograf'}`);

  const sitemap = await fetchSitemap(config.siteBaseUrl);
  const blogUrls = blogUrlsFromSitemap(sitemap, config.captionLocale);
  log(`Sitemap: ${blogUrls.length} blog yazisi`);

  const [articles, state] = await Promise.all([
    mapWithConcurrency(blogUrls, (url) => fetchArticle(url)),
    loadState(STATE_PATH),
  ]);

  const units = articles.flatMap(toPostUnits);
  const imageCount = new Set(articles.flatMap((a) => a.images.map((i) => i.url))).size;
  log(`Icerik havuzu: ${units.length} bolum | Yazi gorselleri: ${imageCount} benzersiz`);
  log(`Gecmis: ${state.posts.length} gonderi yayinlanmis`);

  const { unit, isRecycled } = selectNextUnit(units, state);
  log(`Secilen bolum: ${unit.id} — "${unit.heading}"${isRecycled ? ' (havuz tukendi, yeniden dolasim)' : ''}`);

  const choice = selectImage(unit, recentImageUrls(state));
  log(`Secilen gorsel: ${choice.image.url.split('/').slice(-2).join('/')} (yazinin ${choice.position + 1}. gorseli)`);

  const topics = detectTopics(`${unit.heading} ${unit.text}`);
  const hashtags = buildHashtags(topics, state.posts.length);

  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  const body = await generateCaption(anthropic, { unit, locale: config.captionLocale });
  const caption = assembleCaption(body, unit.articleUrl, hashtags.text);
  log(`Caption uretildi: ${caption.length} karakter, ${hashtags.tags.length} hashtag`);

  const kicker = kickerFor(unit, topics[0]);

  // Reels icin yazinin birden fazla gorseline ihtiyac var; secilen kare basa
  // alinip yazinin diger kareleri ardina eklenir. Havuz darsa bastan dolanir.
  const media =
    format === 'reel'
      ? await composeReel({ heading: unit.heading, kicker, imageUrls: reelImages(unit, choice.image.url) })
      : await composePostImage({ heading: unit.heading, kicker, imageUrl: choice.image.url });

  log(
    format === 'reel'
      ? `Video uretildi: ${(media.length / 1048576).toFixed(1)} MB`
      : `Gorsel uretildi: ${(media.length / 1024).toFixed(0)} KB`,
  );

  if (config.dryRun) {
    return { unit, isRecycled, format, sourceImageUrl: choice.image.url, caption, media, published: null };
  }

  const instagram = new InstagramClient(config.instagram.igUserId, config.instagram.igAccessToken);

  const quota = await instagram.remainingQuota();
  if (quota !== null && quota <= 0) {
    throw new Error('Instagram gunluk yayin kotasi dolmus; bugun paylasim yapilmayacak.');
  }

  const extension = format === 'reel' ? 'mp4' : 'jpg';
  const fileName = `${new Date().toISOString().slice(0, 10)}-${unit.id.replace('#', '-')}.${extension}`;
  const hosted = await hostImage(config.imageHost, fileName, media);
  log(`Medya yayinlandi: ${hosted.url}`);

  const published =
    format === 'reel'
      ? await instagram.publishReel({ videoUrl: hosted.url, caption })
      : await instagram.publishImage({ imageUrl: hosted.url, caption });
  log(`Instagram gonderisi yayinda: ${published.permalink ?? published.mediaId}`);

  await saveState(
    STATE_PATH,
    withPost(state, {
      unitId: unit.id,
      articleSlug: unit.articleSlug,
      heading: unit.heading,
      imageUrl: choice.image.url,
      mediaId: published.mediaId,
      permalink: published.permalink,
      publishedAt: new Date().toISOString(),
      // Rapor kirilimlari icin: sonradan yeniden hesaplanamazlar.
      topics,
      hashtags: [...hashtags.tags],
      format,
      insights: null,
    }),
  );

  return { unit, isRecycled, format, sourceImageUrl: choice.image.url, caption, media, published };
}

/**
 * Reels icin gorsel dizisi: secilen kare basa alinir, yazinin kalan
 * kareleri ardina eklenir. Yazida yeterli gorsel yoksa bastan dolanilir.
 */
function reelImages(unit: PostUnit, firstUrl: string, count = 4): string[] {
  const pool = [firstUrl, ...unit.images.map((image) => image.url).filter((url) => url !== firstUrl)];
  return Array.from({ length: count }, (_, index) => pool[index % pool.length]!);
}

/** Gorselin ust satirindaki kucuk etiket: once konu, yoksa yazinin adi. */
function kickerFor(unit: PostUnit, topic: string | undefined): string {
  const labels: Record<string, string> = {
    hotel: 'Hospitality',
    villa: 'Villa Construction',
    residential: 'Residential',
    shell: 'Shell Construction',
    finishing: 'The Finish',
    exterior: 'Exterior',
    interior: 'Interiors',
    pool: 'Pool & Spa',
    sustainability: 'Sustainable Building',
  };

  return topic ? (labels[topic] ?? 'Insight') : truncateWords(unit.articleTitle, 4);
}

function truncateWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  return words.length <= maxWords ? text : `${words.slice(0, maxWords).join(' ')}…`;
}
