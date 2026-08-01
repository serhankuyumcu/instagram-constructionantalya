import { loadEnvFile } from '../lib/env-file.js';
import {
  MIN_SAMPLE,
  engagementRateOf,
  groupBy,
  measurable,
  summarize,
  topPosts,
} from '../insights/report.js';
import type { Group } from '../insights/report.js';
import { STATE_PATH } from '../pipeline/run.js';
import { loadState } from '../state/store.js';
import type { PostRecord } from '../state/store.js';

/** Performans raporu. Veriyi `npm run insights` toplar, bu komut yalnizca okur. */
async function main(): Promise<void> {
  loadEnvFile();

  const state = await loadState(STATE_PATH);
  const posts = measurable(state.posts);

  console.log('\nPERFORMANS RAPORU\n');

  if (posts.length === 0) {
    console.log('  Henuz metrik toplanmamis.');
    console.log('  Gonderiler yayinlandiktan 24 saat sonra "npm run insights" ile toplanir.\n');
    return;
  }

  const overall = summarize(posts);
  console.log(`  Olculen gonderi : ${posts.length} / ${state.posts.length}`);
  console.log(`  Toplam erisim   : ${overall.reach.toLocaleString('tr-TR')}`);
  console.log(`  Toplam begeni   : ${overall.likes.toLocaleString('tr-TR')}`);
  console.log(`  Toplam kaydetme : ${overall.saved.toLocaleString('tr-TR')}`);
  console.log(`  Etkilesim orani : ${percent(overall.engagementRate)}`);

  if (posts.length < MIN_SAMPLE * 3) {
    console.log(`\n  NOT: Orneklem kucuk. Kirilimlar ~${MIN_SAMPLE * 3} gonderiden sonra anlam kazanir.`);
  }

  section('KONUYA GORE', groupBy(posts, (post) => post.topics));
  section('KAYNAK YAZIYA GORE', groupBy(posts, (post) => [post.articleSlug]));
  section('GORSELE GORE', groupBy(posts, (post) => [imageLabel(post)]));
  section('HASHTAG\'E GORE', groupBy(posts, (post) => post.hashtags), 12);

  console.log('\n  EN IYI GONDERILER\n');
  for (const post of topPosts(posts, 5)) {
    console.log(`    ${percent(engagementRateOf(post)).padStart(7)}  ${truncate(post.heading, 52)}`);
    console.log(`             erisim ${post.insights?.reach ?? 0} · ${post.permalink ?? post.mediaId}`);
  }
  console.log('');
}

function section(title: string, groups: readonly Group[], limit = 8): void {
  if (groups.length === 0) return;

  console.log(`\n  ${title}\n`);
  console.log(`    ${'anahtar'.padEnd(34)} ${'adet'.padStart(4)}  ${'erisim'.padStart(8)}  ${'etkilesim'.padStart(9)}`);

  for (const group of groups.slice(0, limit)) {
    // Guvenilmez satirlar isaretlenir; orneklem kucukken siralama gurultudur.
    const mark = group.isReliable ? ' ' : '*';
    const avgReach = group.count > 0 ? Math.round(group.reach / group.count) : 0;

    console.log(
      `  ${mark} ${truncate(group.key, 34).padEnd(34)} ${String(group.count).padStart(4)}  ${String(avgReach).padStart(8)}  ${percent(group.engagementRate).padStart(9)}`,
    );
  }

  if (groups.some((group) => !group.isReliable)) {
    console.log(`\n    * ${MIN_SAMPLE} gonderiden az — henuz guvenilir degil`);
  }
}

/** "/assets/blog/shell-1.webp" -> "blog/shell-1.webp" */
function imageLabel(post: PostRecord): string {
  return post.imageUrl.split('/assets/').at(-1) ?? post.imageUrl;
}

function percent(ratio: number | null): string {
  return ratio === null ? '-' : `%${(ratio * 100).toFixed(1)}`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

main().catch((error: unknown) => {
  console.error(`\nHATA: ${String(error)}\n`);
  process.exitCode = 1;
});
