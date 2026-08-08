import Anthropic from '@anthropic-ai/sdk';
import { parseModelJson } from '../lib/json.js';
import type { PlannedPost } from '../plan/calendar.js';
import type { BilingualCaption } from './generator.js';
import { VOICE_PROMPT } from './generator.js';

/**
 * Takvimden gelen carousel gonderisinin caption'i.
 *
 * Blog gonderilerinden farki, kaynagin bir yazi degil bir brifing olmasi:
 * gunun konusu ve caption'in vermesi gereken teknik nokta KONU.md'de elle
 * yaziliyor. Model bunu genisletiyor, uydurmuyor.
 */

const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 2000;
const MAX_ATTEMPTS = 3;

const CAROUSEL_PROMPT = `${VOICE_PROMPT}

This caption accompanies a carousel of photographs from one of the company's own projects. The reader swipes through the images while reading, so the caption should reward the swipe: refer to what the sequence shows, not to a single frame.`;

export async function generateCarouselCaption(
  client: Anthropic,
  post: PlannedPost,
): Promise<BilingualCaption> {
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await attemptCaption(client, post, attempt === 1 ? '' : lastError);
    } catch (error) {
      lastError = error instanceof Error ? error.message.slice(0, 300) : String(error);
    }
  }

  throw new Error(`Carousel caption uretilemedi (${MAX_ATTEMPTS} deneme): ${lastError}`);
}

async function attemptCaption(
  client: Anthropic,
  post: PlannedPost,
  previousError: string,
): Promise<BilingualCaption> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: CAROUSEL_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          'Write the caption in English and in Russian.',
          '',
          `Project: ${post.project}`,
          `Topic of this post: ${post.title}`,
          `Number of images in the carousel: ${post.images.length}`,
          '',
          'What the images show:',
          post.brief,
          '',
          'The single technical point this caption must land:',
          post.point,
          ...(post.isDesign
            ? [
                '',
                'IMPORTANT: these are design visualisations by the company\'s own interior architects, not photographs of completed work. Write about the design thinking. Never imply the space has been built.',
              ]
            : []),
          '',
          'Return only the JSON object. No preamble, no explanation, no hashtags.',
          ...(previousError ? ['', `Your previous attempt failed: ${previousError}`] : []),
        ].join('\n'),
      },
    ],
  });

  if (response.stop_reason === 'max_tokens') {
    throw new Error('Yanit token sinirinda kesildi; MAX_TOKENS artirilmali.');
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  const parsed = parseModelJson<Partial<BilingualCaption>>(text);
  if (!parsed.english?.trim() || !parsed.russian?.trim()) {
    throw new Error(`Caption eksik dil icin uretildi: ${post.date}`);
  }

  return { english: parsed.english.trim(), russian: parsed.russian.trim() };
}
