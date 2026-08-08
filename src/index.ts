import { mkdir, writeFile } from 'node:fs/promises';
import { formatConfigError, loadConfig } from './config.js';
import { loadEnvFile } from './lib/env-file.js';
import { runDailyPost } from './pipeline/run.js';
import { runCarouselPost } from './pipeline/carousel.js';
import type { CarouselResult } from './pipeline/carousel.js';
import { resolveFormat } from './pipeline/format.js';

const DRY_RUN_DIR = 'out';

async function reportCarousel(result: CarouselResult, dryRun: boolean): Promise<void> {
  if (!dryRun) {
    console.log(`\nYayinlandi: ${result.published?.permalink ?? result.published?.mediaId}\n`);
    return;
  }

  await mkdir(DRY_RUN_DIR, { recursive: true });
  const file = `${DRY_RUN_DIR}/${result.post.date}-carousel.txt`;
  await writeFile(file, result.caption, 'utf8');

  console.log('\n──────── CAPTION ────────\n');
  console.log(result.caption);
  console.log('\n─────────────────────────\n');
  console.log(`Konu   : ${result.post.project} — ${result.post.title}`);
  console.log(`Gorsel : ${result.post.images.length} kare`);
  result.post.images.forEach((image, i) => console.log(`  ${i + 1}. ${image.split('/').pop()}`));
  console.log(`Caption: ${file}\n`);
}

async function main(): Promise<void> {
  loadEnvFile();

  const dryRun = process.argv.includes('--dry-run');
  const log = (message: string): void => console.log(`  ${message}`);

  const config = loadConfig(process.env, dryRun);

  console.log(dryRun ? '\nDENEME MODU — hicbir sey yayinlanmayacak\n' : '\nGUNLUK INSTAGRAM GONDERISI\n');

  /**
   * Sabah gonderisi icerik takviminden gelir. Takvimde o gune ait klasor
   * yoksa blog akisina dusuluyor: takvim bittiginde ya da bir gun atlandiginda
   * profilin sessiz kalmamasi icin.
   */
  if (resolveFormat(process.argv) === 'carousel') {
    const carousel = await runCarouselPost(config, log);
    if (carousel !== null) return await reportCarousel(carousel, dryRun);
    log('Blog akisina dusuluyor.');
  }

  const result = await runDailyPost(config, log);

  if (!dryRun) {
    console.log(`\nYayinlandi: ${result.published?.permalink ?? result.published?.mediaId}\n`);
    return;
  }

  await mkdir(DRY_RUN_DIR, { recursive: true });
  const base = `${DRY_RUN_DIR}/${result.unit.id.replace('#', '-')}`;

  const extension = result.format === 'reel' ? 'mp4' : 'jpg';
  await Promise.all([
    writeFile(`${base}.${extension}`, result.media),
    writeFile(`${base}.txt`, result.caption, 'utf8'),
  ]);

  console.log('\n──────── CAPTION ────────\n');
  console.log(result.caption);
  console.log('\n─────────────────────────\n');
  console.log(`Medya  : ${base}.${extension}`);
  console.log(`Caption: ${base}.txt`);
  console.log(`Kaynak : ${result.sourceImageUrl}\n`);
}

main().catch((error: unknown) => {
  console.error(`\nHATA: ${formatConfigError(error)}\n`);
  process.exitCode = 1;
});
