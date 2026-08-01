import type { ArticleImage, PostUnit } from '../src/blog/types.js';
import type { State } from '../src/state/store.js';

/** constructionantalya.com yapisini taklit eden kucuk bir yazi ornegi. */
export const ARTICLE_HTML = `
<html>
<head>
  <meta property="og:title" content="Why Shell Construction Matters | Construction Antalya">
  <meta property="og:description" content="The structure behind every luxury finish.">
  <meta property="og:image" content="https://constructionantalya.com/assets/hero/hero.webp">
</head>
<body>
  <nav><a href="/">Projects</a><img src="/assets/logo/logo.webp" alt="logo"></nav>
  <header><p>Bu paragraf article disinda, gonderiye girmemeli.</p></header>
  <article>
    <img src="/assets/blog/shell-hero.webp" alt="hero">
    <h1>Why Shell Construction Matters</h1>
    <p>Two decades ago, the shell was something nobody photographed. Today it is the single strongest predictor of how a luxury villa will age, how quietly its doors will close in year ten, and whether its floors will still be level when the furniture arrives.</p>
    <h2>The 90 Per Cent You Never See</h2>
    <p>A luxury building is judged on its surfaces, but it is made possible by its structure. The reinforced concrete frame carries every load and defines every dimension the finishing trades will later work to.</p>
    <p>Get the shell right and it disappears: walls are plumb, floors are level, and the villa feels solid underfoot.</p>
    <img src="/assets/blog/shell-1.webp" alt="frame">
    <picture>
      <source srcset="/assets/blog/shell-2-400.webp 400w, /assets/blog/shell-2-1200.webp 1200w">
      <img src="/assets/blog/shell-2-400.webp" alt="detail">
    </picture>
    <h2>Kisa Bolum</h2>
    <p>Cok kisa.</p>
    <h2>Frequently Asked Questions</h2>
    <p>Bu bolum SSS oldugu icin atlanmali. Yeterince uzun olsa bile gonderi olarak zayif kalir, cunku baglamdan koparildiginda anlamsizlasir ve takipciye deger vermez.</p>
  </article>
  <footer><p>Footer paragrafi da girmemeli.</p></footer>
</body>
</html>
`;

export const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://constructionantalya.com/</loc></url>
  <url><loc>https://constructionantalya.com/blog</loc></url>
  <url><loc>https://constructionantalya.com/blog/antalya-luxury-capital</loc></url>
  <url><loc>https://constructionantalya.com/blog/building-your-dream-villa</loc></url>
  <url><loc>https://constructionantalya.com/tr/blog/antalya-luxury-capital</loc></url>
  <url><loc>https://constructionantalya.com/ru/blog/antalya-luxury-capital</loc></url>
  <url><loc>https://constructionantalya.com/projects/kempinski-hotel-dome-belek</loc></url>
  <url><loc>https://constructionantalya.com/projects/villa-project</loc></url>
  <url><loc>https://constructionantalya.com/contact</loc></url>
</urlset>`;

export function makeUnit(overrides: Partial<PostUnit> = {}): PostUnit {
  return {
    id: 'test-article#1',
    articleSlug: 'test-article',
    articleTitle: 'Test Article',
    articleUrl: 'https://constructionantalya.com/blog/test-article',
    heading: 'A Section Heading',
    text: 'Some body text about building a villa in Antalya.',
    keywords: ['villa', 'antalya'],
    images: makeImages(3),
    sectionIndex: 1,
    ...overrides,
  };
}

/** Bir yazinin sayfasindaki gorselleri taklit eder. */
export function makeImages(count: number, prefix = 'shell'): ArticleImage[] {
  return Array.from({ length: count }, (_, index) => ({
    url: `https://constructionantalya.com/assets/blog/${prefix}-${index}.webp`,
    isHero: index === 0,
  }));
}

export function makeState(unitIds: readonly string[] = [], imageUrls: readonly string[] = []): State {
  return {
    posts: unitIds.map((unitId, index) => ({
      unitId,
      articleSlug: unitId.split('#')[0] ?? unitId,
      heading: `Heading ${index}`,
      imageUrl: imageUrls[index] ?? `https://example.com/${index}.jpg`,
      mediaId: `media-${index}`,
      permalink: null,
      publishedAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      topics: [],
      hashtags: [],
      format: 'image' as const,
      insights: null,
    })),
  };
}
