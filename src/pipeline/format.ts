/**
 * Gunun gonderi formatini belirler.
 *
 * Gunde tek gonderi kalir, yalnizca bicimi degisir: Sali ve Cuma reel,
 * diger gunler fotograf. Boylece ayni icerik havuzu ve ayni yayin gecmisi
 * kullanilir, ayni gun iki gonderi atilmaz.
 *
 * Haftada iki reel bilincli bir tercih: video uretimi ve isleme daha uzun
 * surdugu icin her gune yaymak riski artirir, hic koymamak ise Reels'in
 * erisim avantajini kaybetmek olur.
 */

export type PostFormat = 'image' | 'reel';

/** 0 = Pazar ... 2 = Sali, 5 = Cuma */
const REEL_WEEKDAYS = new Set([2, 5]);

export function formatForDate(date: Date): PostFormat {
  return REEL_WEEKDAYS.has(date.getDay()) ? 'reel' : 'image';
}

/**
 * Komut satirindan bicim zorlanabilir; deneme ve elle tetikleme icin gerekli.
 * `--reel` veya `--image` verilmezse gune bakilir.
 */
export function resolveFormat(argv: readonly string[], now = new Date()): PostFormat {
  if (argv.includes('--reel')) return 'reel';
  if (argv.includes('--image')) return 'image';
  return formatForDate(now);
}
