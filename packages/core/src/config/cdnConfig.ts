// CDN configuration for asset pack fetching.
// Local dev: Vite serves from public/packs/ via relative path.
// Production: set VITE_CDN_BASE_URL to the real CDN origin.

export const cdnConfig = {
  // `||`, not `??`: the Docker build declares VITE_CDN_BASE_URL with an empty default so
  // the arg always exists, and Vite inlines that as "" — a value `??` happily keeps. That
  // silently rebases every pack URL to the site root and 404s the lot. Empty means unset.
  baseUrl: import.meta.env.VITE_CDN_BASE_URL || '/packs',
  catalogPath: '/catalog',
  packsPath: '/packs',
} as const

/** Full URL for a pack's manifest and assets directory. */
export function cdnPackUrl(packId: string, version: string): string {
  return `${cdnConfig.baseUrl}/${packId}/${version}`
}

/** Full URL for a catalog chunk or meta file. */
export function cdnCatalogUrl(path: string): string {
  return `${cdnConfig.baseUrl}${cdnConfig.catalogPath}/${path}`
}
