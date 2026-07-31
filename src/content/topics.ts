/**
 * Bir bolumun ne hakkinda oldugunu tespit eder.
 *
 * Iki yerde kullanilir: hashtag setinin konuya ozel katmani ve gorselin
 * ustundeki kucuk etiket (kicker). Gorsel secimiyle iliskisi yoktur;
 * gorsel daima yazinin kendi sayfasindan gelir.
 */

export const TOPICS = [
  'hotel',
  'villa',
  'residential',
  'shell',
  'finishing',
  'exterior',
  'interior',
  'pool',
  'sustainability',
] as const;

export type Topic = (typeof TOPICS)[number];

const TOPIC_SIGNALS: Readonly<Record<Topic, readonly RegExp[]>> = {
  hotel: [/\bhotels?\b/i, /\bresorts?\b/i, /hospitality/i, /\botel\b/i, /tatil köyü/i, /отел/i, /курорт/i],
  villa: [/\bvillas?\b/i, /\bvilla\b/i, /\bвилл/i, /detached home/i],
  residential: [/residenc/i, /apartment/i, /\bhomes?\b/i, /konut/i, /daire/i, /жиль/i, /квартир/i],
  shell: [
    /shell construction/i, /reinforced concrete/i, /structur/i, /foundation/i, /\bframe\b/i,
    /kaba yapı/i, /betonarme/i, /temel/i, /каркас/i, /бетон/i,
  ],
  finishing: [
    /finish/i, /craftsmanship/i, /joinery/i, /marble/i, /detail/i, /material/i,
    /ince iş/i, /mermer/i, /işçilik/i, /отделк/i, /мрамор/i,
  ],
  exterior: [/facade/i, /exterior/i, /landscap/i, /cephe/i, /dış/i, /фасад/i],
  interior: [/interior/i, /\brooms?\b/i, /lobby/i, /kitchen/i, /bathroom/i, /iç mekan/i, /интерьер/i],
  pool: [/\bpools?\b/i, /\bspa\b/i, /havuz/i, /бассейн/i],
  sustainability: [
    /sustainab/i, /energy efficien/i, /insulation/i, /\bgreen\b/i, /carbon/i,
    /sürdürülebilir/i, /yalıtım/i, /устойчив/i, /энергоэффект/i,
  ],
};

/** Metinde en cok sinyal veren konulari, guclu olandan zayifa dogru dondurur. */
export function detectTopics(text: string): Topic[] {
  const scored = TOPICS.map((topic) => {
    const score = TOPIC_SIGNALS[topic].reduce((sum, re) => {
      const matches = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`));
      return sum + (matches?.length ?? 0);
    }, 0);
    return { topic, score };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.topic);
}
