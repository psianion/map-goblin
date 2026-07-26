export interface CachePurgeConfig {
  zoneId: string;
  apiToken: string;
}

export async function purgeUrls(config: CachePurgeConfig, urls: string[]): Promise<void> {
  if (urls.length === 0) return;

  // Cloudflare limits to 30 URLs per purge request
  const batchSize = 30;
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
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

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Cache purge failed (${response.status}): ${body}`);
    }
  }
}
