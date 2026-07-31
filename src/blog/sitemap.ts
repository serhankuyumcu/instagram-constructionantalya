import { fetchText } from '../lib/http.js';

/** Sitemap tek sefer indirilir; blog ve proje URL'leri ayni belgeden cikarilir. */
export async function fetchSitemap(baseUrl: string): Promise<string> {
  return fetchText(new URL('/sitemap.xml', baseUrl).toString());
}

/**
 * Blog yazisi URL'lerini secer.
 *
 * Site yol tabanli i18n kullaniyor (/blog, /tr/blog, /ru/blog). Ayni yazinin
 * ceviri surumleri ayni icerigi tasidigindan yalnizca istenen dilin
 * URL'lerini aliriz; aksi halde havuzda ucer kopya olusur.
 */
export function blogUrlsFromSitemap(xml: string, locale: string): string[] {
  const prefix = locale === 'en' ? '/blog/' : `/${locale}/blog/`;

  return locations(xml).filter((url) => {
    const path = safePathname(url);
    if (path === null || !path.startsWith(prefix)) return false;
    // "/blog/" listeleme sayfasini degil, yalnizca yazilari istiyoruz.
    return path.length > prefix.length;
  });
}

/** Gorsel havuzunun kaynagi olan proje sayfalarinin slug'lari. */
export function projectSlugsFromSitemap(xml: string): string[] {
  const slugs = new Set<string>();

  for (const url of locations(xml)) {
    const path = safePathname(url);
    const match = path?.match(/^\/projects\/([\w-]+)$/);
    if (match) slugs.add(match[1] as string);
  }

  return [...slugs];
}

function locations(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1] as string);
}

function safePathname(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}
