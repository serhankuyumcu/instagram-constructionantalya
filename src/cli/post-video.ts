import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { ACCENT, BRAND, SITE, loadFonts, satoriFonts } from '../lib/fonts.js';
import { buildHashtags } from '../caption/hashtags.js';
import { formatConfigError, loadConfig } from '../config.js';
import { hostImage } from '../image/host.js';
import { InstagramClient } from '../instagram/client.js';
import { loadEnvFile } from '../lib/env-file.js';
import { STATE_PATH } from '../pipeline/run.js';
import { loadState, saveState, withPost } from '../state/store.js';
import type { Topic } from '../content/topics.js';

/**
 * Elle hazirlanmis bir videoyu markalayip Reels olarak yayinlar.
 *
 * Otomatik akistan ayri: video disaridan geliyor, icerik havuzundan bir
 * bolum harcamiyor. Marka katmani ustte duruyor cunku elle hazirlanan
 * videolarda ekran yazilari genelde alt yariya konuyor; ustu kullanmak
 * carpismayi tamamen onluyor.
 *
 * Kullanim:
 *   npm run post:video -- <dosya.mp4> --caption "..." [--topics interior,finishing] [--dry-run]
 */

const WIDTH = 1080;
const HEIGHT = 1920;
/** Kapanista site adresinin ekranda kalacagi sure. */
const OUTRO_SECONDS = 3;

const el = (type: string, props: Record<string, unknown>): unknown => ({ type, props });

async function renderOverlay(withSite: boolean): Promise<Buffer> {
  const fonts = await loadFonts();

  const children: unknown[] = [
    el('div', {
      style: { display: 'flex', alignItems: 'center' },
      children: [
        el('div', { style: { width: '48px', height: '2px', backgroundColor: ACCENT, marginRight: '20px' } }),
        el('div', {
          style: {
            fontSize: '26px',
            letterSpacing: '6px',
            color: '#ffffff',
            // Acik zeminlerde de okunsun diye hafif golge.
            textShadow: '0 2px 12px rgba(0,0,0,0.55)',
          },
          children: BRAND,
        }),
      ],
    }),
  ];

  if (withSite) {
    children.push(
      el('div', {
        style: {
          fontSize: '24px',
          letterSpacing: '2px',
          color: 'rgba(255,255,255,0.92)',
          marginTop: '16px',
          marginLeft: '68px',
          textShadow: '0 2px 12px rgba(0,0,0,0.55)',
        },
        children: SITE,
      }),
    );
  }

  const svg = await satori(
    el('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: `${WIDTH}px`,
        height: `${HEIGHT}px`,
        padding: '110px 80px 0 80px',
        fontFamily: 'Body',
      },
      children,
    }) as never,
    { width: WIDTH, height: HEIGHT, fonts: satoriFonts(fonts) },
  );

  return new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH }, background: 'rgba(0,0,0,0)' })
    .render()
    .asPng();
}

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-3000);
    });
    child.on('error', (error) => reject(new Error(`${command} calistirilamadi: ${error.message}`)));
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} hata verdi (${code}):\n${stderr}`)),
    );
  });
}

async function probeDuration(path: string): Promise<number> {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path],
      (error, stdout) => (error ? reject(error) : resolve(Number.parseFloat(stdout.trim()))),
    );
  });
}

async function brand(source: string, workDir: string): Promise<string> {
  const duration = await probeDuration(source);

  const markPath = join(workDir, 'mark.png');
  const sitePath = join(workDir, 'site.png');
  await writeFile(markPath, await renderOverlay(false));
  await writeFile(sitePath, await renderOverlay(true));

  const output = join(workDir, 'branded.mp4');
  const outroStart = Math.max(0, duration - OUTRO_SECONDS);

  await run('ffmpeg', [
    '-y',
    '-i', source,
    '-i', markPath,
    '-i', sitePath,
    '-filter_complex',
    // Marka imzasi bastan sona; site adresi yalnizca kapanista.
    `[0:v][1:v]overlay=0:0:enable='between(t,0,${outroStart})'[a];` +
      `[a][2:v]overlay=0:0:enable='gte(t,${outroStart})',format=yuv420p,setrange=tv[out]`,
    '-map', '[out]',
    // Ses oldugu gibi korunur; yeniden kodlamak gereksiz kalite kaybi olurdu.
    '-map', '0:a?',
    '-c:a', 'copy',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '22',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    output,
  ]);

  return output;
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  loadEnvFile();

  const source = process.argv[2];
  if (!source || source.startsWith('--')) {
    console.error('\nKullanim: npm run post:video -- <dosya.mp4> --caption "..." [--topics a,b] [--dry-run]\n');
    process.exitCode = 1;
    return;
  }

  const dryRun = process.argv.includes('--dry-run');
  const config = loadConfig(process.env, dryRun);

  const captionBody = argValue('--caption');
  if (!captionBody) throw new Error('--caption gerekli.');

  const topics = (argValue('--topics') ?? 'interior,finishing').split(',').map((t) => t.trim()) as Topic[];
  const link = argValue('--link') ?? config.siteBaseUrl;

  const state = await loadState(STATE_PATH);
  const hashtags = buildHashtags(topics, state.posts.length);
  const caption = `${captionBody}\n\n${link}\n\n${hashtags.text}`;

  console.log(dryRun ? '\nDENEME MODU\n' : '\nELLE HAZIRLANMIS VIDEO YAYINI\n');

  const workDir = await mkdtemp(join(tmpdir(), 'brand-'));
  try {
    const branded = await brand(source, workDir);
    const video = await readFile(branded);
    console.log(`  Markalandi: ${(video.length / 1048576).toFixed(1)} MB`);
    console.log(`  Caption   : ${caption.length} karakter, ${hashtags.tags.length} hashtag`);

    if (dryRun) {
      await writeFile('out/branded.mp4', video);
      await writeFile('out/branded.txt', caption, 'utf8');
      console.log('\n  Cikti: out/branded.mp4 ve out/branded.txt\n');
      return;
    }

    const fileName = `${new Date().toISOString().slice(0, 10)}-manual-${Date.now()}.mp4`;
    const hosted = await hostImage(config.imageHost, fileName, video);
    console.log(`  Medya yayinlandi: ${hosted.url}`);

    const instagram = new InstagramClient(config.instagram.igUserId, config.instagram.igAccessToken);
    const published = await instagram.publishReel({ videoUrl: hosted.url, caption });
    console.log(`  Instagram: ${published.permalink ?? published.mediaId}`);

    // Elle gonderiler icerik havuzundan bolum harcamaz; kayitta "manual:"
    // onekiyle ayirt edilir ki otomatik secim bunlari bolum saymasin.
    await saveState(
      STATE_PATH,
      withPost(state, {
        unitId: `manual:${fileName.replace(/\.mp4$/, '')}`,
        articleSlug: 'manual',
        heading: captionBody.split('\n')[0]?.slice(0, 80) ?? 'Elle hazirlanmis video',
        imageUrl: '',
        mediaId: published.mediaId,
        permalink: published.permalink,
        publishedAt: new Date().toISOString(),
        topics,
        hashtags: [...hashtags.tags],
        format: 'reel',
        mediaUsed: [],
        insights: null,
      }),
    );
    console.log('\n  Yayin gecmisine islendi.\n');
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(`\nHATA: ${formatConfigError(error)}\n`);
  process.exitCode = 1;
});
