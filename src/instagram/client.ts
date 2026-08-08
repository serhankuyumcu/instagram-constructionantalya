import { HttpError, fetchWithRetry } from '../lib/http.js';

/**
 * Instagram Content Publishing API istemcisi.
 *
 * Yayin iki adimlidir: once bir "media container" olusturulur, Instagram
 * gorseli verilen PUBLIC URL'den kendisi ceker, hazir oldugunda container
 * yayinlanir. Dogrudan dosya yuklemesi desteklenmez; gorselin internetten
 * erisilebilir olmasi bu yuzden zorunludur.
 */

const GRAPH_VERSION = process.env.GRAPH_API_VERSION ?? 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Container'in hazir olmasi genelde birkac saniye surer. */
const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_ATTEMPTS = 20;

/**
 * Video isleme fotograftan cok daha uzun surer; Instagram dosyayi indirip
 * yeniden kodluyor. Bu yuzden Reels icin bekleme suresi ayri tutuluyor.
 */
const VIDEO_POLL_MAX_ATTEMPTS = 100;

export interface PublishInput {
  readonly imageUrl: string;
  readonly caption: string;
}

export interface PublishReelInput {
  readonly videoUrl: string;
  readonly caption: string;
  /** Kapak karesi olarak kullanilacak saniye. */
  readonly coverSecond?: number;
}

export interface CarouselInput {
  /** Carousel sirasi bu dizinin sirasidir; Instagram 2-10 gorsel kabul eder. */
  readonly imageUrls: readonly string[];
  readonly caption: string;
}

export interface PublishResult {
  readonly mediaId: string;
  readonly permalink: string | null;
}

export class InstagramClient {
  constructor(
    private readonly userId: string,
    private readonly accessToken: string,
  ) {}

  async publishImage(input: PublishInput): Promise<PublishResult> {
    const creationId = await this.createContainer(input);
    await this.waitUntilReady(creationId);
    const mediaId = await this.publishContainer(creationId);

    return { mediaId, permalink: await this.fetchPermalink(mediaId) };
  }

  /**
   * Reels yayinlar.
   *
   * Akis fotografla ayni ama iki fark var: media_type=REELS gerekiyor ve
   * Instagram videoyu indirip yeniden kodladigi icin bekleme cok daha uzun.
   */
  async publishReel(input: PublishReelInput): Promise<PublishResult> {
    const body = new URLSearchParams({
      media_type: 'REELS',
      video_url: input.videoUrl,
      caption: input.caption,
      // Kapak karesi: ilk saniyede baslik katmani ekranda oluyor.
      thumb_offset: String((input.coverSecond ?? 1) * 1000),
      access_token: this.accessToken,
    });

    const data = await this.post<{ id?: string }>(`${GRAPH_BASE}/${this.userId}/media`, body);
    if (!data.id) throw new Error('Reels container olusturulamadi (id donmedi).');

    await this.waitUntilReady(data.id, VIDEO_POLL_MAX_ATTEMPTS);
    const mediaId = await this.publishContainer(data.id);

    return { mediaId, permalink: await this.fetchPermalink(mediaId) };
  }

  /**
   * Carousel (kaydirmali cok gorselli gonderi) yayinlar.
   *
   * Uc adim: once her gorsel icin `is_carousel_item` isaretli birer
   * container, sonra bunlari `children` olarak toplayan bir CAROUSEL
   * container, en sonunda yayin. Caption yalnizca ust container'a
   * yaziliyor; alt gorsellere caption verilirse Instagram sessizce
   * yok sayiyor.
   */
  async publishCarousel(input: CarouselInput): Promise<PublishResult> {
    if (input.imageUrls.length < 2 || input.imageUrls.length > 10) {
      throw new Error(`Carousel 2-10 gorsel ister, ${input.imageUrls.length} verildi.`);
    }

    // Alt container'lar sirayla olusturuluyor: Instagram ayni anda gelen
    // isteklerde zaman zaman ayni id'yi donduruyor ve carousel bozuluyor.
    const children: string[] = [];
    for (const imageUrl of input.imageUrls) {
      const body = new URLSearchParams({
        image_url: imageUrl,
        is_carousel_item: 'true',
        access_token: this.accessToken,
      });

      const data = await this.post<{ id?: string }>(`${GRAPH_BASE}/${this.userId}/media`, body);
      if (!data.id) throw new Error('Carousel alt gorseli icin container olusturulamadi.');
      children.push(data.id);
    }

    for (const child of children) await this.waitUntilReady(child);

    const body = new URLSearchParams({
      media_type: 'CAROUSEL',
      children: children.join(','),
      caption: input.caption,
      access_token: this.accessToken,
    });

    const data = await this.post<{ id?: string }>(`${GRAPH_BASE}/${this.userId}/media`, body);
    if (!data.id) throw new Error('Carousel container olusturulamadi (id donmedi).');

    await this.waitUntilReady(data.id);
    const mediaId = await this.publishContainer(data.id);

    return { mediaId, permalink: await this.fetchPermalink(mediaId) };
  }

