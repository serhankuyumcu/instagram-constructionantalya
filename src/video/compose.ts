import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { fetchBuffer } from '../lib/http.js';
import { renderOverlay } from './overlay.js';

/**
 * Reels videosu uretimi.
 *
 * Videolar yapay zeka ile degil ffmpeg ile uretiliyor: proje fotograflarina
 * yavas bir zoom (Ken Burns) verilip uc uca ekleniyor, uzerine markanin
 * tipografi katmani biniyor. Boylece gonderi maliyeti caption disinda
 * artmiyor ve gorsel dil statik gonderilerle ayni kaliyor.
 *
 * Ses bilerek yok: Instagram'in trend sesleri API uzerinden eklenemiyor,
 * sesin dosyaya gomulu olmasi gerekiyor. Telifsiz bir parca verilirse
 * `audioPath` ile gomulebilir.
 */

export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1920;

/** Kare basina sure. Dort fotograf ile toplam ~16 saniye eder. */
const SEGMENT_SECONDS = 4;
const FPS = 30;
/** Ken Burns'un bitis olcegi; fazlasi sarsinti gibi gorunuyor. */
const ZOOM_END = 1.12;

export interface ReelInput {
  readonly heading: string;
  readonly kicker: string;
  readonly imageUrls: readonly string[];
  /** Telifsiz muzik dosyasi yolu. Verilmezse video sessiz uretilir. */
  readonly audioPath?: string;
}

export async function composeReel(input: ReelInput): Promise<Buffer> {
  if (input.imageUrls.length === 0) throw new Error('Reels icin en az bir gorsel gerekli.');

  const workDir = await mkdtemp(join(tmpdir(), 'reel-'));

  try {
    const frames = await prepareFrames(input.imageUrls, workDir);

    // Tipografi katmanlari ayri PNG olarak uretiliyor: zoom yalnizca fotografa
    // uygulaniyor, metin sabit kaliyor. Metni de zoomlamak okunaksiz duruyor.
    const titleOverlay = join(workDir, 'title.png');
    const endOverlay = join(workDir, 'end.png');

    await writeFile(titleOverlay, await renderOverlay({ kind: 'title', heading: input.heading, kicker: input.kicker }));
    await writeFile(endOverlay, await renderOverlay({ kind: 'end' }));

    const output = join(workDir, 'reel.mp4');
    await runFfmpeg(buildFfmpegArgs(frames, titleOverlay, endOverlay, input.audioPath, output));

    return await readFile(output);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/** Fotograflari 9:16 orana kirpar ve zoom sirasinda bulaniklasmamasi icin buyuk tutar. */
async function prepareFrames(urls: readonly string[], workDir: string): Promise<string[]> {
  const paths: string[] = [];

  for (const [index, url] of urls.entries()) {
    const photo = await fetchBuffer(url);
    const path = join(workDir, `frame-${index}.jpg`);

    await sharp(photo)
      .resize(Math.round(REEL_WIDTH * ZOOM_END), Math.round(REEL_HEIGHT * ZOOM_END), {
        fit: 'cover',
        position: 'attention',
      })
      .modulate({ brightness: 0.86, saturation: 1.05 })
      .jpeg({ quality: 92 })
      .toBuffer()
      .then((buffer) => writeFile(path, buffer));

    paths.push(path);
  }

  return paths;
}

/**
 * Her fotograf icin zoompan uygulanip birlestiriliyor; ilk karede baslik,
 * son karede marka katmani ustune biniyor.
 */
function buildFfmpegArgs(
  frames: readonly string[],
  titleOverlay: string,
  endOverlay: string,
  audioPath: string | undefined,
  output: string,
): string[] {
  const args: string[] = ['-y'];

  // Dikkat: burada '-loop 1' KULLANILMAZ. zoompan'in 'd' degeri her GIRIS
  // karesi icin ayri bir dizi uretir; dongulu girisle birlesince segment
  // basina on binlerce kare olusuyor ve kodlama dakikalarca suruyor.
  // Tek bir kare besleyip d ile suresini vermek dogru kullanimdir.
  for (const frame of frames) {
    args.push('-i', frame);
  }
  args.push('-i', titleOverlay, '-i', endOverlay);

  if (audioPath) args.push('-i', audioPath);

  const titleIndex = frames.length;
  const endIndex = frames.length + 1;
  const totalFrames = SEGMENT_SECONDS * FPS;

  const filters: string[] = [];

  frames.forEach((_, index) => {
    // zoompan kare kare calisir; 'on' o anki kare numarasi.
    const zoom = `min(1+(${ZOOM_END - 1})*on/${totalFrames},${ZOOM_END})`;
    // Tek sayili kareler ters yonde zoomlanir; hep ayni yonde olursa monoton duruyor.
    const expression = index % 2 === 0 ? zoom : `${ZOOM_END + 1}-(${zoom})`;

    filters.push(
      // Kareler zaten ZOOM_END olceginde hazirlandi; burada tekrar buyutmek
      // kodlamayi dakikalarca uzatiyor ve gorunur bir kazanc saglamiyor.
      `[${index}:v]zoompan=z='${expression}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
        `d=${totalFrames}:s=${REEL_WIDTH}x${REEL_HEIGHT}:fps=${FPS},setsar=1[v${index}]`,
    );
  });

  const concatInputs = frames.map((_, index) => `[v${index}]`).join('');
  filters.push(`${concatInputs}concat=n=${frames.length}:v=1:a=0[base]`);

  // Baslik ilk kareyle birlikte girip biraz once cikiyor; kapanis son karede.
  const total = frames.length * SEGMENT_SECONDS;
  filters.push(`[base][${titleIndex}:v]overlay=0:0:enable='between(t,0,${SEGMENT_SECONDS + 0.5})'[withTitle]`);
  filters.push(
    // format=yuv420p sart: kaynak JPEG'ler tam aralikli (yuvj420p) geliyor ve
    // Instagram bu formati kabul etmiyor. Cikis kodlayicisina birakmak yerine
    // filtre zincirinde donusturuyoruz.
    `[withTitle][${endIndex}:v]overlay=0:0:enable='between(t,${total - SEGMENT_SECONDS},${total})',format=yuv420p,setrange=tv[out]`,
  );

  args.push('-filter_complex', filters.join(';'), '-map', '[out]');

  if (audioPath) {
    args.push('-map', `${frames.length + 2}:a`, '-c:a', 'aac', '-b:a', '128k', '-shortest');
  }

  args.push(
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    // Instagram yuv420p disindaki formatlari reddediyor.
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-r', String(FPS),
    output,
  );

  return args;
}

function runFfmpeg(args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      // ffmpeg ilerlemeyi de stderr'e yaziyor; hata halinde sonu yeterli.
      stderr = (stderr + chunk.toString()).slice(-4000);
    });

    child.on('error', (error) => reject(new Error(`ffmpeg calistirilamadi: ${error.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg hata verdi (kod ${code}):\n${stderr}`));
    });
  });
}
