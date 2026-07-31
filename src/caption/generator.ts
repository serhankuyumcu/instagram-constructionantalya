import Anthropic from '@anthropic-ai/sdk';
import type { PostUnit } from '../blog/types.js';
import type { Locale } from '../config.js';

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
- No hashtags anywhere in your output — those are appended separately by the system.
- No "link in bio" phrasing; close with a calm, concrete invitation instead.
- Short paragraphs separated by a blank line. Between 90 and 160 words total.
- Do not use em dashes.`;

export interface CaptionInput {
  readonly unit: PostUnit;
  readonly locale: Locale;
}

export async function generateCaption(client: Anthropic, input: CaptionInput): Promise<string> {
  const { unit, locale } = input;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          `Write the caption in ${LANGUAGE_NAMES[locale]}.`,
          '',
          `Source article: "${unit.articleTitle}"`,
          `Section: "${unit.heading}"`,
          '',
          'Section text:',
          truncate(unit.text, 2400),
          '',
          'Write only the caption body. No preamble, no explanation, no hashtags.',
        ].join('\n'),
      },
    ],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  if (text.length === 0) {
    throw new Error(`Caption uretilemedi (bos yanit): ${unit.id}`);
  }

  return stripStrayHashtags(text);
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
