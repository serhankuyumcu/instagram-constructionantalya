import { z } from 'zod';

/**
 * Tum ortam degiskenleri tek yerde dogrulanir. Eksik bir secret yuzunden
 * botun yayin adiminda yarim kalmasindansa, calismanin ilk saniyesinde
 * net bir hata ile durmasi tercih edilir.
 */

const LOCALES = ['tr', 'en', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];

const baseSchema = z.object({
  siteBaseUrl: z.string().url().default('https://constructionantalya.com'),
  captionLocale: z.enum(LOCALES).default('en'),
  anthropicApiKey: z.string().min(1, 'ANTHROPIC_API_KEY gerekli (caption uretimi icin)'),
});

const instagramSchema = z.object({
  igUserId: z.string().regex(/^\d+$/, 'IG_USER_ID sayisal olmali'),
  igAccessToken: z.string().min(20, 'IG_ACCESS_TOKEN gecersiz gorunuyor'),
});

const githubHostSchema = z.object({
  kind: z.literal('github'),
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'GITHUB_REPOSITORY "sahip/repo" formatinda olmali'),
  token: z.string().min(1, 'GITHUB_TOKEN gerekli'),
  branch: z.string().default('media'),
});

const cloudinaryHostSchema = z.object({
  kind: z.literal('cloudinary'),
  cloudName: z.string().min(1, 'CLOUDINARY_CLOUD_NAME gerekli'),
  apiKey: z.string().min(1, 'CLOUDINARY_API_KEY gerekli'),
  apiSecret: z.string().min(1, 'CLOUDINARY_API_SECRET gerekli'),
});

const imageHostSchema = z.discriminatedUnion('kind', [githubHostSchema, cloudinaryHostSchema]);

export type ImageHostConfig = z.infer<typeof imageHostSchema>;

export interface Config {
  readonly siteBaseUrl: string;
  readonly captionLocale: Locale;
  readonly anthropicApiKey: string;
  readonly instagram: z.infer<typeof instagramSchema>;
  readonly imageHost: ImageHostConfig;
  readonly dryRun: boolean;
}

function readImageHost(env: NodeJS.ProcessEnv): unknown {
  if (env.IMAGE_HOST === 'cloudinary') {
    return {
      kind: 'cloudinary',
      cloudName: env.CLOUDINARY_CLOUD_NAME,
      apiKey: env.CLOUDINARY_API_KEY,
      apiSecret: env.CLOUDINARY_API_SECRET,
    };
  }
  return {
    kind: 'github',
    repository: env.GITHUB_REPOSITORY,
    token: env.GITHUB_TOKEN,
    branch: env.MEDIA_BRANCH || 'media',
  };
}

/**
 * Dry-run modunda Instagram ve gorsel barindirma kimlik bilgileri istenmez;
 * boylece bot hicbir secret olmadan yerelde test edilebilir.
 */
export function loadConfig(env: NodeJS.ProcessEnv, dryRun: boolean): Config {
  const base = baseSchema.parse({
    siteBaseUrl: env.SITE_BASE_URL,
    captionLocale: env.CAPTION_LOCALE,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
  });

  if (dryRun) {
    return {
      ...base,
      instagram: { igUserId: '0', igAccessToken: 'dry-run-placeholder-token' },
      imageHost: { kind: 'github', repository: 'dry/run', token: 'dry-run', branch: 'media' },
      dryRun: true,
    };
  }

  return {
    ...base,
    instagram: instagramSchema.parse({
      igUserId: env.IG_USER_ID,
      igAccessToken: env.IG_ACCESS_TOKEN,
    }),
    imageHost: imageHostSchema.parse(readImageHost(env)),
    dryRun: false,
  };
}

/**
 * Hatalari terminalde okunabilir tek bir metne cevirir.
 *
 * Yalnizca yapilandirma semasindan gelen hatalarda .env yonlendirmesi
 * yapilir. Icerik semasi hatalarinda ".env doldur" demek yanlis yere
 * bakmaya yol aciyordu.
 */
export function formatConfigError(error: unknown): string {
  if (!(error instanceof z.ZodError)) return String(error);

  const lines = error.errors.map((e) => `  - ${e.path.join('.') || '(kok)'}: ${e.message}`);
  const fields = new Set(error.errors.map((e) => String(e.path[0] ?? '')));
  const isConfig = [...fields].some((f) =>
    ['siteBaseUrl', 'captionLocale', 'anthropicApiKey', 'igUserId', 'igAccessToken', 'kind', 'repository', 'token'].includes(f),
  );

  return isConfig
    ? `Yapilandirma hatasi:\n${lines.join('\n')}\n\n.env.example dosyasini kopyalayip .env olarak doldur.`
    : `Dogrulama hatasi:\n${lines.join('\n')}`;
}
