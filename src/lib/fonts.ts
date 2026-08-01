import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * Marka fontlari. Repoda tutuluyorlar ki yerelde uretilen kare ile CI'da
 * uretilen birebir ayni olsun; sistem fontlarina bagimlilik yok.
 */
export interface Fonts {
  readonly display: Buffer;
  readonly body: Buffer;
}

const fontDir = new URL('../../assets/fonts/', import.meta.url);

let cached: Fonts | null = null;

export async function loadFonts(): Promise<Fonts> {
  if (cached) return cached;

  const [display, body] = await Promise.all([
    readFile(fileURLToPath(new URL('PlayfairDisplay-SemiBold.ttf', fontDir))),
    readFile(fileURLToPath(new URL('Inter-Regular.ttf', fontDir))),
  ]);

  cached = { display, body };
  return cached;
}

/** satori'ye verilecek font tanimlari. */
export function satoriFonts(fonts: Fonts) {
  return [
    { name: 'Display', data: fonts.display, weight: 600 as const, style: 'normal' as const },
    { name: 'Body', data: fonts.body, weight: 400 as const, style: 'normal' as const },
  ];
}

export const ACCENT = '#c9a227';
export const BRAND = 'CONSTRUCTION ANTALYA';
export const SITE = 'constructionantalya.com';
