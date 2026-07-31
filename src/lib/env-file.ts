import { readFileSync } from 'node:fs';

/**
 * Kucuk bir .env okuyucu. Yalnizca yerel gelistirmede kullanilir; CI'da
 * degiskenler zaten ortamdan gelir. Bunun icin ayri bir bagimlilik eklemeye
 * degmeyecek kadar basit bir is.
 *
 * Ortamda halihazirda tanimli bir degisken asla ezilmez.
 */
export function loadEnvFile(path = '.env'): void {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    return; // .env yoksa sorun degil.
  }

  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    if (key.length === 0 || process.env[key] !== undefined) continue;

    process.env[key] = unquote(trimmed.slice(separator + 1).trim());
  }
}

function unquote(value: string): string {
  const isQuoted =
    (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
  return isQuoted && value.length >= 2 ? value.slice(1, -1) : value;
}
