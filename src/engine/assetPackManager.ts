// src/engine/assetPackManager.ts (in map-builder repo)
import type { Texture } from 'pixi.js'

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
}

export class AssetPackManager {
  private config: PackManagerConfig
  private installedPacks: Map<string, PackSummary> = new Map()
  private textureCache: Map<string, Texture> = new Map()
  private frameCache: Map<string, FrameData> = new Map()

  constructor(config: PackManagerConfig) {
    this.config = config
  }

  getInstalledPacks(): PackSummary[] {
    return Array.from(this.installedPacks.values())
  }

  getTexture(entryId: string): Texture | null {
    return this.textureCache.get(entryId) ?? null
  }

  getFrame(entryId: string): FrameData | null {
    return this.frameCache.get(entryId) ?? null
  }

  async checkForUpdates(): Promise<{ available: string[]; current: string[] }> {
    // Fetch index.json from CDN, compare against installed versions
    const response = await fetch(`${this.config.cdnBaseUrl}/index.json`)
    const _index = await response.json()
    // TODO: compare with installed
    return { available: [], current: [] }
  }

  async installPack(_packId: string): Promise<void> {
    // Atomic Install Protocol (spec section 10)
    // 1. Download manifest
    // 2. Download assets (parallel, max 3 concurrent)
    // 3. Verify checksums
    // 4. Atomic write to IndexedDB
    // 5. Register in memory
  }

  async updatePack(_packId: string): Promise<void> {
    // Download new version, verify, write, then delete old
  }

  uninstallPack(packId: string): void {
    this.installedPacks.delete(packId)
    // Remove from IndexedDB
  }

  getCacheUsage(): { used: number; limit: number } {
    return { used: 0, limit: this.config.cacheLimit ?? 200 * 1024 * 1024 }
  }

  clearCache(): void {
    this.textureCache.clear()
    this.frameCache.clear()
    this.installedPacks.clear()
  }
}
