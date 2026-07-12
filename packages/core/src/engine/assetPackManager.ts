// src/engine/assetPackManager.ts
import { Texture } from 'pixi.js'
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

// SYNC: these types align with map-assets canonical pack schema — update when upstream changes
export interface FileRef {
  checksum: string
  size: number
}

export interface ManifestEntry {
  type: string
  localId: string
  atlas: string
  frame: string
  gridSize: string
  tags: string[]
}

export interface PackManifest {
  name: string
  description: string
  version: string
  bundleSize: number
  entries: Record<string, ManifestEntry>
  atlases: Record<string, FileRef>
  files: Record<string, FileRef>
  themes?: string[]
}

export interface IndexEntry {
  version: string
  bundleSize: number
  entryCount: number
  themes: string[]
  preview: string
  manifest: string
}

export interface PackIndex {
  packs: Record<string, IndexEntry>
}

export interface PackUpdateInfo {
  packId: string
  currentVersion: string
  availableVersion: string
}

/** Result of a differential pack update (Phase 7) */
export interface PackDiffResult {
  changedFiles: number
  unchangedFiles: number
  downloadedBytes: number
  totalFiles: number
}

export class AssetPackManager {
  private config: PackManagerConfig
  private installedPacks: Map<string, PackSummary> = new Map()
  private textureCache: Map<string, Texture> = new Map()
  private frameCache: Map<string, FrameData> = new Map()
  private downloadLimit = pLimit(3) // max 3 concurrent CDN requests
  private installTimestamps: number[] = [] // hourly cap tracking
  private packDB: AssetPackDB | undefined
  private cachedIndex: PackIndex | null = null
  private manifestCache: Map<string, PackManifest> = new Map()
  private static FALLBACK_TEXTURE: Texture | null = null

  constructor(config: PackManagerConfig) {
    this.config = config
    this.packDB = config.packDB
  }

  /** Fetch and cache the pack index from CDN. */
  async fetchIndex(): Promise<PackIndex> {
    if (this.cachedIndex) return this.cachedIndex
    const res = await fetch(`${this.config.cdnBaseUrl}/index.json`, {
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) throw new Error(`Failed to fetch pack index: ${res.status}`)
    const index = (await res.json()) as PackIndex
    this.cachedIndex = index
    return index
  }

  /** Get all cached pack manifests (populated by rehydrate/install/register). */
  getPackManifests(): Array<{ packId: string; manifest: PackManifest }> {
    return Array.from(this.manifestCache.entries()).map(([packId, manifest]) => ({
      packId,
      manifest,
    }))
  }

  /** Resolve the manifest filename for a pack from the index. */
  private async resolveManifestPath(packId: string): Promise<string> {
    try {
      const index = await this.fetchIndex()
      const entry = index.packs[packId]
      if (entry?.manifest) return entry.manifest
    } catch {
      // Index unavailable — fall through to default
    }
    return 'pack.json'
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

  /** Get all cached entry IDs for a specific pack */
  getEntryIds(packId: string): string[] {
    const prefix = packId + ':'
    const ids: string[] = []
    for (const key of this.textureCache.keys()) {
      if (key.startsWith(prefix)) ids.push(key)
    }
    return ids
  }

  async checkForUpdates(): Promise<PackUpdateInfo[]> {
    try {
      const etag = localStorage.getItem('index-etag')
      const headers: Record<string, string> = {}
      if (etag) headers['If-None-Match'] = etag

      const res = await fetch(`${this.config.cdnBaseUrl}/index.json`, {
        signal: AbortSignal.timeout(3_000),
        headers,
      })

      if (res.status === 304) return []
      if (!res.ok) return []

      const newEtag = res.headers.get('etag')
      if (newEtag) localStorage.setItem('index-etag', newEtag)

      const index = (await res.json()) as PackIndex
      if (!index?.packs || typeof index.packs !== 'object') return []
      const updates: PackUpdateInfo[] = []

      for (const [packId, remote] of Object.entries(index.packs)) {
        const installed = this.installedPacks.get(packId)
        if (!installed) continue
        if (compareSemver(remote.version, installed.version) > 0) {
          updates.push({
            packId,
            currentVersion: installed.version,
            availableVersion: remote.version,
          })
        }
      }

      return updates
    } catch {
      // CDN unreachable — return empty, don't block app
      return []
    }
  }

  async installPack(packId: string, onProgress?: (percent: number) => void): Promise<void> {
    // Rate limit: max 10 installs per hour
    const oneHourAgo = Date.now() - 3600_000
    this.installTimestamps = this.installTimestamps.filter((t) => t > oneHourAgo)
    if (this.installTimestamps.length >= 10) {
      throw new Error('Rate limit: max 10 pack installs per hour')
    }
    this.installTimestamps.push(Date.now())

    // 1. Download manifest with timeout — resolve content-hashed filename from index
    const manifestFilename = await this.resolveManifestPath(packId)
    const manifestUrl = `${this.config.cdnBaseUrl}/${packId}/${manifestFilename}`
    const manifestRes = await fetch(manifestUrl, { signal: AbortSignal.timeout(10_000) })
    if (!manifestRes.ok) throw new Error(`Failed to fetch manifest: ${manifestRes.status}`)
    const manifest = (await manifestRes.json()) as PackManifest

    // 2. Download all assets with concurrency limit
    // Phase 7: Progressive loading — prioritize floor/wall (most visual impact)
    const allFiles = [...Object.keys(manifest.atlases), ...Object.keys(manifest.files)]
    const sortedFiles = sortByDownloadPriority(allFiles)
    const blobs = new Map<string, Uint8Array>()

    let downloaded = 0
    const total = sortedFiles.length
    await Promise.all(
      sortedFiles.map((file) =>
        this.downloadLimit(async () => {
          const url = `${this.config.cdnBaseUrl}/${packId}/${file}`
          const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
          if (!res.ok) throw new Error(`Failed to download ${file}: ${res.status}`)
          const buf = new Uint8Array(await res.arrayBuffer())
          blobs.set(file, buf)
          downloaded++
          onProgress?.(Math.round((downloaded / total) * 80)) // 0-80% for downloads
        }),
      ),
    )

    // 3. Verify checksums
    const allRefs = { ...manifest.atlases, ...manifest.files }
    for (const [file, ref] of Object.entries(allRefs)) {
      const blob = blobs.get(file)!
      const hash = await crypto.subtle.digest('SHA-256', blob.buffer as ArrayBuffer)
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
        manifest: new TextEncoder().encode(JSON.stringify(manifest)).buffer as ArrayBuffer,
        blobs,
        lastUsed: Date.now(),
        bundled: false,
      })
    }

    // 6. Register in memory and load textures
    this.manifestCache.set(packId, manifest)
    const entryCount = Object.keys(manifest.entries).length
    this.installedPacks.set(packId, {
      packId,
      version: manifest.version,
      entryCount,
      themes: manifest.themes ?? [],
      bundleSize: packSize,
    })

    // 7. Load textures with GPU upload yielding (Amendment B2)
    onProgress?.(85)
    await this.loadPackTextures(packId, manifest, blobs)
    onProgress?.(100)
  }

