// src/engine/assetPackDB.ts
// IndexedDB wrapper for asset pack storage with atomic install and LRU eviction.
//
// Two stores: `packs` holds one small metadata record per pack (manifest and set
// bookkeeping), `files` holds each pack file's bytes under "<packId>/<file>". A boot
// reads `packs` only; file bytes are read when a texture is first used.

const DB_NAME = 'map-builder-packs'
const DB_VERSION = 2
const PACKS_STORE = 'packs'
const FILES_STORE = 'files'
const CACHE_LIMIT = 200 * 1024 * 1024

/** Everything stored about a pack except its file bytes. */
export interface StoredPackMeta {
  packId: string
  version: string
  bundleSize: number
  manifest: ArrayBuffer
  lastUsed: number
  bundled: boolean
  /**
   * Asset sets whose files are in the `files` store: a full install's sets, or
   * the ones fetched later via AssetPackManager.ensureAssetSets.
   */
  installedAssetSets?: string[]
  /** Byte size of each installed asset set's files, for cache accounting. */
  assetSetBytes?: Record<string, number>
  /**
   * Which files each installed asset set owns. Recorded at merge time so
   * eviction can drop exactly the right files without re-deriving the mapping
   * from a manifest the DB layer doesn't parse.
   */
  assetSetFiles?: Record<string, string[]>
  /**
   * Subset of `installedAssetSets` that arrived via ensureAssetSets rather
   * than with a full install. For a bundled pack only these count toward cache
   * usage.
   */
  dynamicAssetSets?: string[]
}

/** A pack as `installPack` writes it: its metadata plus every file it holds. */
export interface StoredPack extends StoredPackMeta {
  blobs: Map<string, Uint8Array>
}

const ASSET_SET_LRU_KEY = 'asset-set-lru'

function lruKey(packId: string, setName: string): string {
  return `${packId}:${setName}`
}

function fileKey(packId: string, file: string): string {
  return `${packId}/${file}`
}

/** Every `files` key of one pack. */
function packFileRange(packId: string): IDBKeyRange {
  return IDBKeyRange.bound(`${packId}/`, `${packId}/￿`)
}

