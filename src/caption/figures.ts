/**
 * Fiyat ve sure ifadelerinin tespiti.
 *
 * Gerekce: rakam, ait oldugu projeden koparildiginda yanlis beklenti
 * yaratir ve sonradan pazarlik masasinda aleyhe kullanilir. Blog tarafinda
 * ayni yasak var; Instagram'in daha az resmi olmasi kurali degistirmiyor,
 * cunku ekran goruntusu alinan sey ayni rakam.
 *
 * Yil ("2026"), kat sayisi, olcu ("6 cm") gibi notr sayilar serbest;
 * yalnizca para ve sure ifadeleri yakalanir.
 */

/**
 * Zaman birimleri, uc dilde ve ek alabilecek sekilde.
 *
 * Iki istisna var:
 *  - "ay": ek serbest birakilirsa "5 ayrı bolum" gibi masum ifadeleri de
 *    yakalar, o yuzden ardindan harf gelmemesi sart.
 *  - "yıl": "beş yıldızlı otel" markanin en cok kullandigi ifade ve sure
 *    degil; "yıldız" disarida birakiliyor.
 */
const UNITS =
  'months?|weeks?|days?|years?|hafta\\p{L}*|gün\\p{L}*|yıl(?!dız)\\p{L}*|ay(?!\\p{L})' +
  '|месяц\\p{L}*|недел\\p{L}*|дн\\p{L}*|год\\p{L}*|лет\\p{L}*';

/**
 * Rakamla yazilmis sureler: "6 months", "12-18 months", "18 ay".
 *
 * Sayinin iki tarafinda da kelime siniri sart. Aksi halde "2018 года"
 * ifadesi "20" + "18" + "года" olarak parcalanip yil bilgisi sure
 * sanilıyordu.
 */
const NUMERIC = new RegExp(
  `\\b\\d{1,2}\\b(?:\\s*(?:-|–|to|ile|до)\\s*\\d{1,2}\\b)?\\s*(?:${UNITS})`,
  'iu',
);

/**
 * Yaziyla yazilmis sureler: "twelve to eighteen months", "двум годам".
 *
 * Rusca sayilar cekim aldigi icin govde olarak yaziliyor. Ekler icin
 * \\w degil \\p{L} kullaniliyor: JavaScript'te \\w yalnizca ASCII eslesir,
 * Kiril ve Turkce harfleri kapsamaz ("два", "yılında" kaciyordu).
 * Hemen ardindan bir zaman birimi gelmesi sart kosuldugu icin yanlis
 * pozitif riski dusuk kaliyor.
 */
const SPELLED = new RegExp(
  // Bastaki sinir icin \\b degil lookbehind: \\b ASCII tabanli oldugu icin
  // Kiril harfle baslayan kelimede ("два") hic eslesmiyor.
  '(?<![\\p{L}\\d])(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen|twenty' +
    '|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|oniki' +
    '|дв\\p{L}+|тр[ёие]\\p{L}*|четыр\\p{L}+|пят\\p{L}+|шест\\p{L}+|двенадцат\\p{L}+|восемнадцат\\p{L}+)' +
    `(?:\\s+(?:to|ile|до|-|–)\\s+\\p{L}+)?\\s+(?:${UNITS})`,
  'iu',
);

export const FIGURE_PATTERNS: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  { pattern: /[€$₺£]\s?\d/, reason: 'para birimi ve rakam' },
  { pattern: /\b\d[\d.,\s]*\s?(EUR|USD|TRY|GBP|TL)\b/i, reason: 'para birimi kodu' },
  // Kelime sonu siniri sart: "Eurocode" bir yapi standardi, para birimi degil.
  { pattern: /\b\d[\d.,]*\s?(euros?|dollars?|liras?|pounds?|рубл\w*|доллар\w*)\b/i, reason: 'para birimi adi' },
  { pattern: /\bper\s?(square\s?met(er|re)|m²|m2|sqm)\b/i, reason: 'birim fiyat' },
  { pattern: /metrekare\s?başına|м²\s?за|за\s?квадратный\s?метр/i, reason: 'birim fiyat' },
  { pattern: NUMERIC, reason: 'sure bilgisi' },
  { pattern: SPELLED, reason: 'yaziyla sure bilgisi' },
];

export interface FigureHit {
  readonly reason: string;
  readonly match: string;
}

/** Metinde fiyat/sure ifadesi varsa dondurur. */
export function findFigures(text: string): FigureHit[] {
  return FIGURE_PATTERNS.flatMap(({ pattern, reason }) => {
    const match = text.match(pattern);
    return match ? [{ reason, match: match[0].trim() }] : [];
  });
}
