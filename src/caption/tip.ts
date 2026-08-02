import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { PostUnit } from '../blog/types.js';

/**
 * "Tip reel" icerigi: tek bir somut teknik gercek, kanca ile acilan kisa video.
 *
 * Kanca, govde ve caption tek cagrida uretiliyor: ucu birbirine bagli oldugu
 * icin ayri cagrilarda uretmek hem tutarsizlik hem iki kat maliyet demek.
 *
 * Icerik daima kaynak bolumden cikarilir. Insaat teknik iddialarinda
 * uydurma kabul edilemez; model yalnizca metinde geceni kullanabilir.
 */

const schema = z.object({
  /** Ilk karede ekrani kaplayan metin. Kisa olmali, yoksa okunmaz. */
  hook: z.string().min(15).max(58),
  /** Kancayi acan iki kisa satir; her biri bir kareye denk gelir. */
  lines: z.array(z.string().min(20).max(78)).length(2),
  /** Gonderi metni; soruyla acilir, yorum davet eder. */
  caption: z.string().min(180).max(900),
});

export type TipContent = z.infer<typeof schema>;

const MODEL = 'claude-sonnet-5';

const SYSTEM = `You turn construction expertise into short-form video scripts for Construction Antalya, a turnkey luxury builder on the Turkish Riviera specialising in shell and structural work (kaba inşaat).

The format is a 10 second vertical reel. It opens with one blunt line on screen that makes a property owner stop scrolling, then delivers one concrete technical truth.

Hard rules:
- Everything you write must come from the source text. Never introduce a technical claim, number, material or standard that is not in it.
- No prices, no durations, no percentages.
- The hook states a consequence or a mistake, not a topic. It must feel like a warning from someone who has seen it go wrong.
- No emoji, no exclamation marks, no em dashes, no hashtags.
- Plain international English. Short words. A builder speaking, not a marketer.
- The caption opens with a genuine question that invites a reply, then gives the substance, then a calm invitation to talk.

Good hook: "Your walls are only as straight as the day they were poured"
Bad hook: "The importance of quality shell construction"`;

export async function generateTip(client: Anthropic, unit: PostUnit): Promise<TipContent> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: `${SYSTEM}\n\nRespond with a single valid JSON object and nothing else.`,
    messages: [
      {
        role: 'user',
        content: [
          `Source article: "${unit.articleTitle}"`,
          `Section: "${unit.heading}"`,
          '',
          'Source text:',
          unit.text.slice(0, 2400),
          '',
          'Return JSON with exactly these keys:',
          '  hook    — max 58 characters, the on-screen opening line',
          '  lines   — exactly 2 strings, max 78 characters each, the payoff shown after the hook',
          '  caption — the post text, 180 to 900 characters, opens with a question',
        ].join('\n'),
      },
    ],
  });

  const raw = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Tip uretiminde JSON bulunamadi.');

  return schema.parse(JSON.parse(raw.slice(start, end + 1)));
}
