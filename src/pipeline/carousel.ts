import Anthropic from '@anthropic-ai/sdk';
import { assembleCaption, joinBilingual } from '../caption/generator.js';
import { generateCarouselCaption } from '../caption/carousel.js';
import { buildHashtags } from '../caption/hashtags.js';
import { findFigures } from '../caption/figures.js';
import { detectTopics } from '../content/topics.js';
import { hostImage } from '../image/host.js';
import { InstagramClient } from '../instagram/client.js';
import { loadMedia } from '../lib/media.js';
import { loadPlannedPost, remainingDays } from '../plan/calendar.js';
import type { PlannedPost } from '../plan/calendar.js';
import { loadState, saveState, withPost } from '../state/store.js';
import type { Config } from '../config.js';

export const STATE_PATH = 'state/posted.json';

/** Takvim bu esigin altina inince uyarilir; yeni icerik hazirlamak zaman aliyor. */
const LOW_CALENDAR_WARNING = 7;

export interface CarouselResult {
  readonly post: PlannedPost;
  readonly caption: string;
  readonly published: { mediaId: string; permalink: string | null } | null;
}

type Logger = (message: string) => void;

/**
 * Icerik takviminden gunun carousel gonderisini yayinlar.
 *
 * Blog akisindan farki, neyin paylasilacagina modelin degil takvimin karar
 * vermesi. Model yalnizca KONU.md'deki brifingi caption'a ceviriyor; hangi
 * gorsel, hangi sirayla, hangi konu — hepsi klasorde yaziyor.
 *
 * O gune ait klasor yoksa null doner; cagiran taraf blog akisina duser.
 */
export async function runCarouselPost(
  config: Config,
  log: Logger,
  today = new Date().toISOString().slice(0, 10),
): Promise<CarouselResult | null> {
  const post = await loadPlannedPost(today);
  if (post === null) {
    log(`Takvimde ${today} icin klasor yok.`);
    return null;
  }

  const left = await remainingDays(today);
  log(`Takvim: ${post.project} — "${post.title}" (${post.images.length} gorsel)`);
  log(
    left > LOW_CALENDAR_WARNING
      ? `Takvimde ${left} gun icerik kaldi.`
      : `UYARI: takvimde yalnizca ${left} gun kaldi; yeni icerik hazirlanmali.`,
  );

  const topics = detectTopics(`${post.title} ${post.brief} ${post.point}`);
  const state = await loadState(STATE_PATH);
  const hashtags = buildHashtags(topics, state.posts.length);

  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  const body = await generateCarouselCaption(anthropic, post);
  const caption = assembleCaption(joinBilingual(body), config.siteBaseUrl, hashtags.text);

  /**
   * Fiyat ve sure bilgisi yayinlanmaz. Brifingler elle yazildigi icin risk
   * blog akisindakinden dusuk, ama bariyer yine de burada duruyor: kural
   * kaynaga degil yayina bagli.
   */
  const figures = findFigures(caption);
  if (figures.length > 0) {
    throw new Error(
      `Caption'da fiyat/sure bilgisi var, yayin yapilmadi:\n` +
        figures.map((f) => `  - ${f.reason}: "${f.match}"`).join('\n'),
    );
  }

  log(`Caption uretildi: ${caption.length} karakter, ${hashtags.tags.length} hashtag`);

  if (config.dryRun) return { post, caption, published: null };

  const instagram = new InstagramClient(config.instagram.igUserId, config.instagram.igAccessToken);

  const quota = await instagram.remainingQuota();
  if (quota !== null && quota <= 0) {
    throw new Error('Instagram gunluk yayin kotasi dolmus; bugun paylasim yapilmayacak.');
  }

  // Instagram gorseli PUBLIC bir URL'den ceker; once hepsini yayina acmak
  // gerekiyor. Sirayla: ayni anda 5 commit atmak GitHub'da catisma uretiyor.
  const urls: string[] = [];
  for (const [index, image] of post.images.entries()) {
    const fileName = `${today}-${String(index + 1).padStart(2, '0')}.jpg`;
    const jpeg = await toJpeg(image);
    const hosted = await hostImage(config.imageHost, fileName, jpeg);
    urls.push(hosted.url);
  }
  log(`${urls.length} gorsel yayina acildi`);

  const published = await instagram.publishCarousel({ imageUrls: urls, caption });
  log(`Instagram gonderisi yayinda: ${published.permalink ?? published.mediaId}`);

  await saveState(
    STATE_PATH,
    withPost(state, {
      unitId: `plan:${today}`,
      articleSlug: 'plan',
      heading: post.title,
      imageUrl: post.images[0]!,
      mediaId: published.mediaId,
      permalink: published.permalink,
      publishedAt: new Date().toISOString(),
      topics,
      hashtags: [...hashtags.tags],
      format: 'carousel',
      mediaUsed: [...post.images],
      insights: null,
    }),
  );

  return { post, caption, published };
}

/**
 * Instagram WebP kabul etmiyor; takvimdeki kareler JPEG'e ceviriliyor.
 * Yeniden boyutlandirma yok — senkron sirasinda zaten kucultuldu.
 */
async function toJpeg(path: string): Promise<Buffer> {
  const { default: sharp } = await import('sharp');
  return sharp(await loadMedia(path)).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}
