import { blogUrlsFromSitemap, fetchSitemap } from '../blog/sitemap.js';
import { fetchArticle } from '../blog/scraper.js';
import { mapWithConcurrency } from '../lib/http.js';
import { toPostUnits } from '../blog/units.js';
import { buildHashtags } from '../caption/hashtags.js';
import { detectTopics } from '../content/topics.js';
import { selectImage } from '../image/select.js';
import { loadEnvFile } from '../lib/env-file.js';
import { STATE_PATH } from '../pipeline/run.js';
import { selectNextUnit } from '../pipeline/select-unit.js';
import { loadState, recentImageUrls, withPost } from '../state/store.js';
import type { State } from '../state/store.js';

/**
 * Yayin takvimi onizlemesi.
 *
 * Caption uretmeden (yani API maliyeti olmadan) siradaki gonderilerin
 * hangi bolumden gelecegini, hangi fotografi alacagini ve hangi hashtag
 * setini kullanacagini gosterir. Havuzun ne kadar dayanacagini gormek icin.
 */
async function main(): Promise<void> {
  loadEnvFile();

  const baseUrl = process.env.SITE_BASE_URL ?? 'https://constructionantalya.com';
  const locale = process.env.CAPTION_LOCALE ?? 'en';
  const days = Number.parseInt(process.argv[2] ?? '14', 10);

  const sitemap = await fetchSitemap(baseUrl);
  const blogUrls = blogUrlsFromSitemap(sitemap, locale);

  const [articles, initialState] = await Promise.all([
    mapWithConcurrency(blogUrls, (url) => fetchArticle(url)),
    loadState(STATE_PATH),
  ]);

  const units = articles.flatMap(toPostUnits);
  const imageCount = new Set(articles.flatMap((a) => a.images.map((i) => i.url))).size;

  console.log(`\nIcerik havuzu : ${units.length} bolum (${articles.length} yazi)`);
  console.log(`Gorsel havuzu : ${imageCount} benzersiz gorsel (yazilarin kendi sayfalarindan)`);
  console.log(`Yayinlanmis   : ${initialState.posts.length} gonderi`);
  console.log(`Kalan         : ${units.length - initialState.posts.length} gun tekrarsiz icerik\n`);
  console.log(`Siradaki ${days} gun:\n`);

  // Gecmisi ileri sararak takvimi simule ediyoruz; hicbir sey diske yazilmaz.
  let state: State = initialState;

  for (let day = 1; day <= days; day++) {
    const { unit, isRecycled } = selectNextUnit(units, state);
    const choice = selectImage(unit, recentImageUrls(state));
    const topics = detectTopics(`${unit.heading} ${unit.text}`);
    const hashtags = buildHashtags(topics, state.posts.length);

    const date = new Date(Date.now() + day * 86_400_000).toISOString().slice(0, 10);
    const flag = isRecycled ? ' [yeniden dolasim]' : '';

    console.log(`${date}${flag}`);
    console.log(`  Bolum   : ${unit.heading}`);
    console.log(`  Yazi    : ${unit.articleSlug}`);
    console.log(`  Konu    : ${topics.slice(0, 3).join(', ') || '-'}`);
    console.log(`  Gorsel  : ${choice.image.url.replace(baseUrl, '')}`);
    console.log(`  Hashtag : ${hashtags.tags.slice(0, 6).join(' ')} …\n`);

    state = withPost(state, {
      unitId: unit.id,
      articleSlug: unit.articleSlug,
      heading: unit.heading,
      imageUrl: choice.image.url,
      mediaId: `plan-${day}`,
      permalink: null,
      publishedAt: date,
      topics,
      hashtags: [...hashtags.tags],
      insights: null,
    });
  }
}

main().catch((error: unknown) => {
  console.error(`\nHATA: ${String(error)}\n`);
  process.exitCode = 1;
});
