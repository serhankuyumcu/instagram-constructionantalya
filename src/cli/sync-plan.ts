import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import sharp from 'sharp';

/**
 * Masaustundeki icerik takvimini repoya aktarir.
 *
 * Neden iki kopya var: takvimi duzenleyen insan Finder'da calisiyor ve
 * orada tam cozunurluklu gorseli gormek istiyor; gonderiyi atan bot ise
 * GitHub Actions'ta calisiyor ve masaustunu goremiyor. Bu yuzden plan
 * repoya giriyor, ama once kucultulerek.
 *
 * 200 gorselin orijinali 84 MB. Instagram zaten 1440 pikselin ustunu
 * kendisi kucultuyor, dolayisiyla depoya tam boyut koymak her Actions
 * calistirmasinda bosuna indirilen veri demek.
 */

const SOURCE = join(homedir(), 'Desktop/insta-plan');
const TARGET = fileURLToPath(new URL('../../assets/plan', import.meta.url));

/** Instagram akisinda bunun ustu gorunmuyor; fazlasi bosuna repo agirligi. */
const MAX_EDGE = 1440;
const QUALITY = 82;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2} - /;
const IMAGE_PATTERN = /^\d{2}-.+\.(webp|jpe?g|png|avif)$/i;

const dryRun = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const exists = await stat(SOURCE).catch(() => null);
  if (exists === null) throw new Error(`Plan klasoru bulunamadi: ${SOURCE}`);

  const days = (await readdir(SOURCE)).filter((name) => DAY_PATTERN.test(name)).sort();
  if (days.length === 0) throw new Error(`${SOURCE} icinde gun klasoru yok.`);

  if (!dryRun) {
    // Silinen ya da yeniden adlandirilan gunler repoda kalmasin.
    await rm(TARGET, { recursive: true, force: true });
    await mkdir(TARGET, { recursive: true });
  }

  let images = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;

  for (const day of days) {
    const files = (await readdir(join(SOURCE, day))).filter((name) => IMAGE_PATTERN.test(name)).sort();

    if (files.length < 2 || files.length > 10) {
      throw new Error(`"${day}": carousel 2-10 gorsel ister, ${files.length} bulundu.`);
    }

    if (!dryRun) await mkdir(join(TARGET, day), { recursive: true });

    for (const file of files) {
      const from = join(SOURCE, day, file);
      // Cikti daima .webp: kaynak png/avif olabiliyor, Instagram'a giden
      // kare tek bir formatta olsun.
      const to = join(TARGET, day, file.replace(/\.[^.]+$/, '.webp'));

      bytesBefore += (await stat(from)).size;

      if (dryRun) {
        images++;
        continue;
      }

      await sharp(from)
        .rotate()
        .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toFile(to);

      bytesAfter += (await stat(to)).size;
      images++;
    }

    await cp(join(SOURCE, day, 'KONU.md'), join(TARGET, day, 'KONU.md')).catch(() => {
      throw new Error(`"${day}" icinde KONU.md yok.`);
    });
  }

  if (!dryRun) await writeOverlap();

  const mb = (n: number): string => `${(n / 1048576).toFixed(0)} MB`;
  console.log(`${days.length} gun, ${images} gorsel${dryRun ? ' (deneme, yazilmadi)' : ''}`);
  console.log(`${days[0]} -> ${days[days.length - 1]}`);
  if (!dryRun) console.log(`boyut: ${mb(bytesBefore)} -> ${mb(bytesAfter)}`);
  if (!dryRun) console.log('\nSonraki adim: git add assets/plan && git commit && git push');
}

/**
 * Takvimle reels havuzunun ortak karelerini isaretler.
 *
 * Ikisi ayni kaynaktan besleniyor: takvimdeki proje fotograflari havuzda
 * da var, sadece farkli isimle ve farkli kodlamayla. Dosya adi eslesmedigi
 * icin tekrar onleme bunu goremiyordu ve ayni kare hem sabah carousel'inde
 * hem aksam reel'inde cikabiliyordu.
 *
 * Cozum algisal karsilastirma: her kare 8x8 gri tona indirgenip komsu
 * pikseller arasindaki fark bitlere ceviriliyor (dHash). Yeniden kodlama
 * ve boyut degisikligi bu imzayi degistirmiyor, farkli fotograf ise
 * degistiriyor.
 */
async function writeOverlap(): Promise<void> {
  const manifestPath = fileURLToPath(new URL('../../assets/photos/manifest.json', import.meta.url));
  const pool = JSON.parse(await readFile(manifestPath, 'utf8')) as { path: string }[];
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

  const planHashes = new Set<bigint>();
  for (const day of (await readdir(TARGET)).filter((n) => DAY_PATTERN.test(n))) {
    for (const file of (await readdir(join(TARGET, day))).filter((n) => IMAGE_PATTERN.test(n))) {
      planHashes.add(await dHash(join(TARGET, day, file)));
    }
  }

  const excluded: string[] = [];
  for (const photo of pool) {
    const hash = await dHash(join(repoRoot, photo.path.replace(/^\//, ''))).catch(() => null);
    if (hash === null) continue;
    // Esik 10 bit: yeniden kodlama birkac bit oynatiyor, farkli fotograf
    // arasindaki mesafe ise tipik olarak 20'nin uzerinde kaliyor.
    for (const planHash of planHashes) {
      if (hammingDistance(hash, planHash) <= 10) { excluded.push(photo.path); break; }
    }
  }

  await writeFile(join(TARGET, 'overlap.json'), `${JSON.stringify(excluded, null, 2)}\n`);
  console.log(`takvimle ortusen havuz karesi: ${excluded.length}/${pool.length} (reels'te kullanilmayacak)`);
}

async function dHash(path: string): Promise<bigint> {
  const pixels = await sharp(path).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (pixels[y * 9 + x]! > pixels[y * 9 + x + 1]! ? 1n : 0n);
    }
  }
  return bits;
}

function hammingDistance(a: bigint, b: bigint): number {
  let diff = a ^ b;
  let count = 0;
  while (diff > 0n) {
    count += Number(diff & 1n);
    diff >>= 1n;
  }
  return count;
}

main().catch((error: unknown) => {
  console.error(`HATA: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
