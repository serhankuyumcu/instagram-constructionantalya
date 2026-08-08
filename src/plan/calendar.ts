import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * Gunluk icerik takvimi.
 *
 * Takvim bir klasor agaci: her gun icin `YYYY-AA-GG - Proje - Konu/`
 * altinda numarali gorseller ve bir `KONU.md` brifingi var. Veritabani
 * yerine klasor kullanilmasinin sebebi, planin duzenleyicisinin Finder'da
 * calisan bir insan olmasi: gorseli surukleyip cikarmak, klasoru yeniden
 * adlandirmak ya da KONU.md'yi acip yazmak yeterli olmali.
 *
 * Bu yuzden tek dogruluk kaynagi klasorun kendisi. Uretim sirasinda yazilan
 * plan.json yalnizca insanin bakmasi icin duruyor, calisma aninda okunmuyor;
 * aksi halde elle yapilan bir degisiklik sessizce yok sayilirdi.
 */

const PLAN_DIR = fileURLToPath(new URL('../../assets/plan', import.meta.url));

/** Carousel gorselleri: `01-...`, `02-...` seklinde numarali dosyalar. */
const IMAGE_PATTERN = /^\d{2}-.+\.(webp|jpe?g|png)$/i;

export interface PlannedPost {
  readonly date: string;
  readonly project: string;
  readonly title: string;
  /** Gunun konusu; caption'a baglam olarak gider. */
  readonly brief: string;
  /** Caption'in vermesi gereken teknik nokta. */
  readonly point: string;
  /** Tasarim gorseli mi (uygulanmis is degil, gorsellestirme). */
  readonly isDesign: boolean;
  /** Carousel sirasina gore, repo koku baz alinmis yollar. */
  readonly images: readonly string[];
}

/** Verilen gune ait plan; o gun icin klasor yoksa null. */
export async function loadPlannedPost(date: string): Promise<PlannedPost | null> {
  const folder = await findFolder(date);
  if (folder === null) return null;

  const files = await readdir(join(PLAN_DIR, folder));
  const images = files
    .filter((name) => IMAGE_PATTERN.test(name))
    .sort()
    .map((name) => `/assets/plan/${folder}/${name}`);

  if (images.length === 0) {
    throw new Error(`"${folder}" klasorunde numarali gorsel yok.`);
  }

  const brief = await readFile(join(PLAN_DIR, folder, 'KONU.md'), 'utf8');
  return { date, ...parseBrief(brief, folder), images };
}

/** Takvimde bugunden sonra kac gun kaldigi; tukenmeden haber vermek icin. */
export async function remainingDays(fromDate: string): Promise<number> {
  const folders = await readdir(PLAN_DIR).catch(() => []);
  return folders.filter((name) => /^\d{4}-\d{2}-\d{2} - /.test(name) && name.slice(0, 10) >= fromDate).length;
}

async function findFolder(date: string): Promise<string | null> {
  const folders = await readdir(PLAN_DIR).catch(() => {
    throw new Error(`Plan klasoru bulunamadi: ${PLAN_DIR}. "npm run plan:sync" calistirilmali.`);
  });

  return folders.find((name) => name.startsWith(`${date} - `)) ?? null;
}

/**
 * KONU.md'den alanlari cikarir.
 *
 * Basliklara gore ayristiriliyor, satir sirasina gore degil: kullanici
 * dosyaya not eklerse plan bozulmasin.
 */
function parseBrief(markdown: string, folder: string): Omit<PlannedPost, 'date' | 'images'> {
  const section = (heading: string): string => {
    const match = markdown.match(new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, 'm'));
    return (match?.[1] ?? '').trim();
  };

  const brief = section('Konu');
  // Teknik nokta alinti blogu olarak yaziliyor; "> " isaretlerini atiyoruz.
  const point = section("Caption'ın vermesi gereken teknik nokta")
    .split('\n')
    .map((line) => line.replace(/^>\s?/, ''))
    .join(' ')
    .trim();

  if (brief === '') throw new Error(`"${folder}/KONU.md" icinde "## Konu" bolumu bos.`);

  // Klasor adi: "2026-08-09 - Mercure Konyaalti - Bos arsadan hafriyata"
  const [, project = 'Construction Antalya', ...rest] = folder.split(' - ');

  return {
    project,
    title: rest.join(' - '),
    brief,
    point,
    isDesign: /TASARIM GÖRSELİ/i.test(markdown),
  };
}
