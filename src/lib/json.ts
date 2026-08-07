/**
 * Model yanitindan JSON cikarma ve onarma.
 *
 * Uzun metinlerde model dizge icinde kacissiz satir sonu birakabiliyor.
 * Bu JSON'u gecersiz kilar ve tum uretim bosa gider; 6 Agustos sabahki
 * gonderi tam olarak bu yuzden dustu. Yeniden uretmek yerine onarmak hem
 * daha ucuz hem daha guvenilir: yalnizca dizge icindeki kontrol
 * karakterleri kacisliya cevrilir, icerik degismez.
 */
export function parseModelJson<T>(raw: string): T {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');

  if (start === -1 || end <= start) {
    throw new Error('Yanitta JSON nesnesi bulunamadi.');
  }

  return JSON.parse(repair(raw.slice(start, end + 1))) as T;
}

function repair(json: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (const char of json) {
    if (escaped) {
      out += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      out += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      out += char;
      continue;
    }
    if (inString && char === '\n') { out += '\\n'; continue; }
    if (inString && char === '\r') { out += '\\r'; continue; }
    if (inString && char === '\t') { out += '\\t'; continue; }
    out += char;
  }

  return out;
}
