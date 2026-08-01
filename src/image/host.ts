import { createHash } from 'node:crypto';
import type { ImageHostConfig } from '../config.js';
import { fetchWithRetry } from '../lib/http.js';

/**
 * Instagram gorseli PUBLIC bir URL'den ceker; dosya yuklemesi kabul etmez.
 * Bu yuzden uretilen kareyi once internete acik bir yere koymak gerekir.
 *
 * Iki secenek var:
 *  - github: gorsel repo'nun ayri bir branch'ine commit edilir (repo public olmali)
 *  - cloudinary: private repo kullananlar icin CDN
 */
export interface HostedImage {
  readonly url: string;
}

export async function hostImage(config: ImageHostConfig, fileName: string, image: Buffer): Promise<HostedImage> {
  return config.kind === 'github'
    ? hostOnGitHub(config, fileName, image)
    : hostOnCloudinary(config, fileName, image);
}

async function hostOnGitHub(
  config: Extract<ImageHostConfig, { kind: 'github' }>,
  fileName: string,
  image: Buffer,
): Promise<HostedImage> {
  const path = `posts/${fileName}`;
  const apiUrl = `https://api.github.com/repos/${config.repository}/contents/${path}`;

  const headers = {
    authorization: `Bearer ${config.token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
  };

  // Ayni gun iki kez calisirsa dosya zaten olabilir; guncelleme icin sha gerekir.
  const existingSha = await fetchExistingSha(apiUrl, config.branch, headers);

  await fetchWithRetry(apiUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: `chore: add instagram image ${fileName}`,
      content: image.toString('base64'),
      branch: config.branch,
      ...(existingSha ? { sha: existingSha } : {}),
    }),
  });

  return {
    url: `https://raw.githubusercontent.com/${config.repository}/${config.branch}/${path}`,
  };
}

async function fetchExistingSha(
  apiUrl: string,
  branch: string,
  headers: Record<string, string>,
): Promise<string | null> {
  try {
    const response = await fetchWithRetry(`${apiUrl}?ref=${encodeURIComponent(branch)}`, { headers });
    const data = (await response.json()) as { sha?: string };
    return data.sha ?? null;
  } catch {
    // 404 = dosya yok, normal durum.
    return null;
  }
}

async function hostOnCloudinary(
  config: Extract<ImageHostConfig, { kind: 'cloudinary' }>,
  fileName: string,
  image: Buffer,
): Promise<HostedImage> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const publicId = `instagram/${fileName.replace(/\.[^.]+$/, '')}`;

  // Cloudinary imzasi: parametreler alfabetik siralanip api_secret ile hashlenir.
  const signature = createHash('sha1')
    .update(`public_id=${publicId}&timestamp=${timestamp}${config.apiSecret}`)
    .digest('hex');

  const isVideo = /\.mp4$/i.test(fileName);
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(image)], { type: isVideo ? 'video/mp4' : 'image/jpeg' }), fileName);
  form.append('public_id', publicId);
  form.append('timestamp', timestamp);
  form.append('api_key', config.apiKey);
  form.append('signature', signature);

  // Cloudinary video icin ayri bir kaynak yolu kullaniyor.
  const resource = isVideo ? 'video' : 'image';
  const response = await fetchWithRetry(
    `https://api.cloudinary.com/v1_1/${config.cloudName}/${resource}/upload`,
    { method: 'POST', body: form },
  );

  const data = (await response.json()) as { secure_url?: string };
  if (!data.secure_url) throw new Error('Cloudinary yuklemesi URL dondurmedi.');

  return { url: data.secure_url };
}