  private async createContainer(input: PublishInput): Promise<string> {
    const body = new URLSearchParams({
      image_url: input.imageUrl,
      caption: input.caption,
      access_token: this.accessToken,
    });

    const data = await this.post<{ id?: string }>(`${GRAPH_BASE}/${this.userId}/media`, body);

    if (!data.id) throw new Error('Instagram media container olusturulamadi (id donmedi).');
    return data.id;
  }

  /**
   * Container hazir degilken yayinlamak "Media ID is not available" hatasi verir.
   * Bu yuzden FINISHED durumunu beklemek zorunludur.
   */
  private async waitUntilReady(creationId: string, maxAttempts = POLL_MAX_ATTEMPTS): Promise<void> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const url = new URL(`${GRAPH_BASE}/${creationId}`);
      url.searchParams.set('fields', 'status_code,status');
      url.searchParams.set('access_token', this.accessToken);

      const response = await fetchWithRetry(url.toString());
      const data = (await response.json()) as { status_code?: string; status?: string };

      switch (data.status_code) {
        case 'FINISHED':
          return;
        case 'ERROR':
          throw new Error(`Instagram gorseli isleyemedi: ${data.status ?? 'bilinmeyen hata'}`);
        case 'EXPIRED':
          throw new Error('Media container yayinlanmadan once suresi doldu.');
        default:
          await sleep(POLL_INTERVAL_MS);
      }
    }

    throw new Error(`Media container ${maxAttempts} denemede hazir olmadi.`);
  }

  private async publishContainer(creationId: string): Promise<string> {
    const body = new URLSearchParams({
      creation_id: creationId,
      access_token: this.accessToken,
    });

    const data = await this.post<{ id?: string }>(`${GRAPH_BASE}/${this.userId}/media_publish`, body);

    if (!data.id) throw new Error('Yayin basarisiz (media id donmedi).');
    return data.id;
  }

  /** Permalink zorunlu degil; alinamazsa yayin yine de basarilidir. */
  private async fetchPermalink(mediaId: string): Promise<string | null> {
    try {
      const url = new URL(`${GRAPH_BASE}/${mediaId}`);
      url.searchParams.set('fields', 'permalink');
      url.searchParams.set('access_token', this.accessToken);

      const response = await fetchWithRetry(url.toString());
      const data = (await response.json()) as { permalink?: string };
      return data.permalink ?? null;
    } catch {
      return null;
    }
  }

  /** Gunluk yayin kotasi 50'dir; bot gunde bir gonderdigi icin bu bir guvenlik kontroludur. */
  async remainingQuota(): Promise<number | null> {
    try {
      const url = new URL(`${GRAPH_BASE}/${this.userId}/content_publishing_limit`);
      url.searchParams.set('fields', 'quota_usage,config');
      url.searchParams.set('access_token', this.accessToken);

      const response = await fetchWithRetry(url.toString());
      const payload = (await response.json()) as {
        data?: { quota_usage?: number; config?: { quota_total?: number } }[];
      };

      const entry = payload.data?.[0];
      if (!entry) return null;

      const total = entry.config?.quota_total ?? 50;
      return total - (entry.quota_usage ?? 0);
    } catch {
      return null;
    }
  }

  private async post<T>(url: string, body: URLSearchParams): Promise<T> {
    try {
      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
      return (await response.json()) as T;
    } catch (error) {
      throw enrichGraphError(error);
    }
  }
}

/**
 * Graph API hatalari JSON govdesinde anlamli bir mesaj tasir; ham HTTP kodu
 * tek basina teshis icin yetersizdir.
 */
function enrichGraphError(error: unknown): Error {
  if (!(error instanceof HttpError)) return error instanceof Error ? error : new Error(String(error));

  try {
    const parsed = JSON.parse(error.body) as {
      error?: { message?: string; type?: string; code?: number; error_user_msg?: string };
    };
    const detail = parsed.error;
    if (detail) {
      const parts = [detail.error_user_msg ?? detail.message, detail.type, detail.code ? `code ${detail.code}` : null]
        .filter(Boolean)
        .join(' | ');
      return new Error(`Instagram API hatasi: ${parts}`);
    }
  } catch {
    // JSON degilse ham metne duseriz.
  }

  return new Error(`Instagram API hatasi (HTTP ${error.status}): ${error.body.slice(0, 400)}`);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
