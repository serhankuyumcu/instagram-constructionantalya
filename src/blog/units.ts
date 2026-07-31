import type { Article, PostUnit } from './types.js';

/**
 * Uc dilde de ayiklanan yaygin kelimeler. Anahtar kelime cikariminin
 * "the / ve / это" gibi tasiyicisiz terimlerle dolmasini engeller.
 */
const STOPWORDS = new Set([
  // en
  'the','and','for','with','that','this','from','are','was','were','has','have','had','not','but','you','your',
  'its','it','a','an','of','to','in','on','at','by','as','is','be','or','we','our','they','their','more','most',
  'than','then','when','where','which','who','what','how','why','can','will','would','should','could','into',
  'out','up','down','over','under','about','after','before','also','very','much','many','some','any','all','one',
  'two','three','every','each','both','other','same','such','only','just','even','still','way','ways','make',
  'makes','made','take','takes','get','gets','like','well','back','here','there','now','new','first','last',
  // tr
  've','ile','bir','bu','da','de','için','olan','olarak','daha','çok','gibi','ama','ancak','veya','ise','her',
  'kadar','sonra','önce','göre','üzere','yani','hem','ki','mi','mu','en','şey','var','yok','olur','oluyor',
  // ru
  'и','в','на','с','по','для','что','как','это','из','не','но','или','также','при','от','до','за','то','же',
  'все','был','была','было','быть','есть','его','ее','их','мы','вы','они','он','она','который','которые',
]);

const MIN_KEYWORD_LENGTH = 4;
const MAX_KEYWORDS = 12;

/**
 * Bir yaziyi, her biri tek bir Instagram gonderisine karsilik gelen
 * birimlere ceviren fonksiyon. 10 yazi x ~10 bolum = ~100 benzersiz gonderi.
 */
export function toPostUnits(article: Article): PostUnit[] {
  return article.sections.map((section) => ({
    id: `${article.slug}#${section.index}`,
    articleSlug: article.slug,
    articleTitle: article.title,
    articleUrl: article.url,
    heading: section.heading || article.title,
    text: section.text,
    keywords: extractKeywords(`${section.heading} ${section.text}`),
    images: article.images,
    sectionIndex: section.index,
  }));
}

/**
 * Frekans tabanli anahtar kelime cikarimi. Baslikta gecen kelimeler
 * agirliklandirilir; gorsel eslestirme buyuk olcude bunlara dayanir.
 */
export function extractKeywords(text: string): string[] {
  const counts = new Map<string, number>();

  for (const raw of text.toLocaleLowerCase('tr').split(/[^\p{L}\p{N}]+/u)) {
    const word = raw.trim();
    if (word.length < MIN_KEYWORD_LENGTH || STOPWORDS.has(word)) continue;
    if (/^\d+$/.test(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_KEYWORDS)
    .map(([word]) => word);
}
