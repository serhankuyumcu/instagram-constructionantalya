import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchBuffer } from './http.js';

/**
 * Gorsel kaynagini okur.
 *
 * Iki kaynak var: siteden cekilen uzak gorseller (blog yazilarinin kendi
 * kareleri) ve repoda duran elle secilmis fotograf havuzu. Havuzdaki
 * dosyalari ag uzerinden istemek gereksiz gecikme ve kirilganlik olurdu,
 * bu yuzden yerel yoldan okunuyorlar.
 */
export async function loadMedia(source: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(source)) return fetchBuffer(source);

  const relative = source.replace(/^\//, '');
  return readFile(fileURLToPath(new URL(`../../${relative}`, import.meta.url)));
}