/**
 * LRU timestamps for dynamically-fetched asset sets, keyed by `packId:setName`.
 * Lives in localStorage rather than on the pack record, so bumping a timestamp
 * on every use writes nothing to IndexedDB.
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

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export class AssetPackDB {
  private db: IDBDatabase | null = null
  private dbName: string

  constructor(dbName: string = DB_NAME) {
    this.dbName = dbName
  }

  async open(): Promise<void> {
    if (this.db) return
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION)
      req.onupgradeneeded = (event) => {
        const db = req.result
        if (!db.objectStoreNames.contains(PACKS_STORE)) {
          db.createObjectStore(PACKS_STORE, { keyPath: 'packId' })
        } else if (event.oldVersion < 2) {
          // v1 records carry every file inline. Nothing is migrated: clearing drops them
          // without reading a byte, and sets download again from /packs when a map needs them.
          req.transaction!.objectStore(PACKS_STORE).clear()
        }
        if (!db.objectStoreNames.contains(FILES_STORE)) db.createObjectStore(FILES_STORE)
      }
      req.onblocked = () => {
        console.warn('[AssetPackDB] Upgrade waiting for another tab to close its pack database')
      }
      req.onsuccess = () => {
        const db = req.result
        // A newer tab wants to upgrade: let go so it is not blocked by this one.
        db.onversionchange = () => {
          db.close()
          if (this.db === db) this.db = null
        }
        this.db = db
        resolve()
      }
      req.onerror = () => reject(req.error)
    })
  }

  private get conn(): IDBDatabase {
    if (!this.db) throw new Error('[AssetPackDB] database is not open')
    return this.db
  }

  /** Write a pack's metadata and files in one transaction, replacing whatever it held. */
  async installPack(pack: StoredPack): Promise<void> {
    const tx = this.conn.transaction([PACKS_STORE, FILES_STORE], 'readwrite')
    const { blobs, ...meta } = pack
    const files = tx.objectStore(FILES_STORE)
    files.delete(packFileRange(pack.packId))
    for (const [file, bytes] of blobs) files.put(bytes, fileKey(pack.packId, file))
    tx.objectStore(PACKS_STORE).put(meta)
    return done(tx)
  }

  async getPackMeta(packId: string): Promise<StoredPackMeta | null> {
    const tx = this.conn.transaction(PACKS_STORE, 'readonly')
    return ((await result(tx.objectStore(PACKS_STORE).get(packId))) as StoredPackMeta | undefined) ?? null
  }

  async getAllPackMeta(): Promise<StoredPackMeta[]> {
    const tx = this.conn.transaction(PACKS_STORE, 'readonly')
    return (await result(tx.objectStore(PACKS_STORE).getAll())) as StoredPackMeta[]
  }

  async getFile(packId: string, file: string): Promise<Uint8Array | null> {
    const tx = this.conn.transaction(FILES_STORE, 'readonly')
    return ((await result(tx.objectStore(FILES_STORE).get(fileKey(packId, file)))) as Uint8Array | undefined) ?? null
  }

  /** The files of `files` the store holds; missing ones are left out. */
  async getFiles(packId: string, files: string[]): Promise<Map<string, Uint8Array>> {
    const tx = this.conn.transaction(FILES_STORE, 'readonly')
    const store = tx.objectStore(FILES_STORE)
    const out = new Map<string, Uint8Array>()
    await Promise.all(
      files.map(async (file) => {
        const bytes = (await result(store.get(fileKey(packId, file)))) as Uint8Array | undefined
        if (bytes) out.set(file, bytes)
      }),
    )
    return out
  }

  async putFiles(packId: string, blobs: Map<string, Uint8Array>): Promise<void> {
    const tx = this.conn.transaction(FILES_STORE, 'readwrite')
    const store = tx.objectStore(FILES_STORE)
    for (const [file, bytes] of blobs) store.put(bytes, fileKey(packId, file))
    return done(tx)
  }

  async deleteFiles(packId: string, files: string[]): Promise<void> {
    const tx = this.conn.transaction(FILES_STORE, 'readwrite')
    const store = tx.objectStore(FILES_STORE)
    for (const file of files) store.delete(fileKey(packId, file))
    return done(tx)
  }

  /** Drop a pack's metadata and every file it holds. */
  async deletePack(packId: string): Promise<void> {
    const tx = this.conn.transaction([PACKS_STORE, FILES_STORE], 'readwrite')
    tx.objectStore(FILES_STORE).delete(packFileRange(packId))
    tx.objectStore(PACKS_STORE).delete(packId)
    return done(tx)
  }

  /**
   * Store the files of newly-fetched asset sets and mark those sets installed,
   * in one transaction. A no-op for a pack with no record.
   */
  async mergeAssetSetBlobs(
    packId: string,
    blobs: Map<string, Uint8Array>,
    setFiles: Record<string, string[]>,
  ): Promise<void> {
    const tx = this.conn.transaction([PACKS_STORE, FILES_STORE], 'readwrite')
    const packs = tx.objectStore(PACKS_STORE)
    const req = packs.get(packId)
    req.onsuccess = () => {
      const meta = req.result as StoredPackMeta | undefined
      if (!meta) return
      const files = tx.objectStore(FILES_STORE)
      for (const [file, bytes] of blobs) files.put(bytes, fileKey(packId, file))

      const installedAssetSets = new Set(meta.installedAssetSets ?? [])
      const dynamicAssetSets = new Set(meta.dynamicAssetSets ?? [])
      const assetSetBytes = { ...meta.assetSetBytes }
      const assetSetFiles = { ...meta.assetSetFiles }
      for (const [setName, names] of Object.entries(setFiles)) {
        installedAssetSets.add(setName)
        dynamicAssetSets.add(setName)
        assetSetBytes[setName] = names.reduce((s, f) => s + (blobs.get(f)?.length ?? 0), 0)
        assetSetFiles[setName] = names
      }
      packs.put({
        ...meta,
        installedAssetSets: [...installedAssetSets],
        dynamicAssetSets: [...dynamicAssetSets],
        assetSetBytes,
        assetSetFiles,
      })
    }
    return done(tx)
  }

  /** Drop one asset set's files from a pack, its bookkeeping and its LRU entry. */
  private async evictAssetSet(packId: string, setName: string): Promise<void> {
    const tx = this.conn.transaction([PACKS_STORE, FILES_STORE], 'readwrite')
    const packs = tx.objectStore(PACKS_STORE)
    const req = packs.get(packId)
    req.onsuccess = () => {
      const meta = req.result as StoredPackMeta | undefined
      if (!meta) return
      const files = tx.objectStore(FILES_STORE)
      for (const file of meta.assetSetFiles?.[setName] ?? []) files.delete(fileKey(packId, file))
      const assetSetBytes = { ...meta.assetSetBytes }
      delete assetSetBytes[setName]
      const assetSetFiles = { ...meta.assetSetFiles }
      delete assetSetFiles[setName]
      packs.put({
        ...meta,
        installedAssetSets: (meta.installedAssetSets ?? []).filter((s) => s !== setName),
        dynamicAssetSets: (meta.dynamicAssetSets ?? []).filter((s) => s !== setName),
        assetSetBytes,
        assetSetFiles,
      })
    }
    await done(tx)
    removeAssetSetLRU(packId, setName)
  }

  /**
   * Non-bundled packs count in full. Bundled packs count only the asset sets
   * fetched after install (`dynamicAssetSets`).
   */
  async getCacheUsage(): Promise<{ used: number; limit: number }> {
    const all = await this.getAllPackMeta()
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
   * Evict oldest-first until `bytesNeeded` is freed, across whole non-bundled
   * packs (by pack `lastUsed`) and their dynamic asset sets (by the asset-set
   * LRU). Bundled packs are never candidates: their sets ship with the app.
   * Nor is `keepPackId`, the pack about to be written to.
   *
   * Returns the evicted ids: a bare `packId` for a whole pack, or
   * `packId:setName` for an asset set.
   */
  async evictLRU(bytesNeeded: number, keepPackId?: string): Promise<string[]> {
    const all = await this.getAllPackMeta()
    const setLru = getAssetSetLRU()

    interface Candidate {
      label: string
      bytes: number
      lastUsed: number
      evict: () => Promise<void>
    }
    const candidates: Candidate[] = []
    for (const pack of all) {
      if (pack.bundled || pack.packId === keepPackId) continue
      const dynamic = pack.dynamicAssetSets ?? []
      for (const setName of dynamic) {
        candidates.push({
          label: lruKey(pack.packId, setName),
          bytes: pack.assetSetBytes?.[setName] ?? 0,
          lastUsed: setLru[lruKey(pack.packId, setName)] ?? 0,
          evict: () => this.evictAssetSet(pack.packId, setName),
        })
      }
      if (dynamic.length === 0) {
        candidates.push({
          label: pack.packId,
          bytes: pack.bundleSize,
          lastUsed: pack.lastUsed,
          evict: () => this.deletePack(pack.packId),
        })
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
}
