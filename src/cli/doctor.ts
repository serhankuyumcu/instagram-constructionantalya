import { loadEnvFile } from '../lib/env-file.js';

/**
 * Instagram kurulum dogrulayicisi.
 *
 * Token'i .env'den okur ve Meta'ya sorarak neyin eksik oldugunu soyler:
 * izinler, bagli sayfa, Instagram hesap ID'si, token omru ve gunluk kota.
 *
 * Token hicbir zaman ekrana yazilmaz.
 */

const VERSION = process.env.GRAPH_API_VERSION ?? 'v21.0';
const BASE = `https://graph.facebook.com/${VERSION}`;

/**
 * Yayin akisinin calismasi icin zorunlu izinler.
 *
 * Her satirdaki adlardan en az biri verilmis olmali. Icerik yayinlama izni
 * iki farkli adla karsimiza cikiyor: Meta'nin use-case ekrani
 * "instagram_content_publishing" yaziyor, API dokumantasyonu ve token
 * yanitlari ise "instagram_content_publish" kullaniyor.
 */
const REQUIRED_SCOPES: readonly (readonly string[])[] = [
  ['instagram_basic'],
  ['instagram_content_publish', 'instagram_content_publishing'],
  ['pages_show_list'],
  ['pages_read_engagement'],
];

/** Zorunlu degil ama Meta'nin use-case ekraninda onerilen izinler. */
const OPTIONAL_SCOPES = ['business_management'];

const OK = '  ✓';
const FAIL = '  ✗';
const WARN = '  !';

interface GraphError {
  error?: { message?: string; code?: number; type?: string };
}

async function graph<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('access_token', token);

  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const data = (await response.json()) as T & GraphError;

  if (!response.ok || data.error) {
    throw new Error(data.error?.message ?? `HTTP ${response.status}`);
  }
  return data;
}

