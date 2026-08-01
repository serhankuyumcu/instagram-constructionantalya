const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 600;

/**
 * Ayni anda kac istek acilabilecegi.
 *
 * Once butun yazilar tek seferde paralel cekiliyordu; site buyudukce bu
 * onlarca es zamanli istek demek oldu ve bir gece hepsi birden zaman
 * asimina ugrayip gonderiyi dusurdu. Kucuk parcalar halinde ilerlemek
 * hem sunucuyu yormuyor hem de tek bir yavas istegin tumunu bogmasini
 * engelliyor.
 */
const CONCURRENCY = 4;

/** Istekleri sinirli es zamanlilikla calistirir, sonuclari giris sirasinda dondurur. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  worker: (item: T) => Promise<R>,
  limit = CONCURRENCY,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!);
    }
  });

  await Promise.all(runners);
  return results;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 5xx ve ag hatalari gecicidir; 4xx kalicidir ve tekrar denemeye degmez. */
function isRetryable(error: unknown): boolean {
  if (error instanceof HttpError) return error.status >= 500 || error.status === 429;
  return true;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new HttpError(`${init.method ?? 'GET'} ${url} -> HTTP ${response.status}`, response.status, body);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_RETRIES) break;
      await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}

export async function fetchText(url: string): Promise<string> {
  const response = await fetchWithRetry(url, {
    headers: { 'user-agent': 'constructionantalya-instagram-bot/1.0' },
  });
  return response.text();
}

export async function fetchBuffer(url: string): Promise<Buffer> {
  const response = await fetchWithRetry(url, {
    headers: { 'user-agent': 'constructionantalya-instagram-bot/1.0' },
  });
  return Buffer.from(await response.arrayBuffer());
}
