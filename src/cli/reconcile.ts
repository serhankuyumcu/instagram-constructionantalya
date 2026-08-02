import { blogUrlsFromSitemap, fetchSitemap } from '../blog/sitemap.js';
import { fetchArticle } from '../blog/scraper.js';
import { toPostUnits } from '../blog/units.js';
import { buildHashtags } from '../caption/hashtags.js';
import { detectTopics } from '../content/topics.js';
import { loadEnvFile } from '../lib/env-file.js';
import { mapWithConcurrency } from '../lib/http.js';
import { STATE_PATH } from '../pipeline/run.js';
import { loadState, saveState, withPost } from '../state/store.js';
import type { PostFormat } from '../pipeline/format.js';
import type { State } from '../state/store.js';

/**
 * Yayin gecmisini Instagram'daki gercek durumla esitler.
 *
 * Neden gerekli: gonderi Instagram'a cikip da durum dosyasi kaydedilemezse
 * (ornegin toplu calisma ortasinda dusen bir is akisi) bot o bolumleri
 * yayinlanmamis sayar ve tekrar paylasir. Bu komut, hesaptaki gonderileri
 * okuyup eksik kayitlari geri yazar.
 *
 * Kullanim:
 *   npm run reconcile -- <unitId>:<permalink> [...]
 *
 * Ornek:
 *   npm run reconcile -- the-art-of-the-finish#0:https://www.instagram.com/p/Dbh5lpBms11/
 */

const GRAPH_VERSION = process.env.GRAPH_API_VERSION ?? 'v21.0';

interface Media {
  readonly id: string;
  readonly permalink: string;
  readonly media_type: string;
  readonly timestamp: string;
}

async function fetchRecentMedia(userId: string, token: string): Promise<Media[]> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${userId}/media`);
  url.searchParams.set('fields', 'id,permalink,media_type,timestamp');
  url.searchParams.set('limit', '50');
  url.searchParams.set('access_token', token);

  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const data = (await response.json()) as { data?: Media[]; error?: { message?: string } };

  if (data.error) throw new Error(`Instagram: ${data.error.message}`);
  return data.data ?? [];
}

async function main(): Promise<void> {
  loadEnvFile();

  const userId = process.env.IG_USER_ID;
  const token = process.env.IG_ACCESS_TOKEN;
  if (!userId || !token) throw new Error('IG_USER_ID ve IG_ACCESS_TOKEN gerekli.');

  const pairs = process.argv.slice(2).filter((arg) => arg.includes(':http'));
  if (pairs.length === 0) {
    console.error('\nKullanim: npm run reconcile -- <unitId>:<permalink> [...]\n');
    process.exitCode = 1;
    return;
  }

  console.log('\nYAYIN GECMISINI ESITLE\n');

  const [media, state, sitemap] = await Promise.all([
    fetchRecentMedia(userId, token),
    loadState(STATE_PATH),
    fetchSitemap(process.env.SITE_BASE_URL ?? 'https://constructionantalya.com'),
  ]);

  const articles = await mapWithConcurrency(
    blogUrlsFromSitemap(sitemap, process.env.CAPTION_LOCALE ?? 'en'),
    (url) => fetchArticle(url),
  );
  const units = new Map(articles.flatMap(toPostUnits).map((unit) => [unit.id, unit]));

  console.log(`  Hesaptaki gonderi : ${media.length}`);
  console.log(`  Kayitli gonderi   : ${state.posts.length}`);
  console.log(`  Eklenecek         : ${pairs.length}\n`);

  let updated: State = state;

  for (const pair of pairs) {
    const splitAt = pair.indexOf(':http');
    const unitId = pair.slice(0, splitAt);
    const permalink = pair.slice(splitAt + 1).replace(/\/$/, '');

    if (updated.posts.some((post) => post.unitId === unitId)) {
      console.log(`  - ${unitId} zaten kayitli, atlandi`);
      continue;
    }

    const unit = units.get(unitId);
    if (!unit) {
      console.log(`  ✗ ${unitId} icerik havuzunda bulunamadi`);
      continue;
    }

    const found = media.find((m) => m.permalink.replace(/\/$/, '') === permalink);
    if (!found) {
      console.log(`  ✗ ${unitId} icin hesapta bu permalink yok: ${permalink}`);
      continue;
    }

    // Konu ve hashtag yayin anindaki degerlerle ayni sekilde yeniden uretilir:
    // hashtag rotasyonu o anki gonderi sayisina bagli oldugu icin kayitlari
    // sirayla eklemek sart.
    const topics = detectTopics(`${unit.heading} ${unit.text}`);
    const hashtags = buildHashtags(topics, updated.posts.length);
    const format: PostFormat = found.media_type === 'VIDEO' ? 'reel' : 'image';

    updated = withPost(updated, {
      unitId: unit.id,
      articleSlug: unit.articleSlug,
      heading: unit.heading,
      imageUrl: unit.images[0]?.url ?? '',
      mediaId: found.id,
      permalink: found.permalink,
      publishedAt: found.timestamp,
      topics,
      hashtags: [...hashtags.tags],
      format,
      insights: null,
    });

    console.log(`  ✓ ${unitId.padEnd(46)} ${format.padEnd(5)} ${found.id}`);
  }

  await saveState(STATE_PATH, updated);
  console.log(`\n  Kayitli gonderi: ${state.posts.length} -> ${updated.posts.length}\n`);
}

main().catch((error: unknown) => {
  console.error(`\nHATA: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