async function main(): Promise<void> {
  loadEnvFile();

  const token = process.env.IG_ACCESS_TOKEN?.trim();

  console.log('\nINSTAGRAM KURULUM KONTROLU\n');

  if (!token) {
    console.log(`${FAIL} IG_ACCESS_TOKEN bulunamadi.`);
    console.log('\n  .env dosyasi olustur ve token satirini doldur:');
    console.log('    cp .env.example .env\n');
    process.exitCode = 1;
    return;
  }

  console.log(`${OK} Token bulundu (${token.length} karakter)`);

  // 1 — Izinler
  let grantedScopes: string[] = [];
  try {
    const permissions = await graph<{ data: { permission: string; status: string }[] }>('me/permissions', token);
    grantedScopes = permissions.data.filter((p) => p.status === 'granted').map((p) => p.permission);

    const missing = REQUIRED_SCOPES.filter(
      (alternatives) => !alternatives.some((scope) => grantedScopes.includes(scope)),
    );

    if (missing.length === 0) {
      console.log(`${OK} Gerekli izinlerin hepsi verilmis`);
    } else {
      console.log(`${FAIL} Eksik izin: ${missing.map((alt) => alt.join(' veya ')).join(', ')}`);
      console.log("     Token'i bu izinlerle yeniden uret.");
    }

    const missingOptional = OPTIONAL_SCOPES.filter((scope) => !grantedScopes.includes(scope));
    if (missingOptional.length > 0) {
      console.log(`${WARN} Onerilen ama zorunlu olmayan izin yok: ${missingOptional.join(', ')}`);
    }
  } catch (error) {
    console.log(`${FAIL} Token gecersiz veya suresi dolmus: ${String(error)}`);
    process.exitCode = 1;
    return;
  }

  // Sayfa taramasindan sonra degerlendirilir; asagidaki nota bak.
  let permissionsUnassigned = false;

  // 2 — Token omru ve izinlerin hangi varliklara verildigi
  try {
    const debug = await graph<{
      data: {
        expires_at?: number;
        type?: string;
        granular_scopes?: { scope: string; target_ids?: string[] }[];
      };
    }>('debug_token', token, { input_token: token });

    /**
     * Izin vermek ile o izni bir sayfaya atamak ayri adimlar. Onay ekraninda
     * sayfa secimi atlanirsa izinler "verilmis" gorunur ama hicbir varliga
     * baglanmaz; API o zaman bos liste dondurur ve sebebi hic soylenmez.
     *
     * Bu teshis yalnizca sayfa gercekten bulunamadiginda anlamli. System User
     * token'larinda varlik atamasi Business Manager tarafinda yapildigi icin
     * target_ids bos gelir, ama erisim sorunsuz calisir; o durumda uyarmak
     * yanlis alarm olur. Bu yuzden sonuc saklanip sayfa taramasindan sonra
     * degerlendiriliyor.
     */
    const granular = debug.data.granular_scopes ?? [];
    permissionsUnassigned =
      granular.length > 0 && granular.every((entry) => !entry.target_ids || entry.target_ids.length === 0);

    const expiresAt = debug.data.expires_at;
    if (!expiresAt || expiresAt === 0) {
      console.log(`${OK} Token suresiz (System User) — yenileme gerekmez`);
    } else {
      const days = Math.round((expiresAt * 1000 - Date.now()) / 86_400_000);
      const marker = days <= 7 ? FAIL : WARN;
      console.log(`${marker} Token ${days} gun sonra doluyor (${new Date(expiresAt * 1000).toLocaleDateString('tr-TR')})`);
      console.log('     Kalici cozum icin README > "Suresiz token al" adimlarini izle.');
    }
  } catch {
    console.log(`${WARN} Token omru sorgulanamadi (kritik degil)`);
  }

  // 3 — Sayfa ve Instagram hesabi
  let discoveredId: string | null = null;
  try {
    const pages = await graph<{ data: { id: string; name: string }[] }>('me/accounts', token);

    if (pages.data.length === 0) {
      console.log(`${FAIL} Token'a bagli Facebook sayfasi yok`);
      if (permissionsUnassigned) {
        console.log('     Izinler hicbir varliga atanmamis (target_ids bos).');
        console.log('     Explorer kullaniyorsan onay ekraninda "hangi sayfa" adimi atlanmis;');
        console.log('     uygulamanin erisimini kaldirip token\'i bastan uret.');
      }
      console.log('     System User kullaniyorsan sayfayi "Add Assets" ile atamayi unutma.');
    }

    for (const page of pages.data) {
      const detail = await graph<{ instagram_business_account?: { id: string } }>(page.id, token, {
        fields: 'instagram_business_account',
      });

      const igId = detail.instagram_business_account?.id;
      if (igId) {
        discoveredId = igId;
        const account = await graph<{ username?: string; followers_count?: number }>(igId, token, {
          fields: 'username,followers_count',
        });
        console.log(`${OK} Sayfa "${page.name}" -> Instagram @${account.username ?? '?'} (${igId})`);
      } else {
        console.log(`${WARN} Sayfa "${page.name}" bir Instagram Business hesabina bagli degil`);
      }
    }
  } catch (error) {
    console.log(`${FAIL} Sayfa bilgisi alinamadi: ${String(error)}`);
  }

  // 4 — IG_USER_ID karsilastirmasi
  const configuredId = process.env.IG_USER_ID?.trim();

  if (!configuredId && discoveredId) {
    console.log(`${WARN} IG_USER_ID .env'de bos. Su satiri ekle:`);
    console.log(`\n     IG_USER_ID=${discoveredId}\n`);
  } else if (configuredId && discoveredId && configuredId !== discoveredId) {
    console.log(`${FAIL} IG_USER_ID uyusmuyor. .env'de ${configuredId}, gercekte ${discoveredId}`);
  } else if (configuredId && configuredId === discoveredId) {
    console.log(`${OK} IG_USER_ID dogru`);
  }

  // 5 — Yayin kotasi
  const targetId = configuredId || discoveredId;
  if (targetId) {
    try {
      const limit = await graph<{ data: { quota_usage?: number; config?: { quota_total?: number } }[] }>(
        `${targetId}/content_publishing_limit`,
        token,
        { fields: 'quota_usage,config' },
      );
      const entry = limit.data[0];
      const total = entry?.config?.quota_total ?? 50;
      const used = entry?.quota_usage ?? 0;
      console.log(`${OK} Yayin kotasi: ${total - used}/${total} gonderi kullanilabilir`);
    } catch {
      console.log(`${WARN} Kota sorgulanamadi (yayin icin engel degil)`);
    }
  }

  console.log('\nHazirsa sirada: npm run post:dry\n');
}

main().catch((error: unknown) => {
  console.error(`\nHATA: ${String(error)}\n`);
  process.exitCode = 1;
});
