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

/**
 * Carousel kareleri gun bazinda tek bir orana getiriliyor.
 *
 * Instagram bir carousel'in tamamini ILK karenin oranina gore kirpiyor;
 * karisik oranli birakilirsa hangi kenarin ucacagina biz karar vermiyoruz.
 * Ama tutarlilik yalnizca carousel ICINDE gerekiyor, gonderiler arasinda
 * degil — bu yuzden oran her gun kendi gorsellerine gore seciliyor.
 *
 * Havuz neredeyse tam ikiye bolunuyor: 80 dikey, 75 manzara, 16 genis.
 * Hepsini 4:5'e zorlamak manzara karelerini siyah bantla ezerdi, hepsini
 * manzaraya zorlamak dikey santiye fotograflarini. Gunun kendi karakterine
 * uymak ikisini de kurtariyor.
 */
const WIDTH = 1080;
const QUALITY = 82;

/**
 * Kullanilan oranlar 4:5 ve 1:1 ile sinirli.
 *
 * Instagram 1.91:1'e de izin veriyor ve manzara karelerinde en az kirpma
 * onunla oluyor; ama akista ince bir serit olarak duruyor, dikey alani
 * bosa harciyor. Manzara gunlerinde 1:1'e kirpmak biraz kenar goturuyor,
 * karsiliginda gonderi ekranda iki kat yer kapliyor.
 */
const RATIOS = [
  { name: '4:5', value: 0.8 },
  { name: '1:1', value: 1 },
] as const;

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

  const ratios = new Map<string, string>();
  let images = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;

  for (const day of days) {
    const files = (await readdir(join(SOURCE, day))).filter((name) => IMAGE_PATTERN.test(name)).sort();

    if (files.length < 2 || files.length > 10) {
      throw new Error(`"${day}": carousel 2-10 gorsel ister, ${files.length} bulundu.`);
    }

    const ratio = await chooseRatio(join(SOURCE, day), files);
    ratios.set(day, ratio.name);

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

      await normalise(from, to, ratio.value);

      bytesAfter += (await stat(to)).size;
      images++;
    }

    await cp(join(SOURCE, day, 'KONU.md'), join(TARGET, day, 'KONU.md')).catch(() => {
      throw new Error(`"${day}" icinde KONU.md yok.`);
    });
  }

  if (!dryRun) await writeOverlap();

  const mb = (n: number): string => `${(n / 1048576).toFixed(0)} MB`;
  const spread = [...ratios.values()].reduce<Record<string, number>>((acc, r) => ({ ...acc, [r]: (acc[r] ?? 0) + 1 }), {});
  console.log(`${days.length} gun, ${images} gorsel${dryRun ? ' (deneme, yazilmadi)' : ''}`);
  console.log(`oranlar: ${Object.entries(spread).map(([r, n]) => `${r} × ${n} gun`).join(', ')}`);
  console.log(`${days[0]} -> ${days[days.length - 1]}`);
  if (!dryRun) console.log(`boyut: ${mb(bytesBefore)} -> ${mb(bytesAfter)}`);
  if (!dryRun) console.log('\nSonraki adim: git add assets/plan && git commit && git push');
}

/** Kareyi gunun oranina, ortadan kirparak getirir. */
async function normalise(from: string, to: string, ratio: number): Promise<void> {
  await sharp(from)
    .rotate()
    .resize(WIDTH, Math.round(WIDTH / ratio), { fit: 'cover', position: 'centre' })
    .webp({ quality: QUALITY })
    .toFile(to);
}

/** Gunun karelerine en az zarar veren izinli orani secer. */
async function chooseRatio(dir: string, files: readonly string[]): Promise<(typeof RATIOS)[number]> {
  const aspects: number[] = [];
  for (const file of files) {
    const { width = 0, height = 0 } = await sharp(join(dir, file)).rotate().metadata();
    if (height > 0) aspects.push(width / height);
  }

  // Toplam kirpma kaybini en aza indiren oran. Kayip, kaynakla hedef oran
  // arasindaki logaritmik mesafe: 2 kat genis de 2 kat dar da ayni agirlikta.
  const cost = (target: number): number =>
    aspects.reduce((sum, aspect) => sum + Math.abs(Math.log(aspect / target)), 0);

  return [...RATIOS].sort((a, b) => cost(a.value) - cost(b.value))[0]!;
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

  /**
   * Imzalar repodaki degil masaustundeki kopyadan cikariliyor.
   *
   * Repoya yazilan kare 4:5'e kirpildigi icin imzasi degisiyor ve havuzdaki
   * ayni fotografla artik eslesmiyor. Kirpilmamis orijinalle karsilastirmak
   * sart: ilk denemede bu gozden kacti ve ortusme 183'ten 52'ye dustu.
   */
  const planHashes = new Set<bigint>();
  for (const day of (await readdir(SOURCE)).filter((n) => DAY_PATTERN.test(n))) {
    for (const file of (await readdir(join(SOURCE, day))).filter((n) => IMAGE_PATTERN.test(n))) {
      planHashes.add(await dHash(join(SOURCE, day, file)));
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
