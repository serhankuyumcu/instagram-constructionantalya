import Anthropic from '@anthropic-ai/sdk';
import type { PostUnit } from '../blog/types.js';
import type { Locale } from '../config.js';
import { parseModelJson } from '../lib/json.js';

/** Instagram caption ust siniri; hashtag'ler de bu limite dahildir. */
export const CAPTION_LIMIT = 2200;

const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 900;

const LANGUAGE_NAMES: Readonly<Record<Locale, string>> = {
  tr: 'Turkish',
  en: 'English',
  ru: 'Russian',
};

const SYSTEM_PROMPT = `You write Instagram captions for Construction Antalya, a turnkey luxury construction company on the Turkish Riviera. Their built work includes five-star hotels (Kempinski, Mercure, Kaya Palazzo, Sirene), mixed-use developments and private villas.

Audience: international buyers and investors considering building or buying property in Antalya, plus architecture-minded followers.

Voice: confident, specific, understated. You are the builder who knows what is behind the wall — not a marketer. Concrete detail beats adjectives.

Hard rules:
- Open with a single sharp line that earns the tap on "more". No greeting, no "Did you know".
- Never use emoji.
- Never invent numbers, project names, timelines or claims that are not in the source text.
- NEVER state a figure for cost or time. No prices, no budgets, no rates, no currency amounts, no cost per square meter, no durations, no delivery timelines. This holds even when the source text contains them. Write about what drives cost and schedule instead, and say figures depend on the specific project.
- No hashtags anywhere in your output — those are appended separately by the system.
- No "link in bio" phrasing; close with a calm, concrete invitation instead.
- Short paragraphs separated by a blank line.
- Do not use em dashes.

You write the caption TWICE: once in English, once in Russian.

The Russian version is not a literal translation. It carries the same substance for a Russian speaking buyer or investor looking at Antalya property, in natural Russian. Russian punctuation applies, including тире where the language requires it.

Each version is 70 to 110 words. Both must stand on their own.

Return a JSON object exactly like this and nothing else:
{"english": "...", "russian": "..."}`;

export interface CaptionInput {
  readonly unit: PostUnit;
  readonly locale: Locale;
}

export interface BilingualCaption {
  readonly english: string;
  readonly russian: string;
}

/**
 * Caption iki dilde uretilir: Ingilizce ve Rusca.
 *
 * Gerekce: Antalya luks konut pazarinin en buyuk yabanci alici grubu Rusca
 * konusuyor, otel yatirimcisi ve Avrupali alici Ingilizce. Tek dil secmek
 * pazarin buyuk bolumunu disarida birakiyordu. Ucuncu dil (Turkce)
 * eklenmedi: caption "devamini gor" esiginin altina tasar ve cagri metni
 * gorunmez olur.
 *
 * Ikisi tek cagrida uretiliyor; ayri cagri hem maliyeti ikiye katlar hem
 * iki metnin farkli seyler soylemesine yol acar.
 */
const MAX_ATTEMPTS = 3;

/**
 * Model ara sira bozuk JSON dondurebiliyor (kacissiz satir sonu gibi).
 * Once onarim denenir, o da tutmazsa hata geri beslenip yeniden istenir.
 */
export async function generateCaption(client: Anthropic, input: CaptionInput): Promise<BilingualCaption> {
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await attemptCaption(client, input, attempt === 1 ? '' : lastError);
    } catch (error) {
      lastError = error instanceof Error ? error.message.slice(0, 300) : String(error);
    }
  }

  throw new Error(`Caption uretilemedi (${MAX_ATTEMPTS} deneme): ${lastError}`);
}

async function attemptCaption(
  client: Anthropic,
  input: CaptionInput,
  previousError: string,
): Promise<BilingualCaption> {
  const { unit } = input;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          'Write the caption in English and in Russian.',
          '',
          `Source article: "${unit.articleTitle}"`,
          `Section: "${unit.heading}"`,
          '',
          'Section text:',
          truncate(unit.text, 2400),
          '',
          'Return only the JSON object. No preamble, no explanation, no hashtags.',
          ...(previousError ? ['', `Your previous attempt failed: ${previousError}`] : []),
        ].join('\n'),
      },
    ],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  const parsed = parseModelJson<Partial<BilingualCaption>>(text);
  if (!parsed.english?.trim() || !parsed.russian?.trim()) {
    throw new Error(`Caption eksik dil icin uretildi: ${unit.id}`);
  }

  return {
    english: stripStrayHashtags(parsed.english),
    russian: stripStrayHashtags(parsed.russian),
  };
}

/** Iki dil arasindaki ayrac; dilden bagimsiz ve gorsel olarak sakin. */
const SEPARATOR = '· · ·';

/** Iki dilli govdeyi tek metne cevirir. */
export function joinBilingual(caption: BilingualCaption): string {
  return `${caption.english}\n\n${SEPARATOR}\n\n${caption.russian}`;
}

/**
 * Caption gövdesi ile hashtag blogunu birlestirir ve Instagram limitine sigdirir.
 * Limit asilirsa once govde kisaltilir; hashtag'ler korunur cunku erisim onlara bagli.
 */
export function assembleCaption(body: string, link: string, hashtags: string): string {
  const footer = `\n\n${link}\n\n${hashtags}`;
  const room = CAPTION_LIMIT - footer.length;

  const trimmedBody = body.length <= room ? body : `${body.slice(0, Math.max(0, room - 1)).trimEnd()}…`;

  return `${trimmedBody}${footer}`;
}

/** Modele "hashtag yazma" dedik; yine de sizarsa temizle. */
function stripStrayHashtags(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}
