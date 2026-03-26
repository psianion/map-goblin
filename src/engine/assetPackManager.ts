// src/engine/assetPackManager.ts
import type { Texture } from 'pixi.js'
import pLimit from 'p-limit'
import type { AssetPackDB } from './assetPackDB'

export interface PackSummary {
  packId: string
  version: string
  entryCount: number
  themes: string[]
  bundleSize: number
}

export interface FrameData {
  x: number
  y: number
  w: number
  h: number
  atlas: string
}

export interface PackManagerConfig {
  cdnBaseUrl: string
  cacheLimit?: number // bytes, default 200MB
  packDB?: AssetPackDB
}

export interface PackManifest {
  version: string
  atlases: Record<string, { checksum: string }>
  files: Record<string, { checksum: string }>
  themes?: string[]
}

export interface PackUpdateReport {
  available: string[]
  current: string[]
}

export class AssetPackManager {
  private config: PackManagerConfig
  private installedPacks: Map<string, PackSummary> = new Map()
  private textureCache: Map<string, Texture> = new Map()
  private frameCache: Map<string, FrameData> = new Map()
  private downloadLimit = pLimit(3) // max 3 concurrent CDN requests
  private installTimestamps: number[] = [] // hourly cap tracking
  private packDB: AssetPackDB | undefined
  private static FALLBACK_TEXTURE: Texture | null = null

  constructor(config: PackManagerConfig) {
    this.config = config
    this.packDB = config.packDB
  }

  getInstalledPacks(): PackSummary[] {
    return Array.from(this.installedPacks.values())
  }

  /**
   * Returns the cached texture for entryId, or a 1x1 magenta fallback.
   * Never returns null — safe for use in the render loop.
   */
  getTexture(entryId: string): Texture {
    const cached = this.textureCache.get(entryId)
    if (cached) return cached

    // Return 1x1 magenta fallback (visible "missing texture" indicator)
    if (!AssetPackManager.FALLBACK_TEXTURE) {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ff00ff'
      ctx.fillRect(0, 0, 1, 1)
      // Dynamic import would be ideal but we need sync return;
      // Texture.from is available synchronously if pixi.js is loaded
      const { Texture } = require('pixi.js') as typeof import('pixi.js')
      AssetPackManager.FALLBACK_TEXTURE = Texture.from(canvas)
    }
    return AssetPackManager.FALLBACK_TEXTURE
  }

  /**
   * Returns the cached texture if available, or null.
   * Use when you need to check existence without triggering fallback creation.
   */
  getTextureOrNull(entryId: string): Texture | null {
    return this.textureCache.get(entryId) ?? null
  }

  getFrame(entryId: string): FrameData | null {
    return this.frameCache.get(entryId) ?? null
  }

  async checkForUpdates(): Promise<PackUpdateReport> {
    const etag = localStorage.getItem('index-etag')
    const headers: Record<string, string> = {}
    if (etag) headers['If-None-Match'] = etag

    const res = await fetch(`${this.config.cdnBaseUrl}/index.json`, {
      signal: AbortSignal.timeout(3_000),
      headers,
    })

    if (res.status === 304) {
      return { available: [], current: [...this.installedPacks.keys()] }
    }
    if (!res.ok) throw new Error(`CDN check failed: ${res.status}`)

    const newEtag = res.headers.get('etag')
    if (newEtag) localStorage.setItem('index-etag', newEtag)

    const _index = await res.json()
    // TODO: compare with installed versions
    return { available: [], current: [...this.installedPacks.keys()] }
  }

