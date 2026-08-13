// src/engine/assetPackDB.ts
// IndexedDB wrapper for asset pack storage with atomic install and LRU eviction

const DB_NAME = 'map-builder-packs'
const DB_VERSION = 1
const STORE_NAME = 'packs'
const CACHE_LIMIT = 200 * 1024 * 1024

export interface StoredPack {
  packId: string
  version: string
  bundleSize: number
  manifest: ArrayBuffer
  blobs: Map<string, Uint8Array>
  lastUsed: number
  bundled: boolean
  /**
   * Asset sets whose files currently live in `blobs` — the bundle/full-install
   * baseline plus anything fetched later via AssetPackManager.ensureAssetSets.
   */
  installedAssetSets?: string[]
  /** Byte size of each installed asset set's files, for cache accounting. */
  assetSetBytes?: Record<string, number>
  /**
   * Which files in `blobs` each installed asset set owns. Recorded at merge
   * time so eviction can drop exactly the right blobs without re-deriving the
   * mapping from a manifest the DB layer doesn't have.
   */
  assetSetFiles?: Record<string, string[]>
  /**
   * Subset of `installedAssetSets` that arrived via ensureAssetSets rather
   * than with the bundle/full install. Only these count toward a bundled
   * pack's cache usage and are ever evicted — the baseline ships with the app
   * and never leaves.
   */
  dynamicAssetSets?: string[]
}

const ASSET_SET_LRU_KEY = 'asset-set-lru'

function lruKey(packId: string, setName: string): string {
  return `${packId}:${setName}`
}

/**
 * LRU timestamps for dynamically-fetched asset sets, keyed by `packId:setName`.
 * Lives in localStorage rather than on the pack record — bumping a timestamp
 * on every use must not rewrite an 8MB blob map.
 */
