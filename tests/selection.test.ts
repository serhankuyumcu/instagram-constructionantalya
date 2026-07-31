import { describe, expect, test } from 'vitest';
import { detectTopics } from '../src/content/topics.js';
import { selectImage } from '../src/image/select.js';
import { selectNextUnit } from '../src/pipeline/select-unit.js';
import { makeImages, makeState, makeUnit } from './fixtures.js';

describe('detectTopics', () => {
  test('otel icerigini hotel konusuna baglar', () => {
    expect(detectTopics('The hotel and resort project in Belek')).toContain('hotel');
  });

  test('turkce metinde de konu bulur', () => {
    expect(detectTopics('Betonarme kaba yapı ve temel işleri')).toContain('shell');
  });

  test('rusca metinde de konu bulur', () => {
    expect(detectTopics('Строительство отеля и бассейна')).toContain('hotel');
  });

  test('konulari guce gore siralar', () => {
    const topics = detectTopics('villa villa villa. One hotel mention.');
    expect(topics[0]).toBe('villa');
  });

  test('ilgisiz metinde bos dizi dondurur', () => {
    expect(detectTopics('Lorem ipsum dolor sit amet')).toEqual([]);
  });
});

describe('selectImage', () => {
  test('gorseli daima yazinin kendi sayfasindan secer', () => {
    const images = makeImages(3, 'permit');
    const choice = selectImage(makeUnit({ images }), []);

    expect(images.map((i) => i.url)).toContain(choice.image.url);
  });

  test('giris bolumune kapak gorselini verir', () => {
    const choice = selectImage(makeUnit({ sectionIndex: 0, images: makeImages(4) }), []);
    expect(choice.image.isHero).toBe(true);
  });

  test('ayni girdi icin her zaman ayni sonucu verir', () => {
    const unit = makeUnit({ sectionIndex: 2, images: makeImages(4) });

    expect(selectImage(unit, []).image.url).toBe(selectImage(unit, []).image.url);
  });

  test('bolumler arasinda gorselleri donusumlu dagitir', () => {
    const images = makeImages(3);
    const picks = [0, 1, 2].map((sectionIndex) => selectImage(makeUnit({ sectionIndex, images }), []).image.url);

    expect(new Set(picks).size).toBe(3);
  });

  test('gorsel sayisi bolum sayisindan azsa basa doner', () => {
    const images = makeImages(2);
    const first = selectImage(makeUnit({ sectionIndex: 0, images }), []);
    const third = selectImage(makeUnit({ sectionIndex: 2, images }), []);

    expect(third.image.url).toBe(first.image.url);
  });

  test('yakin zamanda kullanilan gorseli atlar', () => {
    const images = makeImages(3);
    const preferred = images[1]!.url;
    const choice = selectImage(makeUnit({ sectionIndex: 1, images }), [preferred]);

    expect(choice.image.url).not.toBe(preferred);
  });

  test('tum gorseller yakin zamanda kullanilmissa yine de bir sonuc dondurur', () => {
    const images = makeImages(2);
    const choice = selectImage(makeUnit({ images }), images.map((i) => i.url));

    expect(images.map((i) => i.url)).toContain(choice.image.url);
  });

  test('yazinin gorseli yoksa acik hata verir', () => {
    expect(() => selectImage(makeUnit({ images: [] }), [])).toThrow(/gorsel bulunamadi/i);
  });
});

describe('selectNextUnit', () => {
  const units = [
    makeUnit({ id: 'a#0', articleSlug: 'a' }),
    makeUnit({ id: 'a#1', articleSlug: 'a' }),
    makeUnit({ id: 'b#0', articleSlug: 'b' }),
    makeUnit({ id: 'b#1', articleSlug: 'b' }),
  ];

  test('bos gecmiste ilk bolumden baslar', () => {
    const { unit, isRecycled } = selectNextUnit(units, makeState());

    expect(unit.id).toBe('a#0');
    expect(isRecycled).toBe(false);
  });

  test('ayni yaziyi ust uste paylasmaz', () => {
    const { unit } = selectNextUnit(units, makeState(['a#0']));
    expect(unit.articleSlug).toBe('b');
  });

  test('paylasilmis bolumu yeniden secmez', () => {
    const state = makeState(['a#0', 'b#0']);
    const { unit } = selectNextUnit(units, state);

    expect(['a#1', 'b#1']).toContain(unit.id);
  });

  test('havuz tukendiginde en eski bolumu yeniden dolasima sokar', () => {
    const state = makeState(['a#0', 'b#0', 'a#1', 'b#1']);
    const { unit, isRecycled } = selectNextUnit(units, state);

    expect(isRecycled).toBe(true);
    expect(unit.id).toBe('a#0');
  });

  test('havuz bossa acik hata verir', () => {
    expect(() => selectNextUnit([], makeState())).toThrow(/havuzu bos/i);
  });
});