  /**
   * Register a pre-downloaded pack directly (used by firstBootInstall for bundled packs).
   * Skips fetch + checksum verification — caller is responsible for trusted data.
   */
  async registerPack(
    packId: string,
    manifest: PackManifest,
    blobs: Map<string, Uint8Array>,
    bundled: boolean = false,
  ): Promise<void> {
    const packSize = [...blobs.values()].reduce((s, b) => s + b.length, 0)
    this.manifestCache.set(packId, manifest)

    if (this.packDB) {
      await this.packDB.installPack({
        packId,
        version: manifest.version,
        bundleSize: packSize,
        manifest: new TextEncoder().encode(JSON.stringify(manifest)).buffer as ArrayBuffer,
        blobs,
        lastUsed: Date.now(),
        bundled,
      })
    }

    const entryCount = Object.keys(manifest.entries).length
    this.installedPacks.set(packId, {
      packId,
      version: manifest.version,
      entryCount,
      themes: manifest.themes ?? [],
      bundleSize: packSize,
    })

    await this.loadPackTextures(packId, manifest, blobs)
  }

  /**
   * Load atlas textures into PixiJS with yielding between uploads
   * to prevent frame drops (Amendment B2).
   *
   * Uses manual Spritesheet creation instead of Assets.load() because
   * blob URLs lack file extensions for PixiJS parser detection.
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

      try {
        // Load the atlas image as a base texture via blob URL
        const blob = new Blob([imageBlob.buffer as ArrayBuffer], { type: 'image/webp' })
        const url = URL.createObjectURL(blob)

        // Load the image into PixiJS as a plain texture
        const baseTexture = await PIXI.Assets.load<Texture>({
          src: url,
          loadParser: 'loadTextures',
        })

        // Manually create and parse the spritesheet from the loaded texture + JSON data
        const spritesheet = new PIXI.Spritesheet(baseTexture, json)
        await spritesheet.parse()

        // Register frames in sync cache
        for (const [frameId, texture] of Object.entries(
          spritesheet.textures as Record<string, Texture>,
        )) {
          this.textureCache.set(`${packId}:${frameId}`, texture)
        }

        // Don't revoke blob URL — needed for thumbnail canvas rendering
      } catch (err) {
        console.warn(`[AssetPackManager] Failed to load atlas "${atlasJsonFile}" for pack "${packId}":`, err)
      }

      // Yield to event loop between atlas uploads — prevents frame drops
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    // Also load standalone files (objects, scatter) that aren't in atlases
    for (const [fileName] of Object.entries(manifest.files)) {
      const fileBlob = blobs.get(fileName)
      if (!fileBlob) continue

      try {
        const blob = new Blob([fileBlob.buffer as ArrayBuffer], { type: 'image/webp' })
        const url = URL.createObjectURL(blob)
        const texture = await PIXI.Assets.load<Texture>({
          src: url,
          loadParser: 'loadTextures',
        })

        // Match standalone file to its entry. Real pack manifests carry
        // `material`/`gridSize`/`variant` (no `localId` field); files are named
        // `{material}_{gridSize}_{variant}-{hash}.webp` while the entry key is
        // `{material}_{gridSize}_{type}_{variant}`. Register under the entry KEY
        // — that's what manifestBridge/resolveTexture look up.
        for (const [entryId, entry] of Object.entries(manifest.entries)) {
          const e = entry as ManifestEntry & { material?: string; variant?: string }
          const prefix = e.material
            ? `${e.material}_${e.gridSize}_${e.variant ?? 'A'}-`
            : e.localId
          if (prefix && fileName.startsWith(prefix)) {
            this.textureCache.set(`${packId}:${entryId}`, texture)
            break
          }
        }
      } catch (err) {
        console.warn(`[AssetPackManager] Failed to load file "${fileName}":`, err)
      }
    }
  }

  /**
   * Phase 7: Differential pack update — only download files with changed checksums.
   * Falls back to full reinstall if the old manifest can't be read from IndexedDB.
   */
  async updatePack(packId: string): Promise<PackDiffResult> {
    // 1. Fetch new manifest — resolve content-hashed filename from index
    const manifestFilename = await this.resolveManifestPath(packId)
    const manifestUrl = `${this.config.cdnBaseUrl}/${packId}/${manifestFilename}`
    const manifestRes = await fetch(manifestUrl, { signal: AbortSignal.timeout(10_000) })
    if (!manifestRes.ok) throw new Error(`Failed to fetch manifest: ${manifestRes.status}`)
    const newManifest = (await manifestRes.json()) as PackManifest

    // 2. Try to load old manifest from IndexedDB for diffing
    let oldChecksums: Map<string, string> | null = null
    if (this.packDB) {
      const stored = await this.packDB.getPack(packId)
      if (stored) {
        try {
          const oldManifest = JSON.parse(
            new TextDecoder().decode(new Uint8Array(stored.manifest as ArrayBuffer)),
          ) as PackManifest
          oldChecksums = new Map<string, string>()
          for (const [file, ref] of Object.entries({ ...oldManifest.atlases, ...oldManifest.files })) {
            oldChecksums.set(file, ref.checksum)
          }
        } catch {
          // Can't read old manifest — will do full download
        }
      }
    }

    // 3. Diff: find changed files
    const newRefs = { ...newManifest.atlases, ...newManifest.files }
    const allNewFiles = Object.keys(newRefs)
    let changedFiles: string[]
    let unchangedCount = 0

    if (oldChecksums) {
      changedFiles = allNewFiles.filter((file) => {
        const oldChecksum = oldChecksums!.get(file)
        const newChecksum = newRefs[file]?.checksum
        if (oldChecksum && oldChecksum === newChecksum) {
          unchangedCount++
          return false
        }
        return true
      })
    } else {
      changedFiles = allNewFiles
    }

    // 4. Download only changed files
    const blobs = new Map<string, Uint8Array>()

    // Reuse unchanged blobs from IndexedDB
    if (oldChecksums && this.packDB && unchangedCount > 0) {
      const stored = await this.packDB.getPack(packId)
      if (stored) {
        const oldBlobs = stored.blobs instanceof Map
          ? stored.blobs
          : new Map(Object.entries(stored.blobs as Record<string, Uint8Array>))
        for (const [file] of oldBlobs) {
          if (!changedFiles.includes(file)) {
            blobs.set(file, oldBlobs.get(file)!)
          }
        }
      }
    }

    // Download changed files
    const sortedChanged = sortByDownloadPriority(changedFiles)
    await Promise.all(
      sortedChanged.map((file) =>
        this.downloadLimit(async () => {
          const url = `${this.config.cdnBaseUrl}/${packId}/${file}`
          const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
          if (!res.ok) throw new Error(`Failed to download ${file}: ${res.status}`)
          blobs.set(file, new Uint8Array(await res.arrayBuffer()))
        }),
      ),
    )

    // 5. Verify checksums for changed files
    for (const file of changedFiles) {
      const blob = blobs.get(file)!
      const hash = await crypto.subtle.digest('SHA-256', blob.buffer as ArrayBuffer)
      const hex = Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const expected = newRefs[file]?.checksum?.replace('sha256:', '')
      if (expected && hex !== expected) {
        throw new Error(`Checksum mismatch for ${file}`)
      }
    }

    // 6. Clear old textures and reinstall
    this.clearPackTextures(packId)
    const packSize = [...blobs.values()].reduce((s, b) => s + b.length, 0)

    if (this.packDB) {
      await this.packDB.installPack({
        packId,
        version: newManifest.version,
        bundleSize: packSize,
        manifest: new TextEncoder().encode(JSON.stringify(newManifest)).buffer as ArrayBuffer,
        blobs,
        lastUsed: Date.now(),
        bundled: false,
      })
    }

    const entryCount = Object.keys(newManifest.entries).length
    this.installedPacks.set(packId, {
      packId,
      version: newManifest.version,
      entryCount,
      themes: newManifest.themes ?? [],
      bundleSize: packSize,
    })

    await this.loadPackTextures(packId, newManifest, blobs)

    const changedSize = sortedChanged.reduce((s, f) => s + (blobs.get(f)?.length ?? 0), 0)
    return {
      changedFiles: changedFiles.length,
      unchangedFiles: unchangedCount,
      downloadedBytes: changedSize,
      totalFiles: allNewFiles.length,
    }
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

  /**
   * Restore textures from IndexedDB at app boot.
   * Loads all installed packs into memory without re-downloading.
   */
  async rehydrate(): Promise<void> {
    if (!this.packDB) return

    await this.packDB.open()
    const packs = await this.packDB.getAllPacks()

    let loadedCount = 0
    let textureCount = 0

    for (const stored of packs) {
      try {
        const manifest = JSON.parse(
          new TextDecoder().decode(new Uint8Array(stored.manifest as ArrayBuffer)),
        ) as PackManifest

        const entryCount = Object.keys(manifest.entries).length
        this.installedPacks.set(stored.packId, {
          packId: stored.packId,
          version: stored.version,
          entryCount,
          themes: manifest.themes ?? [],
          bundleSize: stored.bundleSize,
        })
        this.manifestCache.set(stored.packId, manifest)

        // Restore blobs map from stored plain object
        const blobs = stored.blobs instanceof Map
          ? stored.blobs
          : new Map(Object.entries(stored.blobs as Record<string, Uint8Array>))

        await this.loadPackTextures(stored.packId, manifest, blobs)
        loadedCount++
        textureCount += this.countPackTextures(stored.packId)
      } catch (err) {
        console.warn(`[AssetPackManager] Failed to rehydrate pack "${stored.packId}":`, err)
      }
    }

    if (loadedCount > 0) {
      console.info(`[AssetPackManager] Rehydrated ${loadedCount} pack(s), ${textureCount} texture(s)`)
    }
  }

  /** Count textures belonging to a specific pack */
  private countPackTextures(packId: string): number {
    const prefix = packId + ':'
    let count = 0
    for (const key of this.textureCache.keys()) {
      if (key.startsWith(prefix)) count++
    }
    return count
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

/**
 * Phase 7: Sort files by download priority for progressive loading.
 * Floor/wall atlases first (most visual impact), then edges, then objects/scatter.
 */
function sortByDownloadPriority(files: string[]): string[] {
  const priority = (f: string): number => {
    const lower = f.toLowerCase()
    if (lower.includes('floor')) return 0
    if (lower.includes('wall')) return 1
    if (lower.includes('edge')) return 2
    if (lower.includes('scatter')) return 3
    // Individual object files (non-atlas) are lowest priority
    if (lower.endsWith('.webp') && !lower.includes('atlas')) return 5
    return 4
  }
  return [...files].sort((a, b) => priority(a) - priority(b))
}

/** Compare two semver strings. Returns >0 if a > b, 0 if equal, <0 if a < b. */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}
