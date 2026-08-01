import { fetchWithRetry } from '../lib/http.js';
import type { PostInsights } from '../state/store.js';

const GRAPH_VERSION = process.env.GRAPH_API_VERSION ?? 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * Instagram gonderi metrikleri.
 *
 * Meta bu metrik adlarini surumler arasinda degistiriyor (impressions -> views
 * gibi) ve desteklenmeyen tek bir metrik istegin tamamini hataya dusuruyor.
 * Bu yuzden metrikler kademeli isteniyor: once genis set, hata olursa
 * kesinlikle desteklenen cekirdek set.
 */
const PREFERRED_METRICS = ['reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions'];
const FALLBACK_METRICS = ['reach', 'likes', 'comments'];

interface InsightValue {
  name: string;
  values?: { value?: number }[];
}

export class InsightsClient {
  constructor(private readonly accessToken: string) {}

  /**
   * Tek bir gonderinin metriklerini ceker.
   *
   * Silinmis gonderiler veya metrik desteklemeyen medya tipleri icin null
   * doner; bu bir hata degildir ve toplama isini durdurmamalidir.
   */
  async fetchForMedia(mediaId: string): Promise<PostInsights | null> {
    const values = (await this.request(mediaId, PREFERRED_METRICS)) ?? (await this.request(mediaId, FALLBACK_METRICS));

    if (values === null) return null;

    const read = (name: string): number | null => {
      const entry = values.find((value) => value.name === name);
      const raw = entry?.values?.[0]?.value;
      return typeof raw === 'number' ? raw : null;
    };

    return {
      reach: read('reach'),
      likes: read('likes'),
      comments: read('comments'),
      saved: read('saved'),
      shares: read('shares'),
      totalInteractions: read('total_interactions'),
      collectedAt: new Date().toISOString(),
    };
  }

  private async request(mediaId: string, metrics: readonly string[]): Promise<InsightValue[] | null> {
    try {
      const url = new URL(`${GRAPH_BASE}/${mediaId}/insights`);
      url.searchParams.set('metric', metrics.join(','));
      url.searchParams.set('access_token', this.accessToken);

      const response = await fetchWithRetry(url.toString());
      const payload = (await response.json()) as { data?: InsightValue[] };

      return payload.data ?? null;
    } catch {
      return null;
    }
  }
}

/**
 * Metrikler yayindan hemen sonra bos veya yaniltici gelir. Bir gonderi
 * en az bu kadar beklemeden toplamaya dahil edilmez.
 */
export const MIN_AGE_HOURS = 24;

/**
 * Eski gonderilerin rakamlari artik degismedigi icin surekli yeniden
 * sorgulanmalari bosuna API cagrisi olur. Bu pencerenin disindakiler
 * yalnizca hic verisi yoksa cekilir.
 */
export const REFRESH_WINDOW_DAYS = 30;

export function shouldCollect(publishedAt: string, hasInsights: boolean, now = new Date()): boolean {
  const published = new Date(publishedAt).getTime();
  if (Number.isNaN(published)) return false;

  const ageHours = (now.getTime() - published) / 3_600_000;
  if (ageHours < MIN_AGE_HOURS) return false;

  const ageDays = ageHours / 24;
  return ageDays <= REFRESH_WINDOW_DAYS || !hasInsights;
}
