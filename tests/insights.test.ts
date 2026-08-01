import { describe, expect, test } from 'vitest';
import { shouldCollect } from '../src/instagram/insights.js';
import { MIN_SAMPLE, engagementRateOf, groupBy, measurable, summarize, topPosts } from '../src/insights/report.js';
import { withInsights } from '../src/state/store.js';
import type { PostInsights, PostRecord } from '../src/state/store.js';
import { makeState } from './fixtures.js';

function makeInsights(overrides: Partial<PostInsights> = {}): PostInsights {
  return {
    reach: 1000,
    likes: 50,
    comments: 5,
    saved: 20,
    shares: 5,
    totalInteractions: 80,
    collectedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  };
}

function makePost(overrides: Partial<PostRecord> = {}): PostRecord {
  return {
    unitId: 'a#0',
    articleSlug: 'a',
    heading: 'Baslik',
    imageUrl: 'https://x/assets/blog/shell-1.webp',
    mediaId: 'm1',
    permalink: null,
    publishedAt: '2026-08-01T00:00:00.000Z',
    topics: ['shell'],
    hashtags: ['#antalya'],
    format: 'image',
    insights: makeInsights(),
    ...overrides,
  };
}

describe('shouldCollect', () => {
  const now = new Date('2026-08-10T12:00:00.000Z');

  test('24 saatten yeni gonderiyi atlar', () => {
    expect(shouldCollect('2026-08-10T06:00:00.000Z', false, now)).toBe(false);
  });

  test('bir gunluk gonderiyi toplar', () => {
    expect(shouldCollect('2026-08-09T06:00:00.000Z', false, now)).toBe(true);
  });

  test('son bir aylik gonderiyi verisi olsa da tazeler', () => {
    expect(shouldCollect('2026-07-25T00:00:00.000Z', true, now)).toBe(true);
  });

  test('cok eski ve verisi olan gonderiyi tekrar sorgulamaz', () => {
    expect(shouldCollect('2026-05-01T00:00:00.000Z', true, now)).toBe(false);
  });

  test('cok eski ama verisi olmayan gonderiyi yine de toplar', () => {
    expect(shouldCollect('2026-05-01T00:00:00.000Z', false, now)).toBe(true);
  });

  test('gecersiz tarihte toplama yapmaz', () => {
    expect(shouldCollect('bozuk-tarih', false, now)).toBe(false);
  });
});

describe('measurable', () => {
  test('yalnizca metrigi olan gonderileri dondurur', () => {
    const posts = [makePost({ mediaId: 'm1' }), makePost({ mediaId: 'm2', insights: null })];
    expect(measurable(posts).map((p) => p.mediaId)).toEqual(['m1']);
  });
});

describe('summarize', () => {
  test('metrikleri toplar', () => {
    const result = summarize([makePost(), makePost({ mediaId: 'm2' })]);

    expect(result.count).toBe(2);
    expect(result.reach).toBe(2000);
    expect(result.likes).toBe(100);
  });

  test('etkilesim oranini erisime bolerek hesaplar', () => {
    const result = summarize([makePost({ insights: makeInsights({ reach: 1000, totalInteractions: 100 }) })]);
    expect(result.engagementRate).toBeCloseTo(0.1);
  });

  test('erisim sifirsa oran null doner (sifira bolme yok)', () => {
    const result = summarize([makePost({ insights: makeInsights({ reach: 0 }) })]);
    expect(result.engagementRate).toBeNull();
  });

  test('bos listede cokmez', () => {
    expect(summarize([]).count).toBe(0);
  });
});

describe('groupBy', () => {
  test('gonderiyi birden fazla konuda sayar', () => {
    const groups = groupBy([makePost({ topics: ['shell', 'villa'] })], (post) => post.topics);
    expect(groups.map((g) => g.key).sort()).toEqual(['shell', 'villa']);
  });

  test('orneklem yetersizse guvenilmez isaretler', () => {
    const groups = groupBy([makePost()], (post) => post.topics);
    expect(groups[0]?.isReliable).toBe(false);
  });

  test('yeterli orneklemde guvenilir isaretler', () => {
    const posts = Array.from({ length: MIN_SAMPLE }, (_, i) => makePost({ mediaId: `m${i}` }));
    const groups = groupBy(posts, (post) => post.topics);

    expect(groups[0]?.isReliable).toBe(true);
    expect(groups[0]?.count).toBe(MIN_SAMPLE);
  });

  test('guvenilir gruplari one alir', () => {
    const posts = [
      ...Array.from({ length: MIN_SAMPLE }, (_, i) => makePost({ mediaId: `s${i}`, topics: ['shell'] })),
      // Tek gonderilik grup daha yuksek oranli ama guvenilmez.
      makePost({ mediaId: 'v1', topics: ['villa'], insights: makeInsights({ totalInteractions: 900 }) }),
    ];

    expect(groupBy(posts, (post) => post.topics)[0]?.key).toBe('shell');
  });
});

describe('engagementRateOf', () => {
  test('total_interactions yoksa bilesenlerden hesaplar', () => {
    const post = makePost({
      insights: makeInsights({ reach: 100, totalInteractions: null, likes: 5, comments: 2, saved: 2, shares: 1 }),
    });
    expect(engagementRateOf(post)).toBeCloseTo(0.1);
  });

  test('erisim sifirsa sifir doner', () => {
    expect(engagementRateOf(makePost({ insights: makeInsights({ reach: 0 }) }))).toBe(0);
  });
});

describe('topPosts', () => {
  test('etkilesim oranina gore siralar', () => {
    const posts = [
      makePost({ mediaId: 'dusuk', insights: makeInsights({ reach: 1000, totalInteractions: 10 }) }),
      makePost({ mediaId: 'yuksek', insights: makeInsights({ reach: 1000, totalInteractions: 500 }) }),
    ];
    expect(topPosts(posts, 2)[0]?.mediaId).toBe('yuksek');
  });

  test('erisimi olmayanlari disarida birakir', () => {
    const posts = [makePost({ mediaId: 'bos', insights: makeInsights({ reach: 0 }) })];
    expect(topPosts(posts, 5)).toHaveLength(0);
  });
});

describe('withInsights', () => {
  test('yalnizca hedef gonderiyi gunceller', () => {
    const state = makeState(['a#0', 'b#0']);
    const next = withInsights(state, 'media-1', makeInsights({ reach: 42 }));

    expect(next.posts[1]?.insights?.reach).toBe(42);
    expect(next.posts[0]?.insights).toBeNull();
  });

  test('mevcut durumu degistirmez', () => {
    const state = makeState(['a#0']);
    withInsights(state, 'media-0', makeInsights());

    expect(state.posts[0]?.insights).toBeNull();
  });
});
