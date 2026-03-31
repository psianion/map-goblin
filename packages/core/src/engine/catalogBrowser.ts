// src/engine/catalogBrowser.ts
// SYNC: these types align with map-assets canonical catalog schema — update when upstream changes
// Chunk-based catalog browser with structured inverted index filtering

export interface InvertedIndex {
  type: Record<string, number[]>
  theme: Record<string, number[]>
  material: Record<string, number[]>
}

export interface CatalogMeta {
  version: number
  totalEntries: number
  chunkCount: number
  chunks: ChunkInfo[]
  invertedIndex: InvertedIndex
}

export interface ChunkInfo {
  index: number
  url: string
  entryCount: number
}

export interface CatalogEntry {
  entryId: string
  packId: string
  localId: string
  type: string
  theme: string
  material: string
  gridSize: string
  tags: string[]
  tint: string
  thumbnailUrl: string
  pHash?: string
}

export interface CatalogSearchOptions {
  type?: string
  theme?: string
  material?: string
  query?: string
}

export class CatalogBrowser {
  private cdnBaseUrl: string
  private meta: CatalogMeta | null = null
  private loadedChunks: Map<number, CatalogEntry[]> = new Map()
  private fetchFn: typeof fetch

  constructor(cdnBaseUrl: string, fetchFn: typeof fetch = globalThis.fetch) {
    this.cdnBaseUrl = cdnBaseUrl
    this.fetchFn = fetchFn
  }

  async loadMeta(): Promise<CatalogMeta> {
    if (this.meta) return this.meta
    const response = await this.fetchFn(`${this.cdnBaseUrl}/meta.json`)
    this.meta = (await response.json()) as CatalogMeta
    return this.meta
  }

  getMeta(): CatalogMeta | null {
    return this.meta
  }

  async loadChunk(chunkIndex: number): Promise<CatalogEntry[]> {
    const cached = this.loadedChunks.get(chunkIndex)
    if (cached) return cached

    const meta = await this.loadMeta()
    const chunk = meta.chunks[chunkIndex]
    if (!chunk) return []

    const response = await this.fetchFn(`${this.cdnBaseUrl}/${chunk.url}`)
    const entries = (await response.json()) as CatalogEntry[]
    this.loadedChunks.set(chunkIndex, entries)
    return entries
  }

  async search(options: CatalogSearchOptions): Promise<CatalogEntry[]> {
    const meta = await this.loadMeta()

    // Use inverted index to determine which chunks to load
    const relevantChunkIndices = this.resolveChunkIndices(meta, options)

    // Load only relevant chunks
    const chunkPromises = relevantChunkIndices.map((i) => this.loadChunk(i))
    const chunks = await Promise.all(chunkPromises)
    const allEntries = chunks.flat()

    // Filter within loaded entries
    return allEntries.filter((entry) => {
      if (options.type && entry.type !== options.type) return false
      if (options.theme && entry.theme !== options.theme) return false
      if (options.material && entry.material !== options.material) return false
      if (options.query) {
        const q = options.query.toLowerCase()
        const matchesId = entry.localId.toLowerCase().includes(q)
        const matchesTags = entry.tags.some((t) => t.toLowerCase().includes(q))
        if (!matchesId && !matchesTags) return false
      }
      return true
    })
  }

  findSimilar(targetPHash: string, maxDistance: number = 8): CatalogEntry[] {
    const results: Array<{ entry: CatalogEntry; distance: number }> = []

    for (const entries of this.loadedChunks.values()) {
      for (const entry of entries) {
        if (!entry.pHash) continue
        const distance = hammingDistance(targetPHash, entry.pHash)
        if (distance <= maxDistance) {
          results.push({ entry, distance })
        }
      }
    }

    return results.sort((a, b) => a.distance - b.distance).map((r) => r.entry)
  }

  private resolveChunkIndices(meta: CatalogMeta, options: CatalogSearchOptions): number[] {
    const sets: Set<number>[] = []
    const idx = meta.invertedIndex

    if (options.type && idx.type[options.type]) {
      sets.push(new Set(idx.type[options.type]))
    }
    if (options.theme && idx.theme[options.theme]) {
      sets.push(new Set(idx.theme[options.theme]))
    }
    if (options.material && idx.material[options.material]) {
      sets.push(new Set(idx.material[options.material]))
    }

    // Intersect all sets; if none specified, return all chunks
    if (sets.length === 0) {
      return meta.chunks.map((c) => c.index)
    }

    let result = sets[0]!
    for (let i = 1; i < sets.length; i++) {
      result = new Set([...result].filter((x) => sets[i]!.has(x)))
    }
    return [...result]
  }
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Infinity
  let distance = 0
  for (let i = 0; i < a.length; i++) {
    const ca = parseInt(a[i]!, 16)
    const cb = parseInt(b[i]!, 16)
    // Count differing bits in each hex digit
    let xor = ca ^ cb
    while (xor) {
      distance += xor & 1
      xor >>= 1
    }
  }
  return distance
}
