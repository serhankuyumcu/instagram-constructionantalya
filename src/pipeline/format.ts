/**
 * Gonderi formati.
 *
 * Gunde iki gonderi var ve ikisi bilerek farkli: sabah icerik takviminden
 * gelen carousel, aksam reel. Ayni gun ust uste benzer iki gonderi feed'i
 * tekduze yapiyor; carousel projeyi anlatirken reel erisimi getiriyor.
 *
 * `image` bicimi hala duruyor ama artik yedek: takvimde o gune ait klasor
 * yoksa bot blog gorseliyle tek kareli gonderiye dusuyor. Takvim bittiginde
 * yayin durmasin diye.
 *
 * Hangi calismanin hangi bicim oldugu is akisinda acikca veriliyor
 * (--carousel / --image / --reel). Bayrak gelmezse saate bakilir: ogleden
 * once carousel, sonra reel. Bu yalnizca guvenlik agi; CI gecikirse bile
 * makul bir sonuc verir.
 */

export type PostFormat = 'carousel' | 'image' | 'reel';

/** Ogleden once carousel, sonra reel. Yerel saat degil UTC kullanilir. */
export function formatForDate(date: Date): PostFormat {
  return date.getUTCHours() < 12 ? 'carousel' : 'reel';
}

/**
 * Komut satirindan bicim zorlanabilir; deneme ve elle tetikleme icin gerekli.
 * Bayrak verilmezse gune bakilir.
 */
export function resolveFormat(argv: readonly string[], now = new Date()): PostFormat {
  if (argv.includes('--reel')) return 'reel';
  if (argv.includes('--carousel')) return 'carousel';
  if (argv.includes('--image')) return 'image';
  return formatForDate(now);
}
