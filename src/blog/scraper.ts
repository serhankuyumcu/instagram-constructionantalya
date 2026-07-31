import * as cheerio from 'cheerio';
import { fetchText } from '../lib/http.js';
import type { Article, ArticleImage, ArticleSection } from './types.js';

/** Bir bolumun gonderi olmaya deger sayilmasi icin gereken en az metin uzunlugu. */
const MIN_SECTION_CHARS = 220;

/**
 * Instagram gonderisi olarak zayif kalan bolumler. SSS listeleri, kaynakcalar ve
 * CTA bloklari tek basina okundugunda baglamsiz gorunur.
 */
const SKIPPED_HEADING_PATTERNS = [
  /frequently asked questions/i,
  /\bfaq\b/i,
  /sikca sorulan/i,
  /sıkça sorulan/i,
  /часто задаваемые/i,
  /get in touch/i,
  /contact us/i,
  /iletisime gec/i,
  /i̇letişime geç/i,
];

export async function fetchArticle(url: string): Promise<Article> {
  const html = await fetchText(url);
  return parseArticle(html, url);
}

/** Saf fonksiyon: ag erisimi olmadan test edilebilmesi icin HTML disaridan verilir. */
export function parseArticle(html: string, url: string): Article {
  const $ = cheerio.load(html);

  const title = meta($, 'og:title') ?? $('h1').first().text().trim();
  const description = meta($, 'og:description') ?? '';

  // Site tek bir <article> konteyneri kullaniyor; nav/header/footer boylece disarida kalir.
  const root = $('article').first();
  const scope = root.length > 0 ? root : $('body');

  return {
    slug: slugFromUrl(url),
    url,
    title: stripSiteSuffix(title),
    description,
    images: extractImages($, url),
    sections: extractSections($, scope),
  };
}

/** Gonderi karesine konamayacak varliklar: logo, ikon, izleme pikseli. */
const NON_EDITORIAL_PATTERN = /logo|icon|favicon|sprite|placeholder|avatar/i;

/**
 * Yazi sayfasindaki gorselleri sayfadaki siralariyla toplar.
 *
 * Kapsam bilerek <article>'dan genis tutuluyor: yazinin kapak gorseli
 * (ornegin invest-hero.webp) article konteynerinin disinda, sayfa basligi
 * bolumunde duruyor ve genelde en guclu karedir. Buna karsilik nav ve footer
 * cikariliyor, cunku oradaki gorseller icerige ait degil.
 *
 * og:image kasitli olarak kullanilmaz: sitede her yazinin og:image'i ayni
 * generic hero karesini gosteriyor, bu yuzden gonderi gorseli olarak degersiz.
 */
function extractImages($: cheerio.CheerioAPI, pageUrl: string): ArticleImage[] {
  const seen = new Set<string>();
  const images: ArticleImage[] = [];

  const scope = $('body').clone();
  scope.find('nav, footer').remove();

  scope.find('img, source').each((_, element) => {
    for (const candidate of imageCandidates($(element))) {
      if (NON_EDITORIAL_PATTERN.test(candidate)) continue;

      const absolute = toAbsolute(candidate, pageUrl);
      if (absolute === null || seen.has(absolute)) continue;

      seen.add(absolute);
      images.push({ url: absolute, isHero: images.length === 0 });
    }
  });

  return images;
}

/** src ve srcset birlikte kullaniliyor; srcset'ten en buyuk aday alinir. */
function imageCandidates(node: cheerio.Cheerio<any>): string[] {
  const candidates: string[] = [];

  const src = node.attr('src');
  if (src) candidates.push(src);

  const srcset = node.attr('srcset') ?? node.attr('srcSet');
  if (srcset) {
    const largest = srcset
      .split(',')
      .map((entry) => {
        const [rawUrl, descriptor] = entry.trim().split(/\s+/);
        const width = Number.parseInt(descriptor ?? '0', 10);
        return { url: rawUrl ?? '', width: Number.isNaN(width) ? 0 : width };
      })
      .filter((entry) => entry.url.length > 0)
      .sort((a, b) => b.width - a.width)[0];

    if (largest) candidates.push(largest.url);
  }

  return candidates.filter((value) => /\.(webp|jpe?g|png)(\?|$)/i.test(value));
}

function toAbsolute(candidate: string, pageUrl: string): string | null {
  if (candidate.startsWith('data:')) return null;
  try {
    return new URL(candidate, pageUrl).toString();
  } catch {
    return null;
  }
}

/**
 * h2 basliklarini sinir kabul ederek gövdeyi bolumlere ayirir.
 * Ilk h2'den onceki paragraflar "giris" bolumu olarak index 0'a yazilir.
 */
function extractSections($: cheerio.CheerioAPI, scope: cheerio.Cheerio<any>): ArticleSection[] {
  const sections: ArticleSection[] = [];

  let heading = '';
  let paragraphs: string[] = [];

  const flush = (): void => {
    if (paragraphs.length === 0) return;

    const text = paragraphs.join('\n\n');
    const isSkipped = SKIPPED_HEADING_PATTERNS.some((re) => re.test(heading));

    if (!isSkipped && text.length >= MIN_SECTION_CHARS) {
      sections.push({ index: sections.length, heading, paragraphs: [...paragraphs], text });
    }
    paragraphs = [];
  };

  scope.find('h2, p').each((_, element) => {
    const node = $(element);
    const value = normalizeWhitespace(node.text());
    if (value.length === 0) return;

    if (node.is('h2')) {
      flush();
      heading = value;
      return;
    }
    paragraphs.push(value);
  });

  flush();
  return sections;
}

function meta($: cheerio.CheerioAPI, property: string): string | undefined {
  const content = $(`meta[property="${property}"]`).attr('content');
  return content ? normalizeWhitespace(content) : undefined;
}

/** "Baslik | Construction Antalya" -> "Baslik" */
function stripSiteSuffix(title: string): string {
  return title.split('|')[0]?.trim() ?? title;
}

function slugFromUrl(url: string): string {
  const segments = new URL(url).pathname.split('/').filter(Boolean);
  return segments.at(-1) ?? url;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}