export function getAssetSetLRU(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(ASSET_SET_LRU_KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

export function bumpAssetSetLRU(packId: string, setName: string): void {
  const lru = getAssetSetLRU()
  lru[lruKey(packId, setName)] = Date.now()
  localStorage.setItem(ASSET_SET_LRU_KEY, JSON.stringify(lru))
}

export function removeAssetSetLRU(packId: string, setName: string): void {
  const lru = getAssetSetLRU()
  delete lru[lruKey(packId, setName)]
  localStorage.setItem(ASSET_SET_LRU_KEY, JSON.stringify(lru))
}

export class AssetPackDB {
  private db: IDBDatabase | null = null
  private dbName: string

  constructor(dbName: string = DB_NAME) {
    this.dbName = dbName
  }

  async open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'packId' })
        }
      }
      req.onsuccess = () => {
        this.db = req.result
        resolve()
      }
      req.onerror = () => reject(req.error)
    })
  }

  async installPack(pack: StoredPack): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      // Convert Map to plain object for IDB storage
      const serialized = { ...pack, blobs: Object.fromEntries(pack.blobs) }
      store.put(serialized)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async getPack(packId: string): Promise<StoredPack | null> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(packId)
      req.onsuccess = () => {
        if (!req.result) {
          resolve(null)
          return
        }
        const raw = req.result
        resolve({ ...raw, blobs: new Map(Object.entries(raw.blobs)) })
      }
      req.onerror = () => reject(req.error)
    })
  }

  async deletePack(packId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(packId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  /**
   * Merge additional blobs for newly-fetched asset sets into an already
   * installed pack record.
   *
   * ponytail: read-modify-write of the whole record — fine at current pack
   * sizes (tens of MB); split blob storage into its own object store if a
   * pack grows past that.
   */
  async mergeAssetSetBlobs(
    packId: string,
    blobs: Map<string, Uint8Array>,
    setFiles: Record<string, string[]>,
  ): Promise<void> {
    const pack = await this.getPack(packId)
    if (!pack) return
    for (const [file, blob] of blobs) pack.blobs.set(file, blob)

    const installedAssetSets = new Set(pack.installedAssetSets ?? [])
    const dynamicAssetSets = new Set(pack.dynamicAssetSets ?? [])
    const assetSetBytes = { ...pack.assetSetBytes }
    const assetSetFiles = { ...pack.assetSetFiles }
    for (const [setName, files] of Object.entries(setFiles)) {
      installedAssetSets.add(setName)
      dynamicAssetSets.add(setName)
      assetSetBytes[setName] = files.reduce((s, f) => s + (blobs.get(f)?.length ?? 0), 0)
      assetSetFiles[setName] = files
    }

    await this.installPack({
      ...pack,
      installedAssetSets: [...installedAssetSets],
      dynamicAssetSets: [...dynamicAssetSets],
      assetSetBytes,
      assetSetFiles,
    })
  }

  /** Drop one asset set's blobs from a pack record and its LRU entry. */
  private async evictAssetSet(packId: string, setName: string): Promise<void> {
    const pack = await this.getPack(packId)
    if (!pack) return
    for (const file of pack.assetSetFiles?.[setName] ?? []) pack.blobs.delete(file)

    const installedAssetSets = (pack.installedAssetSets ?? []).filter((s) => s !== setName)
    const dynamicAssetSets = (pack.dynamicAssetSets ?? []).filter((s) => s !== setName)
    const assetSetBytes = { ...pack.assetSetBytes }
    delete assetSetBytes[setName]
    const assetSetFiles = { ...pack.assetSetFiles }
    delete assetSetFiles[setName]

    await this.installPack({ ...pack, installedAssetSets, dynamicAssetSets, assetSetBytes, assetSetFiles })
    removeAssetSetLRU(packId, setName)
  }

  /**
   * Non-bundled packs count in full, same as always. Bundled packs count only
   * the asset sets fetched later (`dynamicAssetSets`) — the bundle baseline
   * shipped with the app and isn't "cache" in the evictable sense.
   */
  async getCacheUsage(): Promise<{ used: number; limit: number }> {
    const all = await this.getAllPacks()
    let used = 0
    for (const pack of all) {
      if (!pack.bundled) {
        used += pack.bundleSize
        continue
      }
      for (const setName of pack.dynamicAssetSets ?? []) {
        used += pack.assetSetBytes?.[setName] ?? 0
      }
    }
    return { used, limit: CACHE_LIMIT }
  }

  /**
   * Evict oldest-first until `bytesNeeded` is freed, across a unified pool of
   * whole non-bundled packs (by pack `lastUsed`) and dynamic asset sets of
   * bundled packs (by the asset-set LRU). Bundle-baseline sets and setless
   * base files are never candidates.
   *
   * Returns the evicted ids: a bare `packId` for a whole pack, or
   * `packId:setName` for an asset set.
   */
  async evictLRU(bytesNeeded: number): Promise<string[]> {
    const all = await this.getAllPacks()
    const setLru = getAssetSetLRU()

    interface Candidate {
      label: string
      bytes: number
      lastUsed: number
      evict: () => Promise<void>
    }
    const candidates: Candidate[] = []
    for (const pack of all) {
      if (!pack.bundled) {
        candidates.push({
          label: pack.packId,
          bytes: pack.bundleSize,
          lastUsed: pack.lastUsed,
          evict: () => this.deletePack(pack.packId),
        })
      } else {
        for (const setName of pack.dynamicAssetSets ?? []) {
          candidates.push({
            label: lruKey(pack.packId, setName),
            bytes: pack.assetSetBytes?.[setName] ?? 0,
            lastUsed: setLru[lruKey(pack.packId, setName)] ?? 0,
            evict: () => this.evictAssetSet(pack.packId, setName),
          })
        }
      }
    }
    candidates.sort((a, b) => a.lastUsed - b.lastUsed)

    const evicted: string[] = []
    let freed = 0
    for (const candidate of candidates) {
      if (freed >= bytesNeeded) break
      await candidate.evict()
      freed += candidate.bytes
      evicted.push(candidate.label)
    }
    return evicted
  }

  async getAllPacks(): Promise<StoredPack[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).getAll()
      req.onsuccess = () =>
        resolve(
          (req.result as Array<Record<string, unknown>>).map((r) => ({
            ...(r as unknown as StoredPack),
            blobs: new Map(Object.entries(r.blobs as Record<string, Uint8Array>)),
          })),
        )
      req.onerror = () => reject(req.error)
    })
  }
}
