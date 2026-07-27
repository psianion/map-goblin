export interface CachePurgeConfig {
  zoneId: string;
  apiToken: string;
  /** CDN origin, e.g. https://cdn.example.app — Cloudflare needs full URLs. */
  baseUrl: string;
}

export async function purgeUrls(config: CachePurgeConfig, urls: string[]): Promise<void> {
  if (urls.length === 0) return;

  // Callers pass object keys; Cloudflare's `files` array requires absolute URLs
  const base = config.baseUrl.replace(/\/$/, '');
  const files = urls.map((k) => (k.startsWith('http') ? k : `${base}/${k}`));

  // Cloudflare limits to 30 URLs per purge request
  const batchSize = 30;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${config.zoneId}/purge_cache`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ files: batch }),
      },
    );

    // Cloudflare reports logical failures as HTTP 200 with success:false
    const body = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      errors?: unknown[];
    };
    if (!response.ok || body.success !== true) {
      throw new Error(
        `Cache purge failed (${response.status}): ${JSON.stringify(body.errors ?? body)}`,
      );
    }
  }
}
