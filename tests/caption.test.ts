import { describe, expect, test } from 'vitest';
import { CAPTION_LIMIT, assembleCaption } from '../src/caption/generator.js';
import { buildHashtags } from '../src/caption/hashtags.js';
import { withPost } from '../src/state/store.js';
import { makeState } from './fixtures.js';

const LINK = 'https://constructionantalya.com/blog/test';

describe('assembleCaption', () => {
  test('govde, bag ve etiketleri birlestirir', () => {
    const caption = assembleCaption('Govde metni.', LINK, '#a #b');

    expect(caption).toContain('Govde metni.');
    expect(caption).toContain(LINK);
    expect(caption.endsWith('#a #b')).toBe(true);
  });

  test('Instagram limitini asmaz', () => {
    const caption = assembleCaption('x'.repeat(5000), LINK, '#a #b #c');
    expect(caption.length).toBeLessThanOrEqual(CAPTION_LIMIT);
  });

  test('limit asildiginda etiketleri korur, govdeyi kisaltir', () => {
    const hashtags = '#constructionantalya #antalya #villa';
    const caption = assembleCaption('x'.repeat(5000), LINK, hashtags);

    expect(caption).toContain(hashtags);
    expect(caption).toContain(LINK);
  });
});

describe('buildHashtags', () => {
  test('marka etiketi her zaman bulunur', () => {
    expect(buildHashtags(['villa'], 0).tags).toContain('#constructionantalya');
  });

  test('makul bir etiket sayisi uretir', () => {
    const { tags } = buildHashtags(['hotel', 'pool'], 3);

    expect(tags.length).toBeGreaterThanOrEqual(10);
    expect(tags.length).toBeLessThanOrEqual(16);
  });

  test('tekrar eden etiket icermez', () => {
    const { tags } = buildHashtags(['villa', 'residential', 'finishing'], 7);
    expect(new Set(tags).size).toBe(tags.length);
  });

  test('konuya ozel etiket ekler', () => {
    expect(buildHashtags(['hotel'], 0).tags.some((t) => t.includes('hotel'))).toBe(true);
  });

  test('ardisik gonderilerde set degisir', () => {
    const first = buildHashtags(['villa'], 0).text;
    const second = buildHashtags(['villa'], 1).text;

    expect(first).not.toBe(second);
  });

  test('konu yoksa bile calisir', () => {
    const { tags } = buildHashtags([], 0);

    expect(tags).toContain('#constructionantalya');
    expect(tags.length).toBeGreaterThan(5);
  });

  test('tum etiketler # ile baslar ve bosluk icermez', () => {
    for (const tag of buildHashtags(['shell', 'exterior'], 5).tags) {
      expect(tag.startsWith('#')).toBe(true);
      expect(tag).not.toContain(' ');
    }
  });
});

describe('durum kaydi', () => {
  test('withPost mevcut durumu degistirmez', () => {
    const state = makeState(['a#0']);
    const next = withPost(state, {
      unitId: 'b#0',
      articleSlug: 'b',
      heading: 'H',
      imageUrl: 'https://x/i.jpg',
      mediaId: 'm1',
      permalink: null,
      publishedAt: '2026-02-01T00:00:00.000Z',
      topics: [],
      hashtags: [],
      format: 'image',
      insights: null,
    });

    expect(state.posts).toHaveLength(1);
    expect(next.posts).toHaveLength(2);
    expect(next.posts).not.toBe(state.posts);
  });
});
