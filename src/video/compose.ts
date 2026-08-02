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
/**
 * Tip videolarinda kare suresi daha kisa: kanca formatinda izleyici ilk
 * saniyede karar veriyor, uzun video tamamlanma oranini dusuruyor.
 */
const TIP_SEGMENT_SECONDS = 2.8;
const FPS = 30;
/** Ken Burns'un bitis olcegi; fazlasi sarsinti gibi gorunuyor. */
const ZOOM_END = 1.12;

/** Belirli bir zaman araliginda gorunen tipografi katmani. */
export interface TimedOverlay {
  readonly png: Buffer;
  readonly from: number;
  readonly to: number;
}

export interface TipReelInput {
  readonly hook: string;
  readonly lines: readonly string[];
  readonly imageUrls: readonly string[];
  readonly audioPath?: string;
}

export interface ReelInput {
  readonly heading: string;
  readonly kicker: string;
  readonly imageUrls: readonly string[];
  /** Telifsiz muzik dosyasi yolu. Verilmezse video sessiz uretilir. */
  readonly audioPath?: string;
}

export async function composeReel(input: ReelInput): Promise<Buffer> {
  const total = input.imageUrls.length * SEGMENT_SECONDS;

  return build(input.imageUrls, SEGMENT_SECONDS, input.audioPath, async () => [
    {
      png: await renderOverlay({ kind: 'title', heading: input.heading, kicker: input.kicker }),
      from: 0,
      to: SEGMENT_SECONDS + 0.5,
    },
    { png: await renderOverlay({ kind: 'end' }), from: total - SEGMENT_SECONDS, to: total },
  ]);
}

/**
 * Kanca ile acilan kisa tip videosu.
 *
 * Ilk kare tek bir cumleyi ekrana basar, sonraki kareler acilimi verir,
 * son kare markayi. Standart reel'den kisadir: kanca formatinda izleyici
 * ilk saniyede karar veriyor, uzun video tamamlanma oranini dusuruyor.
 */
export async function composeTipReel(input: TipReelInput): Promise<Buffer> {
  const segment = TIP_SEGMENT_SECONDS;
  const count = input.lines.length + 2; // kanca + satirlar + kapanis
  const images = Array.from({ length: count }, (_, i) => input.imageUrls[i % input.imageUrls.length]!);

  return build(images, segment, input.audioPath, async () => {
    const overlays: TimedOverlay[] = [
      { png: await renderOverlay({ kind: 'hook', text: input.hook }), from: 0, to: segment + 0.4 },
    ];

    for (const [index, line] of input.lines.entries()) {
      const from = segment * (index + 1);
      overlays.push({
        png: await renderOverlay({ kind: 'line', text: line }),
        from,
        to: from + segment + 0.4,
      });
    }

    const total = segment * count;
    overlays.push({ png: await renderOverlay({ kind: 'end' }), from: total - segment, to: total });
    return overlays;
  });
}

/** Ortak cekirdek: kareleri hazirla, katmanlari uret, ffmpeg'i calistir. */
async function build(
  imageUrls: readonly string[],
  segmentSeconds: number,
  audioPath: string | undefined,
  makeOverlays: () => Promise<TimedOverlay[]>,
): Promise<Buffer> {
  if (imageUrls.length === 0) throw new Error('Reels icin en az bir gorsel gerekli.');

  const workDir = await mkdtemp(join(tmpdir(), 'reel-'));

  try {
    const frames = await prepareFrames(imageUrls, workDir);
    const overlays = await makeOverlays();

    const paths: { path: string; from: number; to: number }[] = [];
    for (const [index, overlay] of overlays.entries()) {
      const path = join(workDir, `ov-${index}.png`);
      await writeFile(path, overlay.png);
      paths.push({ path, from: overlay.from, to: overlay.to });
    }

    const output = join(workDir, 'reel.mp4');
    await runFfmpeg(buildFfmpegArgs(frames, paths, segmentSeconds, audioPath, output));

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
  overlays: readonly { path: string; from: number; to: number }[],
  segmentSeconds: number,
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
  for (const overlay of overlays) {
    args.push('-i', overlay.path);
  }
  if (audioPath) args.push('-i', audioPath);

  const totalFrames = Math.round(segmentSeconds * FPS);
  const filters: string[] = [];

  frames.forEach((_, index) => {
    const zoom = `min(1+(${ZOOM_END - 1})*on/${totalFrames},${ZOOM_END})`;
    // Tek sayili kareler ters yonde zoomlanir; hep ayni yonde olursa monoton duruyor.
    const expression = index % 2 === 0 ? zoom : `${ZOOM_END + 1}-(${zoom})`;

    filters.push(
      `[${index}:v]zoompan=z='${expression}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
        `d=${totalFrames}:s=${REEL_WIDTH}x${REEL_HEIGHT}:fps=${FPS},setsar=1[v${index}]`,
    );
  });

  const concatInputs = frames.map((_, index) => `[v${index}]`).join('');
  filters.push(`${concatInputs}concat=n=${frames.length}:v=1:a=0[stage0]`);

  overlays.forEach((overlay, index) => {
    const input = `[stage${index}]`;
    const isLast = index === overlays.length - 1;
    // format=yuv420p sart: kaynak JPEG'ler tam aralikli (yuvj420p) geliyor ve
    // Instagram bu formati kabul etmiyor.
    const tail = isLast ? ',format=yuv420p,setrange=tv[out]' : `[stage${index + 1}]`;

    filters.push(
      `${input}[${frames.length + index}:v]overlay=0:0:` +
        `enable='between(t,${overlay.from},${overlay.to})'${tail}`,
    );
  });

  args.push('-filter_complex', filters.join(';'), '-map', '[out]');

  if (audioPath) {
    args.push('-map', `${frames.length + overlays.length}:a`, '-c:a', 'aac', '-b:a', '128k', '-shortest');
  }

  args.push(
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
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
