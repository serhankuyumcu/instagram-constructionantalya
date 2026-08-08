import Anthropic from '@anthropic-ai/sdk';
import { blogUrlsFromSitemap, fetchSitemap } from '../blog/sitemap.js';
import { fetchArticle } from '../blog/scraper.js';
import { mapWithConcurrency } from '../lib/http.js';
import { toPostUnits } from '../blog/units.js';
import type { PostUnit } from '../blog/types.js';
import { assembleCaption, generateCaption, joinBilingual } from '../caption/generator.js';
import { buildHashtags } from '../caption/hashtags.js';
import { findFigures } from '../caption/figures.js';
import { composePostImage } from '../image/compose.js';
import { composeTipReel } from '../video/compose.js';
import { generateTip } from '../caption/tip.js';
import { freshCount, loadPhotos, selectPhotos } from '../photos/library.js';
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

  // Simdiye kadar yayinlanmis butun kareler. Hem yazi gorselleri hem proje
  // fotograflari ayni listeden eleniyor: bir kare bir kez yayinlanir.
  const usedMedia = recentImageUrls(state);

  const photoPool = await loadPhotos();
  const fresh = freshCount(photoPool, usedMedia);
  log(
    fresh > 40
      ? `Fotograf havuzu: ${fresh}/${photoPool.length} kare hic kullanilmamis`
      : `UYARI: fotograf havuzunda yalnizca ${fresh} taze kare kaldi; yenisi eklenmezse gorseller tekrar etmeye baslayacak.`,
  );

  const choice = selectImage(unit, usedMedia);
  const topics = detectTopics(`${unit.heading} ${unit.text}`);
  const hashtags = buildHashtags(topics, state.posts.length);

  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

  /**
   * Reels ve fotograf farkli metin uretiyor.
   *
   * Reels "tip" formatinda: tek bir somut teknik gercek, kanca ile aciliyor.
   * Kanca, ekran satirlari ve caption tek cagrida uretiliyor; ucu birbirine
   * bagli oldugu icin ayirmak hem tutarsizlik hem iki kat maliyet olurdu.
   */
  let caption: string;
  let media: Buffer;
  /** Gonderide kullanilan tum gorseller; tekrar onleme bunlarin uzerinden yurur. */
  let mediaUsed: string[] = [];

  if (format === 'reel') {
    const tip = await generateTip(anthropic, unit);
    caption = assembleCaption(
      joinBilingual({ english: tip.caption, russian: tip.captionRu }),
      unit.articleUrl,
      hashtags.text,
    );
    log(`Tip uretildi: "${tip.hook}"`);

    // Reels elle secilmis fotograf havuzundan beslenir. Yazinin kendi
    // gorselleri 4-6 taneydi ve reel 4 kare istedigi icin ayni yazidan
    // cikan videolar hep ayni fotograflari gosteriyordu.
    const photos = selectPhotos(photoPool, topics, 4, usedMedia, { preferTall: true });
    mediaUsed = photos.map((p) => p.path);
    log(`Fotograflar: ${photos.map((p) => p.path.split('/').pop()).join(', ')}`);

    media = await composeTipReel({
      hook: tip.hook,
      lines: tip.lines,
      imageUrls: mediaUsed,
    });
  } else {
    const body = await generateCaption(anthropic, { unit, locale: config.captionLocale });
    caption = assembleCaption(joinBilingual(body), unit.articleUrl, hashtags.text);

    /**
     * Gorsel oncelikle yazinin kendi sayfasindan gelir; editoryal bagi en
     * guclu kuran sey bu. Ama bir yazida ~5 gorsel, ~10 bolum var: bolumler
     * ilerledikce yazinin kareleri tukeniyor. O noktada ayni kareyi ikinci
     * kez yayinlamak yerine konusu eslesen taze bir proje fotografi
     * kullaniliyor.
     */
    const imageUrl = choice.isFresh
      ? choice.image.url
      : selectPhotos(photoPool, topics, 1, usedMedia)[0]!.path;

    mediaUsed = [imageUrl];
    log(
      choice.isFresh
        ? `Secilen gorsel: ${imageUrl.split('/').slice(-2).join('/')} (yazinin ${choice.position + 1}. gorseli)`
        : `Yazinin gorselleri tukendi; havuzdan: ${imageUrl.split('/').pop()}`,
    );

    media = await composePostImage({
      heading: unit.heading,
      kicker: kickerFor(unit, topics[0]),
      imageUrl,
    });
  }

  /**
   * Fiyat ve sure bilgisi yayinlanmaz. Prompt bunu zaten yasakliyor ama
   * kaynak yazilarin bazilari bastan sona takvim anlatiyor ve model
   * oradan aliyor; asil bariyer burasi.
   */
  const figures = findFigures(caption);
  if (figures.length > 0) {
    throw new Error(
      `Caption'da fiyat/sure bilgisi var, yayin yapilmadi:\n` +
        figures.map((f) => `  - ${f.reason}: "${f.match}"`).join('\n'),
    );
  }

  log(`Caption uretildi: ${caption.length} karakter, ${hashtags.tags.length} hashtag`);

  log(
    format === 'reel'
      ? `Video uretildi: ${(media.length / 1048576).toFixed(1)} MB`
      : `Gorsel uretildi: ${(media.length / 1024).toFixed(0)} KB`,
  );

  if (config.dryRun) {
    return { unit, isRecycled, format, sourceImageUrl: mediaUsed[0]!, caption, media, published: null };
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
      imageUrl: mediaUsed[0]!,
      mediaId: published.mediaId,
      permalink: published.permalink,
      publishedAt: new Date().toISOString(),
      // Rapor kirilimlari icin: sonradan yeniden hesaplanamazlar.
      topics,
      hashtags: [...hashtags.tags],
      format,
      mediaUsed,
      insights: null,
    }),
  );

  return { unit, isRecycled, format, sourceImageUrl: mediaUsed[0]!, caption, media, published };
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
