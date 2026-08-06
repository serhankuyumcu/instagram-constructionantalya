import type { Topic } from '../content/topics.js';

/**
 * Hashtag stratejisi.
 *
 * Iki kural bu dosyanin tamamini belirliyor:
 *
 * 1. Ayni etiket setini her gonderide tekrarlamak Instagram tarafindan
 *    tekrar/spam sinyali olarak okunur. Bu yuzden setler her gonderide
 *    icerige gore yeniden kurulur ve rotasyona girer.
 *
 * 2. Yalnizca dev hacimli etiketler (#luxury gibi) kullanmak, gonderiyi
 *    saniyeler icinde gomer. Kucuk ve orta hacimli nis etiketler gercek
 *    erisimi getirir. Bu yuzden set daima uc katmandan karistirilir.
 */

/** Her gonderide mutlaka bulunan marka etiketleri. */
const BRAND = ['#constructionantalya'] as const;

/** Genis hacim — kesif icin, tek basina yetmez. */
const BROAD = [
  '#luxuryhomes', '#architecture', '#luxuryvilla', '#construction', '#interiordesign',
  '#realestate', '#moderndesign', '#dreamhome', '#luxurylifestyle', '#homedesign',
] as const;

/** Konum — Antalya pazarinda donusumu en yuksek katman. */
const LOCAL = [
  '#antalya', '#konyaaltı', '#belek', '#lara', '#kalkan', '#kaş', '#side',
  '#turkishriviera', '#antalyalife', '#türkiye', '#antalyaemlak', '#antalyavilla',
] as const;

/** Sektor ve alici niyeti — orta hacim, yuksek nitelikli kitle. */
const NICHE = [
  '#villaconstruction', '#turnkeyvilla', '#luxuryconstruction', '#villaproject',
  '#propertyinvestment', '#turkeyrealestate', '#investinturkey', '#villaforsale',
  '#müteahhit', '#inşaat', '#anahtarteslim', '#lüksvilla', '#villayapımı',
  // Rusca etiketler: caption iki dilli oldugu icin etiket havuzu da
  // Rusca konusan aliciyi kapsamali.
  '#анталия', '#недвижимостьтурция', '#домвтурции', '#строительствотурция',
  '#buildingdesign', '#civilengineering', '#residentialdesign',
] as const;

/** Konuya ozel etiketler — icerikle dogrudan ortusen katman. */
const TOPIC_TAGS: Readonly<Record<Topic, readonly string[]>> = {
  hotel: ['#hotelconstruction', '#hospitalitydesign', '#resortdesign', '#otelinşaatı'],
  villa: ['#villadesign', '#villalife', '#privatevilla', '#villaantalya'],
  residential: ['#residentialconstruction', '#apartmentdesign', '#konutprojesi'],
  shell: ['#kabainşaat', '#structuralengineering', '#reinforcedconcrete', '#betonarme'],
  finishing: ['#craftsmanship', '#interiorfinishes', '#marble', '#inceişçilik'],
  exterior: ['#facadedesign', '#exteriordesign', '#landscapedesign', '#cephetasarımı'],
  interior: ['#interiorarchitecture', '#luxuryinteriors', '#içmimari'],
  pool: ['#pooldesign', '#infinitypool', '#havuzyapımı'],
  sustainability: ['#sustainablearchitecture', '#greenbuilding', '#energyefficiency', '#yeşilbina'],
};

/**
 * Instagram 30 etikete izin verir ama nis hesaplarda 12-16 araligi
 * daha saglikli calisir: yeterince kesif, spam gorunumu yok.
 */
const TARGET_COUNT = 14;

export interface HashtagPlan {
  readonly tags: readonly string[];
  /** Duz metin hali; caption'in sonuna eklenir. */
  readonly text: string;
}

/**
 * Icerige ve gonderi sirasina gore etiket seti kurar.
 *
 * `rotationSeed` olarak simdiye kadar yayinlanan gonderi sayisi verilir;
 * boylece ayni konudaki iki gonderi bile farkli etiket kombinasyonu alir.
 */
export function buildHashtags(topics: readonly Topic[], rotationSeed: number): HashtagPlan {
  const topical = topics.flatMap((topic) => TOPIC_TAGS[topic] ?? []);

  const tags = [
    ...BRAND,
    ...rotate(topical, rotationSeed).slice(0, 4),
    ...rotate(LOCAL, rotationSeed).slice(0, 4),
    ...rotate(NICHE, rotationSeed * 2).slice(0, 4),
    ...rotate(BROAD, rotationSeed * 3).slice(0, 3),
  ];

  const unique = [...new Set(tags)].slice(0, TARGET_COUNT);
  return { tags: unique, text: unique.join(' ') };
}

/** Diziyi sabit bir ofsetten baslatarak dondurur — rastgelelik yok, tekrarlanabilir. */
function rotate<T>(items: readonly T[], seed: number): T[] {
  if (items.length === 0) return [];
  const offset = ((seed % items.length) + items.length) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}
