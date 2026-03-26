// src/engine/assetPackDB.ts
// IndexedDB wrapper for asset pack storage with atomic install and LRU eviction

const DB_NAME = 'map-builder-packs'
const DB_VERSION = 1
const STORE_NAME = 'packs'

export interface StoredPack {
  packId: string
  version: string
  bundleSize: number
  manifest: ArrayBuffer | Buffer
  blobs: Map<string, Uint8Array>
  lastUsed: number
  bundled: boolean
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

  async getCacheUsage(): Promise<{ used: number; limit: number }> {
    const all = await this.getAllPacks()
    const used = all.filter((p) => !p.bundled).reduce((sum, p) => sum + p.bundleSize, 0)
    return { used, limit: 200 * 1024 * 1024 }
  }

  async evictLRU(bytesNeeded: number): Promise<string[]> {
    const all = await this.getAllPacks()
    const evictable = all.filter((p) => !p.bundled).sort((a, b) => a.lastUsed - b.lastUsed)
    const evicted: string[] = []
    let freed = 0
    for (const pack of evictable) {
      if (freed >= bytesNeeded) break
      await this.deletePack(pack.packId)
      freed += pack.bundleSize
      evicted.push(pack.packId)
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
