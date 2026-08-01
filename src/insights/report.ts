import type { PostRecord } from '../state/store.js';

/**
 * Performans raporunun hesaplama katmani. Ag erisimi ve bicimlendirme
 * icermez; boylece dogrulugu testle guvence altina alinabilir.
 */

/** Bir grubun anlamli sayilmasi icin gereken en az gonderi sayisi. */
export const MIN_SAMPLE = 3;

export interface Metrics {
  readonly count: number;
  readonly reach: number;
  readonly likes: number;
  readonly saved: number;
  readonly interactions: number;
  /**
   * Etkilesim / erisim. Gonderileri kiyaslamanin en adil yolu budur:
   * ham begeni sayisi hesabin o gunku erisimine gore sisip duser,
   * oran ise icerigin gercekten ilgi cekip cekmedigini gosterir.
   */
  readonly engagementRate: number | null;
}

export interface Group extends Metrics {
  readonly key: string;
  /** Orneklem MIN_SAMPLE altindaysa sonuc yanilticidir. */
  readonly isReliable: boolean;
}

/** Yalnizca metrik verisi toplanmis gonderiler raporlanabilir. */
export function measurable(posts: readonly PostRecord[]): PostRecord[] {
  return posts.filter((post) => post.insights !== null);
}

export function summarize(posts: readonly PostRecord[]): Metrics {
  const totals = posts.reduce(
    (acc, post) => ({
      reach: acc.reach + (post.insights?.reach ?? 0),
      likes: acc.likes + (post.insights?.likes ?? 0),
      saved: acc.saved + (post.insights?.saved ?? 0),
      interactions: acc.interactions + interactionsOf(post),
    }),
    { reach: 0, likes: 0, saved: 0, interactions: 0 },
  );

  return {
    count: posts.length,
    ...totals,
    engagementRate: totals.reach > 0 ? totals.interactions / totals.reach : null,
  };
}

/**
 * Gonderileri bir anahtara gore gruplar. Bir gonderi birden fazla gruba
 * girebilir (ornegin uc konusu varsa uc grupta da sayilir), bu yuzden
 * anahtar cikarici dizi dondurur.
 */
export function groupBy(posts: readonly PostRecord[], keysOf: (post: PostRecord) => readonly string[]): Group[] {
  const buckets = new Map<string, PostRecord[]>();

  for (const post of posts) {
    for (const key of keysOf(post)) {
      const bucket = buckets.get(key);
      if (bucket) bucket.push(post);
      else buckets.set(key, [post]);
    }
  }

  return [...buckets.entries()]
    .map(([key, group]) => ({
      key,
      ...summarize(group),
      isReliable: group.length >= MIN_SAMPLE,
    }))
    .sort(compareByEngagement);
}

/** En iyi performans gosteren gonderiler, etkilesim oranina gore. */
export function topPosts(posts: readonly PostRecord[], limit: number): PostRecord[] {
  return [...posts]
    .filter((post) => (post.insights?.reach ?? 0) > 0)
    .sort((a, b) => engagementRateOf(b) - engagementRateOf(a))
    .slice(0, limit);
}

export function engagementRateOf(post: PostRecord): number {
  const reach = post.insights?.reach ?? 0;
  return reach > 0 ? interactionsOf(post) / reach : 0;
}

/**
 * total_interactions bazi hesaplarda gelmiyor; o durumda begeni, yorum,
 * kaydetme ve paylasim toplami makul bir vekil olusturur.
 */
function interactionsOf(post: PostRecord): number {
  const insights = post.insights;
  if (!insights) return 0;
  if (insights.totalInteractions !== null) return insights.totalInteractions;

  return (insights.likes ?? 0) + (insights.comments ?? 0) + (insights.saved ?? 0) + (insights.shares ?? 0);
}

/** Guvenilir gruplar once; esitlikte etkilesim orani belirleyici. */
function compareByEngagement(a: Group, b: Group): number {
  if (a.isReliable !== b.isReliable) return a.isReliable ? -1 : 1;
  return (b.engagementRate ?? 0) - (a.engagementRate ?? 0);
}
