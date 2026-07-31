import Anthropic from '@anthropic-ai/sdk';
import { blogUrlsFromSitemap, fetchSitemap } from '../blog/sitemap.js';
import { fetchArticle } from '../blog/scraper.js';
import { toPostUnits } from '../blog/units.js';
import type { PostUnit } from '../blog/types.js';
import { assembleCaption, generateCaption } from '../caption/generator.js';
import { buildHashtags } from '../caption/hashtags.js';
import { composePostImage } from '../image/compose.js';
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
  readonly sourceImageUrl: string;
  readonly caption: string;
  readonly image: Buffer;
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
  const sitemap = await fetchSitemap(config.siteBaseUrl);
  const blogUrls = blogUrlsFromSitemap(sitemap, config.captionLocale);
  log(`Sitemap: ${blogUrls.length} blog yazisi`);

  const [articles, state] = await Promise.all([
    Promise.all(blogUrls.map((url) => fetchArticle(url))),
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

  const image = await composePostImage({
    heading: unit.heading,
    kicker: kickerFor(unit, topics[0]),
    imageUrl: choice.image.url,
  });
  log(`Gorsel uretildi: ${(image.length / 1024).toFixed(0)} KB`);

  if (config.dryRun) {
    return { unit, isRecycled, sourceImageUrl: choice.image.url, caption, image, published: null };
  }

  const instagram = new InstagramClient(config.instagram.igUserId, config.instagram.igAccessToken);

  const quota = await instagram.remainingQuota();
  if (quota !== null && quota <= 0) {
    throw new Error('Instagram gunluk yayin kotasi dolmus; bugun paylasim yapilmayacak.');
  }

  const fileName = `${new Date().toISOString().slice(0, 10)}-${unit.id.replace('#', '-')}.jpg`;
  const hosted = await hostImage(config.imageHost, fileName, image);
  log(`Gorsel yayinlandi: ${hosted.url}`);

  const published = await instagram.publishImage({ imageUrl: hosted.url, caption });
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
    }),
  );

  return { unit, isRecycled, sourceImageUrl: choice.image.url, caption, image, published };
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
