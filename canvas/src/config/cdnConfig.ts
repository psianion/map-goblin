// CDN configuration for asset pack fetching.
// Local dev: Vite serves from public/packs/ via relative path.
// Production: set VITE_CDN_BASE_URL to the real CDN origin.

export const cdnConfig = {
  baseUrl: import.meta.env.VITE_CDN_BASE_URL ?? '/packs',
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
