import { describe, expect, test } from 'vitest';
import { detectTopics } from '../src/content/topics.js';
import { selectImage } from '../src/image/select.js';
import { selectPhotos } from '../src/photos/library.js';
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

  test('daha once kullanilan gorseli atlar', () => {
    const images = makeImages(3);
    const preferred = images[1]!.url;
    const choice = selectImage(makeUnit({ sectionIndex: 1, images }), [preferred]);

    expect(choice.image.url).not.toBe(preferred);
  });

  test('kullanilmis gorsel ne kadar eski olursa olsun geri gelmez', () => {
    const images = makeImages(3);
    const preferred = images[1]!.url;
    // Aradan 200 gonderi gecmis olmasi hicbir sey degistirmemeli: eski
    // "son N gonderi" penceresi tam burada tekrara yol aciyordu.
    const history = [preferred, ...Array.from({ length: 200 }, (_, i) => `https://other/${i}.webp`)];

    expect(selectImage(makeUnit({ sectionIndex: 1, images }), history).image.url).not.toBe(preferred);
  });

  test('tum gorseller kullanilmissa isFresh false doner', () => {
    const images = makeImages(2);
    const choice = selectImage(makeUnit({ images }), images.map((i) => i.url));

    expect(choice.isFresh).toBe(false);
    expect(images.map((i) => i.url)).toContain(choice.image.url);
  });

  test('taze gorsel varken isFresh true doner', () => {
    const images = makeImages(3);
    expect(selectImage(makeUnit({ images }), [images[0]!.url]).isFresh).toBe(true);
  });
});

describe('selectPhotos', () => {
  const photo = (path: string, topics: string[], project?: string, height = 2000) => ({
    path,
    topics,
    orientation: 'portrait' as const,
    width: 1500,
    height,
    ...(project === undefined ? {} : { project }),
  });

  const pool = [
    photo('/a1.webp', ['hotel'], 'alpha'),
    photo('/a2.webp', ['hotel'], 'alpha'),
    photo('/a3.webp', ['hotel'], 'alpha'),
    photo('/b1.webp', ['hotel'], 'beta'),
    photo('/b2.webp', ['hotel'], 'beta'),
    photo('/c1.webp', ['hotel'], 'gamma'),
    photo('/d1.webp', ['villa'], 'delta'),
  ];

  test('kullanilmis kareyi taze kare varken secmez', () => {
    const picked = selectPhotos(pool, ['hotel'], 3, ['/a1.webp', '/b1.webp']);

    expect(picked.map((p) => p.path)).not.toContain('/a1.webp');
    expect(picked.map((p) => p.path)).not.toContain('/b1.webp');
  });

  test('bir reel icin ayni projeden iki kare secmez', () => {
    const projects = selectPhotos(pool, ['hotel'], 3, []).map((p) => p.project);

    expect(new Set(projects).size).toBe(3);
  });

  test('yeterli proje yoksa cesitlilik kisitini gevsetir', () => {
    const picked = selectPhotos([pool[0]!, pool[1]!, pool[2]!], ['hotel'], 3, []);

    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((p) => p.path)).size).toBe(3);
  });

  test('konusu uymayan taze kareyi, konusu uyan kullanilmis kareye tercih eder', () => {
    const used = ['/a1.webp', '/a2.webp', '/a3.webp', '/b1.webp', '/b2.webp', '/c1.webp'];
    const picked = selectPhotos(pool, ['hotel'], 1, used);

    expect(picked[0]!.path).toBe('/d1.webp');
  });

  test('havuz tamamen tukendiginde en eski kullanilana doner', () => {
    const used = pool.map((p) => p.path);
    expect(selectPhotos(pool, ['hotel'], 1, used)[0]!.path).toBe('/a1.webp');
  });

  test('preferTall ile kisa kareler geriye duser', () => {
    const mixed = [photo('/short.webp', ['hotel'], 'x', 900), photo('/tall.webp', ['hotel'], 'y', 2000)];

    expect(selectPhotos(mixed, ['hotel'], 1, [], { preferTall: true })[0]!.path).toBe('/tall.webp');
  });

  test('ayni girdi icin her zaman ayni sonucu verir', () => {
    const a = selectPhotos(pool, ['hotel'], 3, ['/a1.webp']).map((p) => p.path);
    const b = selectPhotos(pool, ['hotel'], 3, ['/a1.webp']).map((p) => p.path);

    expect(a).toEqual(b);
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
