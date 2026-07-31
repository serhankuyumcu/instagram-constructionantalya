import { describe, expect, test } from 'vitest';
import { parseArticle } from '../src/blog/scraper.js';
import { blogUrlsFromSitemap, projectSlugsFromSitemap } from '../src/blog/sitemap.js';
import { extractKeywords, toPostUnits } from '../src/blog/units.js';
import { ARTICLE_HTML, SITEMAP_XML } from './fixtures.js';

const URL = 'https://constructionantalya.com/blog/shell-construction';

describe('parseArticle', () => {
  test('baslikta site adi son ekini temizler', () => {
    const article = parseArticle(ARTICLE_HTML, URL);
    expect(article.title).toBe('Why Shell Construction Matters');
  });

  test('slug URL yolundan cikarilir', () => {
    expect(parseArticle(ARTICLE_HTML, URL).slug).toBe('shell-construction');
  });

  test('nav, header ve footer metnini gonderiye almaz', () => {
    const article = parseArticle(ARTICLE_HTML, URL);
    const allText = article.sections.map((s) => s.text).join(' ');

    expect(allText).not.toContain('article disinda');
    expect(allText).not.toContain('Footer paragrafi');
  });

  test('cok kisa bolumleri eler', () => {
    const article = parseArticle(ARTICLE_HTML, URL);
    expect(article.sections.map((s) => s.heading)).not.toContain('Kisa Bolum');
  });

  test('SSS bolumunu eler', () => {
    const article = parseArticle(ARTICLE_HTML, URL);
    const headings = article.sections.map((s) => s.heading);
    expect(headings).not.toContain('Frequently Asked Questions');
  });

  test('gecerli bolumu paragraflariyla birlikte tutar', () => {
    const article = parseArticle(ARTICLE_HTML, URL);
    const section = article.sections.find((s) => s.heading.includes('90 Per Cent'));

    expect(section).toBeDefined();
    expect(section?.paragraphs).toHaveLength(2);
    expect(section?.text).toContain('reinforced concrete frame');
  });
});

describe('yazi gorsellerinin cikarimi', () => {
  test('govdedeki gorselleri sayfadaki sirayla toplar', () => {
    const urls = parseArticle(ARTICLE_HTML, URL).images.map((i) => i.url);

    expect(urls[0]).toContain('shell-hero.webp');
    expect(urls.some((u) => u.includes('shell-1.webp'))).toBe(true);
  });

  test('ilk gorseli kapak olarak isaretler', () => {
    const images = parseArticle(ARTICLE_HTML, URL).images;

    expect(images[0]?.isHero).toBe(true);
    expect(images.filter((i) => i.isHero)).toHaveLength(1);
  });

  test('logo ve ikonlari disarida birakir', () => {
    const urls = parseArticle(ARTICLE_HTML, URL).images.map((i) => i.url);
    expect(urls.some((u) => u.includes('logo'))).toBe(false);
  });

  test('goreli yollari mutlak URL yapar', () => {
    for (const image of parseArticle(ARTICLE_HTML, URL).images) {
      expect(image.url.startsWith('https://constructionantalya.com/')).toBe(true);
    }
  });

  test('srcset icindeki en buyuk adayi da havuza katar', () => {
    const urls = parseArticle(ARTICLE_HTML, URL).images.map((i) => i.url);
    expect(urls.some((u) => u.includes('shell-2-1200.webp'))).toBe(true);
  });

  test('ayni gorseli iki kez eklemez', () => {
    const urls = parseArticle(ARTICLE_HTML, URL).images.map((i) => i.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  test('gorseli olmayan yazida bos dizi dondurur', () => {
    const html = '<html><head></head><body><article><h1>T</h1><p>Metin.</p></article></body></html>';
    expect(parseArticle(html, URL).images).toEqual([]);
  });
});

describe('sitemap ayristirma', () => {
  test('yalnizca istenen dilin blog yazilarini dondurur', () => {
    const urls = blogUrlsFromSitemap(SITEMAP_XML, 'en');

    expect(urls).toHaveLength(2);
    expect(urls.every((url) => !url.includes('/tr/') && !url.includes('/ru/'))).toBe(true);
  });

  test('blog listeleme sayfasini yazi saymaz', () => {
    const urls = blogUrlsFromSitemap(SITEMAP_XML, 'en');
    expect(urls).not.toContain('https://constructionantalya.com/blog');
  });

  test('turkce surumleri secebilir', () => {
    const urls = blogUrlsFromSitemap(SITEMAP_XML, 'tr');
    expect(urls).toEqual(['https://constructionantalya.com/tr/blog/antalya-luxury-capital']);
  });

  test('proje slug\'larini cikarir', () => {
    expect(projectSlugsFromSitemap(SITEMAP_XML).sort()).toEqual([
      'kempinski-hotel-dome-belek',
      'villa-project',
    ]);
  });
});

describe('toPostUnits', () => {
  test('her bolum icin kalici ve benzersiz bir kimlik uretir', () => {
    const units = toPostUnits(parseArticle(ARTICLE_HTML, URL));

    expect(units.length).toBeGreaterThan(0);
    expect(new Set(units.map((u) => u.id)).size).toBe(units.length);
    expect(units[0]?.id).toMatch(/^shell-construction#\d+$/);
  });

  test('bashligi olmayan giris bolumu yazi basligini kullanir', () => {
    const units = toPostUnits(parseArticle(ARTICLE_HTML, URL));
    expect(units[0]?.heading).toBe('Why Shell Construction Matters');
  });
});

describe('extractKeywords', () => {
  test('durak kelimeleri ayiklar', () => {
    const keywords = extractKeywords('The villa and the pool with that terrace');
    expect(keywords).not.toContain('the');
    expect(keywords).not.toContain('with');
    expect(keywords).toContain('villa');
  });

  test('sik gecen kelimeyi one alir', () => {
    const keywords = extractKeywords('concrete concrete concrete marble');
    expect(keywords[0]).toBe('concrete');
  });

  test('salt sayilari atar', () => {
    expect(extractKeywords('2026 2026 villa')).not.toContain('2026');
  });
});
