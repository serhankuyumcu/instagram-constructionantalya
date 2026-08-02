import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { loadMedia } from '../lib/media.js';

/** Instagram'da dikey akista en cok alan kaplayan oran: 4:5. */
export const CANVAS_WIDTH = 1080;
export const CANVAS_HEIGHT = 1350;

const BRAND = 'CONSTRUCTION ANTALYA';
const ACCENT = '#c9a227';

const fontDir = new URL('../../assets/fonts/', import.meta.url);

interface Fonts {
  readonly display: Buffer;
  readonly body: Buffer;
}

let cachedFonts: Fonts | null = null;

async function loadFonts(): Promise<Fonts> {
  if (cachedFonts) return cachedFonts;

  const [display, body] = await Promise.all([
    readFile(fileURLToPath(new URL('PlayfairDisplay-SemiBold.ttf', fontDir))),
    readFile(fileURLToPath(new URL('Inter-Regular.ttf', fontDir))),
  ]);

  cachedFonts = { display, body };
  return cachedFonts;
}

export interface ComposeInput {
  readonly heading: string;
  readonly kicker: string;
  readonly imageUrl: string;
}

/**
 * Proje fotografini alir, uzerine editoryal bir tipografi katmani bindirir ve
 * yayina hazir JPEG dondurur.
 *
 * Tum metin satori ile cizilir; sistem fontlarina bagimlilik yoktur, bu yuzden
 * yerelde uretilen kare ile CI'da uretilen kare birebir aynidir.
 */
export async function composePostImage(input: ComposeInput): Promise<Buffer> {
  const [fonts, photo] = await Promise.all([loadFonts(), loadMedia(input.imageUrl)]);

  // Fotografi hedef orana kirp ve hafif karart: uzerindeki beyaz tipografi
  // her fotografta okunakli kalsin.
  const background = await sharp(photo)
    .resize(CANVAS_WIDTH, CANVAS_HEIGHT, { fit: 'cover', position: 'attention' })
    .modulate({ brightness: 0.82, saturation: 1.05 })
    .jpeg({ quality: 92 })
    .toBuffer();

  const backgroundUri = `data:image/jpeg;base64,${background.toString('base64')}`;

  const svg = await satori(buildLayout({ ...input, backgroundUri }) as never, {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    fonts: [
      { name: 'Display', data: fonts.display, weight: 600, style: 'normal' },
      { name: 'Body', data: fonts.body, weight: 400, style: 'normal' },
    ],
  });

  const png = new Resvg(svg, { fitTo: { mode: 'width', value: CANVAS_WIDTH } }).render().asPng();

  // Instagram JPEG'i daha hizli isler ve dosya boyutu ucta ucta daha kucuktur.
  return sharp(png).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer();
}

/**
 * Basligin uzunluguna gore punto secer. Sabit punto kullanilirsa uzun
 * bolum basliklari kareden tasar, kisa olanlar ise kaybolur.
 */
function headingFontSize(heading: string): number {
  const length = heading.length;
  if (length <= 28) return 92;
  if (length <= 45) return 78;
  if (length <= 65) return 66;
  if (length <= 90) return 56;
  return 48;
}

interface LayoutInput extends ComposeInput {
  readonly backgroundUri: string;
}

/** Satori'nin bekledigi element agaci (JSX kullanmadan, duz nesne olarak). */
function buildLayout(input: LayoutInput): unknown {
  const el = (type: string, props: Record<string, unknown>): unknown => ({ type, props });

  return el('div', {
    style: {
      display: 'flex',
      width: `${CANVAS_WIDTH}px`,
      height: `${CANVAS_HEIGHT}px`,
      position: 'relative',
      fontFamily: 'Body',
    },
    children: [
      // Katman 1 — fotograf
      el('img', {
        src: input.backgroundUri,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        style: { position: 'absolute', top: 0, left: 0 },
      }),

      // Katman 2 — alttan yukari koyulasan gradyan; tipografiyi tasir.
      el('div', {
        style: {
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${CANVAS_WIDTH}px`,
          height: `${CANVAS_HEIGHT}px`,
          background:
            'linear-gradient(to bottom, rgba(10,12,14,0.55) 0%, rgba(10,12,14,0.10) 32%, rgba(10,12,14,0.72) 72%, rgba(10,12,14,0.94) 100%)',
        },
      }),

      // Katman 3 — icerik
      el('div', {
        style: {
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: '100%',
          height: '100%',
          padding: '72px 72px 84px 72px',
        },
        children: [
          // Ust seritteki marka imzasi
          el('div', {
            style: { display: 'flex', alignItems: 'center' },
            children: [
              el('div', { style: { width: '44px', height: '2px', backgroundColor: ACCENT, marginRight: '18px' } }),
              el('div', {
                style: { fontSize: '22px', letterSpacing: '5px', color: 'rgba(255,255,255,0.94)' },
                children: BRAND,
              }),
            ],
          }),

          // Alt blok: konu etiketi + baslik
          el('div', {
            style: { display: 'flex', flexDirection: 'column' },
            children: [
              el('div', {
                style: {
                  fontSize: '24px',
                  letterSpacing: '3.5px',
                  textTransform: 'uppercase',
                  color: ACCENT,
                  marginBottom: '26px',
                },
                children: input.kicker,
              }),
              el('div', {
                style: {
                  fontFamily: 'Display',
                  fontSize: `${headingFontSize(input.heading)}px`,
                  lineHeight: 1.12,
                  color: '#ffffff',
                  marginBottom: '34px',
                },
                children: input.heading,
              }),
              el('div', {
                style: { display: 'flex', alignItems: 'center' },
                children: [
                  el('div', { style: { width: '120px', height: '1px', backgroundColor: 'rgba(255,255,255,0.45)' } }),
                  el('div', {
                    style: {
                      fontSize: '21px',
                      letterSpacing: '2px',
                      color: 'rgba(255,255,255,0.75)',
                      marginLeft: '18px',
                    },
                    children: 'constructionantalya.com',
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}
