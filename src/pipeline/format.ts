/**
 * Gonderi formati.
 *
 * Gunde iki gonderi var ve ikisi bilerek farkli: sabah fotograf, aksam
 * reel. Ayni gun ust uste benzer iki gonderi feed'i tekduze yapiyor;
 * fotograf marka estetigini tasirken reel erisimi getiriyor.
 *
 * Hangi calismanin hangi bicim oldugu is akisinda acikca veriliyor
 * (--image / --reel). Bayrak gelmezse saate bakilir: ogleden once
 * fotograf, sonra reel. Bu yalnizca guvenlik agi; CI gecikirse bile
 * makul bir sonuc verir.
 */

export type PostFormat = 'image' | 'reel';

/** Ogleden once fotograf, sonra reel. Yerel saat degil UTC kullanilir. */
export function formatForDate(date: Date): PostFormat {
  return date.getUTCHours() < 12 ? 'image' : 'reel';
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