  async installPack(packId: string): Promise<void> {
    // Rate limit: max 10 installs per hour
    const oneHourAgo = Date.now() - 3600_000
    this.installTimestamps = this.installTimestamps.filter((t) => t > oneHourAgo)
    if (this.installTimestamps.length >= 10) {
      throw new Error('Rate limit: max 10 pack installs per hour')
    }
    this.installTimestamps.push(Date.now())

    // 1. Download manifest with timeout
    const manifestUrl = `${this.config.cdnBaseUrl}/${packId}/pack.json`
    const manifestRes = await fetch(manifestUrl, { signal: AbortSignal.timeout(10_000) })
    if (!manifestRes.ok) throw new Error(`Failed to fetch manifest: ${manifestRes.status}`)
    const manifest = (await manifestRes.json()) as PackManifest

    // 2. Download all assets with concurrency limit
    const allFiles = [...Object.keys(manifest.atlases), ...Object.keys(manifest.files)]
    const blobs = new Map<string, Uint8Array>()

    await Promise.all(
      allFiles.map((file) =>
        this.downloadLimit(async () => {
          const url = `${this.config.cdnBaseUrl}/${packId}/${file}`
          const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
          if (!res.ok) throw new Error(`Failed to download ${file}: ${res.status}`)
          const buf = new Uint8Array(await res.arrayBuffer())
          blobs.set(file, buf)
        }),
      ),
    )

    // 3. Verify checksums
    const allRefs = { ...manifest.atlases, ...manifest.files }
    for (const [file, ref] of Object.entries(allRefs)) {
      const blob = blobs.get(file)!
      const hash = await crypto.subtle.digest('SHA-256', blob)
      const hex = Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const expected = ref.checksum.replace('sha256:', '')
      if (hex !== expected) {
        throw new Error(`Checksum mismatch for ${file}`)
      }
    }

    // 4. Check cache capacity, evict if needed
    const packSize = [...blobs.values()].reduce((s, b) => s + b.length, 0)
    if (this.packDB) {
      const usage = await this.packDB.getCacheUsage()
      if (usage.used + packSize > usage.limit) {
        const evicted = await this.packDB.evictLRU(packSize - (usage.limit - usage.used))
        // Amendment B3: also clear in-memory textures for evicted packs
        for (const evictedId of evicted) {
          this.clearPackTextures(evictedId)
        }
      }

      // 5. Atomic write to IndexedDB
      await this.packDB.installPack({
        packId,
        version: manifest.version,
        bundleSize: packSize,
        manifest: new TextEncoder().encode(JSON.stringify(manifest)),
        blobs,
        lastUsed: Date.now(),
        bundled: false,
      })
    }

    // 6. Register in memory and load textures
    const entryCount = Object.keys(manifest.atlases).length + Object.keys(manifest.files).length
    this.installedPacks.set(packId, {
      packId,
      version: manifest.version,
      entryCount,
      themes: manifest.themes ?? [],
      bundleSize: packSize,
    })

    // 7. Load textures with GPU upload yielding (Amendment B2)
    await this.loadPackTextures(packId, manifest, blobs)
  }

  /**
   * Load atlas textures into PixiJS with yielding between uploads
   * to prevent frame drops (Amendment B2).
   */
  private async loadPackTextures(
    packId: string,
    manifest: PackManifest,
    blobs: Map<string, Uint8Array>,
  ): Promise<void> {
    const PIXI = await import('pixi.js')

    for (const [atlasJsonFile] of Object.entries(manifest.atlases)) {
      if (!atlasJsonFile.endsWith('.json')) continue

      const jsonBlob = blobs.get(atlasJsonFile)
      if (!jsonBlob) continue
      const json = JSON.parse(new TextDecoder().decode(jsonBlob))
      const imageFile = json.meta?.image as string | undefined
      if (!imageFile) continue
      const imageBlob = blobs.get(imageFile)
      if (!imageBlob) continue

      // Create blob URL and load into PixiJS
      const blob = new Blob([imageBlob], { type: 'image/webp' })
      const url = URL.createObjectURL(blob)
      const spritesheet = await PIXI.Assets.load({ src: url, data: json })

      // Register frames in sync cache
      for (const [frameId, texture] of Object.entries(
        spritesheet.textures as Record<string, Texture>,
      )) {
        this.textureCache.set(`${packId}:${frameId}`, texture)
      }

      URL.revokeObjectURL(url)

      // Yield to event loop between atlas uploads — prevents frame drops
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  async updatePack(packId: string): Promise<void> {
    // Download new version, then clean up old
    await this.uninstallPack(packId)
    await this.installPack(packId)
  }

  async uninstallPack(packId: string): Promise<void> {
    // Amendment B3: Remove from in-memory caches
    this.clearPackTextures(packId)

    // Unload from PixiJS GPU
    if (this.packDB) {
      const pack = await this.packDB.getPack(packId)
      if (pack) {
        try {
          const manifest = JSON.parse(
            new TextDecoder().decode(new Uint8Array(pack.manifest as ArrayBuffer)),
          ) as PackManifest
          const PIXI = await import('pixi.js')
          for (const atlasFile of Object.keys(manifest.atlases)) {
            if (atlasFile.endsWith('.json')) {
              await PIXI.Assets.unload(atlasFile).catch(() => {})
            }
          }
        } catch {
          // Manifest parse failure is non-fatal during uninstall
        }
      }
      await this.packDB.deletePack(packId)
    }

    this.installedPacks.delete(packId)
  }

  getCacheUsage(): { used: number; limit: number } {
    return { used: 0, limit: this.config.cacheLimit ?? 200 * 1024 * 1024 }
  }

  clearCache(): void {
    this.textureCache.clear()
    this.frameCache.clear()
    this.installedPacks.clear()
  }

  /** Clear in-memory textures and frames for a specific pack */
  private clearPackTextures(packId: string): void {
    const prefix = packId + ':'
    for (const key of [...this.textureCache.keys()]) {
      if (key.startsWith(prefix)) {
        this.textureCache.delete(key)
        this.frameCache.delete(key)
      }
    }
  }
}
