import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { ACCENT, BRAND, SITE, loadFonts, satoriFonts } from '../lib/fonts.js';
import { REEL_HEIGHT, REEL_WIDTH } from './compose.js';

/**
 * Reels uzerine binen tipografi katmanlari.
 *
 * Saydam PNG olarak uretiliyorlar: zoom yalnizca fotografa uygulaniyor,
 * metin sabit duruyor. Metni de zoomlamak okunaksiz ve amatorce goruniyor.
 */

export type OverlayInput =
  | { readonly kind: 'title'; readonly heading: string; readonly kicker: string }
  | { readonly kind: 'hook'; readonly text: string }
  | { readonly kind: 'line'; readonly text: string }
  | { readonly kind: 'end' };

export async function renderOverlay(input: OverlayInput): Promise<Buffer> {
  const fonts = await loadFonts();

  const layout =
    input.kind === 'title'
      ? titleLayout(input)
      : input.kind === 'hook'
        ? hookLayout(input.text)
        : input.kind === 'line'
          ? lineLayout(input.text)
          : endLayout();

  const svg = await satori(layout as never, {
    width: REEL_WIDTH,
    height: REEL_HEIGHT,
    fonts: satoriFonts(fonts),
  });

  return new Resvg(svg, { fitTo: { mode: 'width', value: REEL_WIDTH }, background: 'rgba(0,0,0,0)' })
    .render()
    .asPng();
}

const el = (type: string, props: Record<string, unknown>): unknown => ({ type, props });

/** Uzun basliklar tasmasin diye punto uzunluga gore secilir. */
function headingFontSize(heading: string): number {
  const length = heading.length;
  if (length <= 28) return 88;
  if (length <= 45) return 74;
  if (length <= 65) return 62;
  if (length <= 90) return 52;
  return 44;
}

function frame(children: unknown[]): unknown {
  return el('div', {
    style: {
      display: 'flex',
      width: `${REEL_WIDTH}px`,
      height: `${REEL_HEIGHT}px`,
      position: 'relative',
      fontFamily: 'Body',
    },
    children: [
      // Gradyan katmani sart: saydam PNG'de metin acik renkli bir fotografin
      // uzerinde okunmaz hale geliyor.
      el('div', {
        style: {
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${REEL_WIDTH}px`,
          height: `${REEL_HEIGHT}px`,
          background:
            'linear-gradient(to bottom, rgba(10,12,14,0.62) 0%, rgba(10,12,14,0.12) 30%, rgba(10,12,14,0.20) 52%, rgba(10,12,14,0.86) 88%, rgba(10,12,14,0.94) 100%)',
        },
      }),
      el('div', {
        style: {
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: '100%',
          height: '100%',
          // Dikey akista alt kisim arayuz ogeleriyle ortulur; ic bosluk ona gore.
          padding: '110px 80px 260px 80px',
        },
        children,
      }),
    ],
  });
}

function brandMark(): unknown {
  return el('div', {
    style: { display: 'flex', alignItems: 'center' },
    children: [
      el('div', { style: { width: '48px', height: '2px', backgroundColor: ACCENT, marginRight: '20px' } }),
      el('div', {
        style: { fontSize: '26px', letterSpacing: '6px', color: 'rgba(255,255,255,0.95)' },
        children: BRAND,
      }),
    ],
  });
}

function titleLayout(input: { readonly heading: string; readonly kicker: string }): unknown {
  return frame([
    brandMark(),
    el('div', {
      style: { display: 'flex', flexDirection: 'column' },
      children: [
        el('div', {
          style: {
            fontSize: '28px',
            letterSpacing: '4px',
            textTransform: 'uppercase',
            color: ACCENT,
            marginBottom: '28px',
          },
          children: input.kicker,
        }),
        el('div', {
          style: {
            fontFamily: 'Display',
            fontSize: `${headingFontSize(input.heading)}px`,
            lineHeight: 1.14,
            color: '#ffffff',
          },
          children: input.heading,
        }),
      ],
    }),
  ]);
}

/**
 * Kanca karesi: ekranin ortasinda, buyuk ve tek cumle.
 *
 * Ustte degil ortada duruyor cunku bu format ilk saniyede okunmak uzerine
 * kurulu; goz once merkeze gidiyor. Punto uzunluga gore kuculuyor.
 */
function hookLayout(text: string): unknown {
  const size = text.length <= 30 ? 96 : text.length <= 44 ? 82 : text.length <= 56 ? 70 : 62;

  return el('div', {
    style: {
      display: 'flex',
      width: `${REEL_WIDTH}px`,
      height: `${REEL_HEIGHT}px`,
      position: 'relative',
      fontFamily: 'Body',
    },
    children: [
      // Kanca karesinde perde daha koyu: metin buyuk ve tam ortada,
      // arkadaki fotografla yarismamali.
      el('div', {
        style: {
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${REEL_WIDTH}px`,
          height: `${REEL_HEIGHT}px`,
          background: 'linear-gradient(to bottom, rgba(10,12,14,0.72) 0%, rgba(10,12,14,0.58) 50%, rgba(10,12,14,0.78) 100%)',
        },
      }),
      el('div', {
        style: {
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          padding: '110px 84px 260px 84px',
        },
        children: [
          el('div', {
            style: {
              fontFamily: 'Display',
              fontSize: `${size}px`,
              lineHeight: 1.1,
              color: '#ffffff',
            },
            children: text,
          }),
          el('div', { style: { width: '90px', height: '3px', backgroundColor: ACCENT, marginTop: '38px' } }),
        ],
      }),
    ],
  });
}

/** Acilim karesi: kancadan sonraki kisa cumle, altta duruyor. */
function lineLayout(text: string): unknown {
  return frame([
    brandMark(),
    el('div', {
      style: {
        fontFamily: 'Display',
        fontSize: text.length <= 46 ? 60 : text.length <= 70 ? 50 : 44,
        lineHeight: 1.2,
        color: '#ffffff',
      },
      children: text,
    }),
  ]);
}

function endLayout(): unknown {
  return frame([
    brandMark(),
    el('div', {
      style: { display: 'flex', flexDirection: 'column' },
      children: [
        el('div', {
          style: { fontFamily: 'Display', fontSize: '72px', lineHeight: 1.15, color: '#ffffff', marginBottom: '30px' },
          children: 'Built on the Turkish Riviera',
        }),
        el('div', {
          style: { display: 'flex', alignItems: 'center' },
          children: [
            el('div', { style: { width: '130px', height: '1px', backgroundColor: 'rgba(255,255,255,0.5)' } }),
            el('div', {
              style: { fontSize: '26px', letterSpacing: '2px', color: 'rgba(255,255,255,0.85)', marginLeft: '20px' },
              children: SITE,
            }),
          ],
        }),
      ],
    }),
  ]);
}
