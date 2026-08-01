import { formatConfigError } from '../config.js';
import { InsightsClient, shouldCollect } from '../instagram/insights.js';
import { loadEnvFile } from '../lib/env-file.js';
import { STATE_PATH } from '../pipeline/run.js';
import { loadState, saveState, withInsights } from '../state/store.js';
import type { State } from '../state/store.js';

/**
 * Yayinlanmis gonderilerin Instagram metriklerini toplar.
 *
 * Gunluk gonderi isinden ayri calisir: metrikler yayin aninda bos oldugu
 * icin ayni akista toplanamaz. Her calismada son bir aylik gonderiler
 * tazelenir, daha eskiler yalnizca hic verisi yoksa cekilir.
 */
async function main(): Promise<void> {
  loadEnvFile();

  const token = process.env.IG_ACCESS_TOKEN?.trim();
  if (!token) throw new Error('IG_ACCESS_TOKEN gerekli.');

  const state = await loadState(STATE_PATH);

  if (state.posts.length === 0) {
    console.log('\nHenuz yayinlanmis gonderi yok.\n');
    return;
  }

  const targets = state.posts.filter((post) => shouldCollect(post.publishedAt, post.insights !== null));

  console.log(`\nINSIGHTS TOPLAMA\n`);
  console.log(`  Toplam gonderi : ${state.posts.length}`);
  console.log(`  Sorgulanacak   : ${targets.length}`);

  if (targets.length === 0) {
    console.log('\n  Guncellenecek gonderi yok (hepsi 24 saatten yeni).\n');
    return;
  }

  const client = new InsightsClient(token);
  let updated: State = state;
  let ok = 0;
  let failed = 0;

  for (const post of targets) {
    const insights = await client.fetchForMedia(post.mediaId);

    if (insights === null) {
      failed++;
      console.log(`  ✗ ${post.unitId} — metrik alinamadi (silinmis olabilir)`);
      continue;
    }

    updated = withInsights(updated, post.mediaId, insights);
    ok++;

    const parts = [
      insights.reach !== null ? `erisim ${insights.reach}` : null,
      insights.likes !== null ? `begeni ${insights.likes}` : null,
      insights.saved !== null ? `kaydetme ${insights.saved}` : null,
    ].filter(Boolean);

    console.log(`  ✓ ${post.unitId} — ${parts.join(', ') || 'veri bos'}`);
  }

  await saveState(STATE_PATH, updated);

  console.log(`\n  Guncellendi: ${ok} | Alinamadi: ${failed}\n`);
}

main().catch((error: unknown) => {
  console.error(`\nHATA: ${formatConfigError(error)}\n`);
  process.exitCode = 1;
});
