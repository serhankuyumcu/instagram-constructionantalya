import { describe, expect, test } from 'vitest';
import { loadPlannedPost, remainingDays } from '../src/plan/calendar.js';
import { formatForDate, resolveFormat } from '../src/pipeline/format.js';

/**
 * Testler gercek takvim klasorunu okuyor.
 *
 * Sahte klasor kurmak yerine bunu tercih ettim: takvimi bozan degisiklik
 * genelde kodda degil klasorde oluyor (bir gorsel silinir, KONU.md'nin
 * basligi degistirilir). Sahte veriyle bu hatalar yayina kadar goze
 * carpmazdi.
 */

const FIRST_DAY = '2026-08-09';

describe('icerik takvimi', () => {
  test('gunun klasorunu tarihe gore bulur', async () => {
    const post = await loadPlannedPost(FIRST_DAY);

    expect(post).not.toBeNull();
    expect(post!.date).toBe(FIRST_DAY);
    expect(post!.project).not.toBe('');
    expect(post!.title).not.toBe('');
  });

  test('gorselleri carousel sirasina gore verir', async () => {
    const post = await loadPlannedPost(FIRST_DAY);
    const names = post!.images.map((image) => image.split('/').pop()!);

    expect(names).toEqual([...names].sort());
    expect(names[0]!.startsWith('01-')).toBe(true);
  });

  test('Instagram carousel sinirlari icinde kalir', async () => {
    const post = await loadPlannedPost(FIRST_DAY);

    expect(post!.images.length).toBeGreaterThanOrEqual(2);
    expect(post!.images.length).toBeLessThanOrEqual(10);
  });

  test('KONU.md icindeki konu ve teknik noktayi ayristirir', async () => {
    const post = await loadPlannedPost(FIRST_DAY);

    expect(post!.brief.length).toBeGreaterThan(40);
    expect(post!.point.length).toBeGreaterThan(40);
    // Alinti isareti caption promptuna sizmamali.
    expect(post!.point.startsWith('>')).toBe(false);
  });

  test('tasarim gorseli olan gunu isaretler', async () => {
    const design = await loadPlannedPost('2026-08-13');
    const site = await loadPlannedPost(FIRST_DAY);

    expect(design!.isDesign).toBe(true);
    expect(site!.isDesign).toBe(false);
  });

  test('takvimde olmayan gun icin null doner', async () => {
    expect(await loadPlannedPost('2027-01-01')).toBeNull();
  });

  test('kalan gun sayisini verir', async () => {
    expect(await remainingDays(FIRST_DAY)).toBeGreaterThan(0);
    expect(await remainingDays('2027-01-01')).toBe(0);
  });

  test('ayni proje ust uste iki gun gelmez', async () => {
    const dates = Array.from({ length: 14 }, (_, i) =>
      new Date(Date.UTC(2026, 7, 9 + i)).toISOString().slice(0, 10),
    );
    const posts = await Promise.all(dates.map((d) => loadPlannedPost(d)));
    const projects = posts.filter((p) => p !== null).map((p) => p!.project);

    for (let i = 1; i < projects.length; i++) {
      expect(projects[i]).not.toBe(projects[i - 1]);
    }
  });
});

describe('gonderi bicimi', () => {
  test('sabah carousel, aksam reel', () => {
    expect(formatForDate(new Date('2026-08-09T06:00:00Z'))).toBe('carousel');
    expect(formatForDate(new Date('2026-08-09T17:00:00Z'))).toBe('reel');
  });

  test('bayrak saatten onceliklidir', () => {
    const evening = new Date('2026-08-09T17:00:00Z');

    expect(resolveFormat(['--carousel'], evening)).toBe('carousel');
    expect(resolveFormat(['--image'], evening)).toBe('image');
    expect(resolveFormat([], evening)).toBe('reel');
  });
});
