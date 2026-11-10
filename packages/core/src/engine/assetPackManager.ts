// src/engine/assetPackManager.ts
import type { Texture } from 'pixi.js'
import pLimit from 'p-limit'
import type { AssetPackDB, StoredPackMeta } from './assetPackDB'
import { bumpAssetSetLRU } from './assetPackDB'
import { collectMapTextureIds, resolveAssetSets, type MapTextureSource } from './mapTextureRefs'
import type { FileRef, ManifestEntry, PackManifest } from './packManifest'

export interface PackSummary {
  packId: string
  version: string
  entryCount: number
  themes: string[]
  bundleSize: number
  /** Shipped with the app (first-boot install), as opposed to a CDN install or a pack file. */
  bundled: boolean
  /** When this copy was written (the stored record's `lastUsed`, which nothing bumps later). */
  installedAt: number
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

export type { FileRef, EntryRect, ManifestEntry, PackManifest } from './packManifest'

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

/**
 * What the pack downloads are doing. `map` is the sets an open map needs, `library` the
 * background fetch of everything else. Totals come from manifest file sizes, so they are
 * known before the first byte arrives.
 */
export interface AssetProgress {
  phase: 'idle' | 'map' | 'library'
  packId?: string
  filesDone: number
  filesTotal: number
  bytesDone: number
  bytesTotal: number
}

/** One download run reporting into the manager's progress (see `beginProgress`). */
export interface ProgressJob {
  /** This run's own numbers. */
  readonly progress: AssetProgress
  addTotal(files: number, bytes: number): void
  advance(files: number, bytes: number): void
  setPack(packId: string | undefined): void
  end(): void
}

/**
 * One asset set of a pack, sized per the manifest. Installed when every one of its files
 * is stored; a map may have stored some of them already (`missing*` is what is left).
 */
export interface AssetSetStatus {
  set: string
  installed: boolean
  files: number
  bytes: number
  missingFiles: number
  missingBytes: number
}

/** Files stored per IndexedDB transaction while downloading. */
const WRITE_BATCH = 16

const IDLE: AssetProgress = { phase: 'idle', filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 }

export class AssetPackManager {
  private config: PackManagerConfig
  private installedPacks: Map<string, PackSummary> = new Map()
  private textureCache: Map<string, Texture> = new Map()
  /** Pending `waitForTexture` resolvers, keyed by pack entry id. */
  private textureWaiters: Map<string, Array<(t: Texture) => void>> = new Map()
  private frameCache: Map<string, FrameData> = new Map()
  // Shared cap for CDN downloads and texture decode/upload; 8 matches what browsers
  // keep in flight per host anyway.
  private downloadLimit = pLimit(8)
  /** Decodes and uploads, apart from downloads so neither waits on the other. */
  private decodeLimit = pLimit(4)
  private installTimestamps: number[] = [] // hourly cap tracking
  private packDB: AssetPackDB | undefined
  private cachedIndex: PackIndex | null = null
  private manifestCache: Map<string, PackManifest> = new Map()

  /** File bytes held in memory, keyed "<packId>/<file>". Only used without a packDB. */
  private files: Map<string, Uint8Array> = new Map()
  /** One object URL per decoded image file, keyed "<packId>/<file>"; revoked when the file goes. */
  private blobUrls: Map<string, string> = new Map()
  /** In-flight or finished decodes, keyed "<packId>/<file>". */
  private decoding: Map<string, Promise<void>> = new Map()
  /** Decodes that found no bytes or failed; retried once the file is written again. */
  private failedDecodes: Set<string> = new Set()
  /** Entry ids asked for while their file was not stored yet; decoded when it lands. */
  private pendingRequests: Set<string> = new Set()
  /** In-flight file downloads, keyed "<packId>/<file>". */
  private fetching: Map<string, Promise<void>> = new Map()
  /** Files a texture request already fetched on first use, keyed "<packId>/<file>". */
  private askedFiles: Set<string> = new Set()
  /** Downloaded files waiting for the next batched write (see queueWrite). */
  private writeQueue: Array<{ packId: string; file: string; bytes: Uint8Array; resolve: () => void; reject: (err: unknown) => void }> = []
  private writeScheduled = false
  /** Just-downloaded bytes a queued decode is about to use; dropped once it reads them. */
  private landed: Map<string, Uint8Array> = new Map()
  /**
   * Files stored locally, per pack: the sync mirror of the `files` store's keys, read at
   * rehydrate without the bytes. The truth for "is this set installed": all its files are.
   */
  private presentFiles: Map<string, Set<string>> = new Map()
  /** entry id → file holding its art, built once per manifest object. */
  private fileIndexCache: WeakMap<PackManifest, Map<string, string>> = new WeakMap()

  private textureSubs: Set<() => void> = new Set()
  private textureNotifyScheduled = false
  private progressSubs: Set<(p: AssetProgress) => void> = new Set()
  private progressJobs: AssetProgress[] = []
  private progressSnapshot: AssetProgress = IDLE

  /**
   * Bumped whenever the set of installed packs or their manifests changes.
   * packCatalog memoizes its derived views against this.
   */
  catalogVersion = 0

  /** Bumped once per decoded file. See `subscribeTextures`. */
  textureVersion = 0

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

  /**
   * Resolve the manifest *filename* for a pack from the index.
   *
   * The index stores paths relative to the CDN root ("dungeon-classic/pack-<hash>.json")
   * so that one file describes where everything lives. Both callers build their URL as
   * `${cdnBaseUrl}/${packId}/${here}`, so the pack directory has to come off or the
   * fetch goes to /packs/dungeon-classic/dungeon-classic/pack-<hash>.json and 404s.
   */
  private async resolveManifestPath(packId: string): Promise<string> {
    try {
      const index = await this.fetchIndex()
      const entry = index.packs[packId]
      if (entry?.manifest) {
        const prefix = `${packId}/`
        return entry.manifest.startsWith(prefix)
          ? entry.manifest.slice(prefix.length)
          : entry.manifest
      }
    } catch (err) {
      // Index unavailable — fall through to the default name. Worth saying so:
      // a pack whose manifest is content-hashed has no `pack.json` to fall back
      // onto, so the install that follows will 404 for a reason decided here.
      console.warn(
        `[AssetPackManager] Pack index unavailable for "${packId}" — trying pack.json.`,
        err,
      )
    }
    return 'pack.json'
  }

  getInstalledPacks(): PackSummary[] {
    return Array.from(this.installedPacks.values())
  }

  /**
   * Ids of installed packs that came from the bundled first-boot install (as
   * opposed to a CDN install). firstBootInstall uses this to retire bundled
   * packs a newer build no longer ships.
   */
  async bundledInstalledIds(): Promise<string[]> {
    if (!this.packDB) return []
    return [...this.installedPacks.values()].filter((p) => p.bundled).map((p) => p.packId)
  }

  /**
   * Returns the cached texture for entryId, or `fallback` (the caller's missing-texture
   * indicator; the manager loads no Pixi of its own until it decodes), and asks for the
   * texture to be decoded. Never returns null — safe for use in the render loop.
   */
  getTexture(entryId: string, fallback: () => Texture): Texture {
    const cached = this.textureCache.get(entryId)
    if (cached) return cached
    this.requestTexture(entryId)
    return fallback()
  }

  /**
   * Returns the cached texture if available, or null, and asks for it to be decoded.
   * Use when you need to check existence without triggering fallback creation.
   */
  getTextureOrNull(entryId: string): Texture | null {
    const cached = this.textureCache.get(entryId)
    if (cached) return cached
    this.requestTexture(entryId)
    return null
  }

  /**
   * Start decoding the file that holds `entryId` when that file is stored locally. When
   * it is not stored yet, the request is kept and served once the file lands, and the
   * file is fetched now rather than left for the library: art a map starts using after it
   * opened (a wall set picked in the dock, a plateau's cliff) must not wait on the
   * background download. A no-op for an id no installed manifest knows.
   */
  requestTexture(entryId: string): void {
    if (this.textureCache.has(entryId)) return
    const sep = entryId.indexOf(':')
    if (sep <= 0) return
    const packId = entryId.slice(0, sep)
    const localId = entryId.slice(sep + 1)
    const manifest = this.manifestCache.get(packId)
    const entry = manifest?.entries[localId]
    if (!manifest || !entry) return
    const file = this.fileIndex(manifest).get(localId)
    if (!file) return
    if (!this.isStored(packId, manifest, entry)) {
      this.pendingRequests.add(entryId)
      this.fetchOnDemand(packId, entryFiles(manifest, entry))
      return
    }
    void this.decodeFile(packId, file)
  }

  /**
   * Fetch files a texture request is waiting on, each at most once a session: a failed
   * fetch is left to the library or the next map open, not retried on every rebuild.
   */
  private fetchOnDemand(packId: string, files: string[]): void {
    const fresh = files.filter((f) => !this.askedFiles.has(fileKey(packId, f)))
    if (fresh.length === 0) return
    for (const f of fresh) this.askedFiles.add(fileKey(packId, f))
    this.ensureFiles(packId, fresh).catch((err) => {
      console.warn(`[AssetPackManager] Could not fetch art for pack "${packId}" on first use:`, err)
    })
  }

  /**
   * Resolves when `entryId` lands in the texture cache, or with null after `timeoutMs`.
   * Asks for the decode, so waiting is enough to get a stored texture drawn.
   */
  waitForTexture(entryId: string, timeoutMs = 30_000): Promise<Texture | null> {
    const now = this.textureCache.get(entryId)
    if (now) return Promise.resolve(now)
    const waiting = new Promise<Texture | null>((resolve) => {
      const waiters = this.textureWaiters.get(entryId) ?? []
      this.textureWaiters.set(entryId, waiters)
      const timer = setTimeout(() => {
        const arr = this.textureWaiters.get(entryId)
        if (arr) {
          const i = arr.indexOf(entry)
          if (i !== -1) arr.splice(i, 1)
          if (arr.length === 0) this.textureWaiters.delete(entryId)
        }
        resolve(null)
      }, timeoutMs)
      const entry = (t: Texture) => {
        clearTimeout(timer)
        resolve(t)
      }
      waiters.push(entry)
    })
    this.requestTexture(entryId)
    return waiting
  }

  /**
   * Call `cb` after textures were decoded: at most once per animation frame however many
   * files landed. Renderers that drew a fallback re-resolve on it. Returns the unsubscribe.
   */
  subscribeTextures(cb: () => void): () => void {
    this.textureSubs.add(cb)
    return () => {
      this.textureSubs.delete(cb)
    }
  }

  /** Call `cb` whenever the download progress changes; `getProgress` reads it. Returns the unsubscribe. */
  subscribeProgress(cb: (p: AssetProgress) => void): () => void {
    this.progressSubs.add(cb)
    return () => {
      this.progressSubs.delete(cb)
    }
  }

  /**
   * The current download progress: the latest running `map` run, else the latest
   * `library` run, else idle. The same object until it changes.
   */
  getProgress(): AssetProgress {
    return this.progressSnapshot
  }

  /** Start a download run that reports into `getProgress` until `end()`. */
  beginProgress(phase: 'map' | 'library', packId?: string): ProgressJob {
    const state: AssetProgress = { phase, packId, filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 }
    this.progressJobs.push(state)
    this.emitProgress()
    let ended = false
    return {
      get progress() {
        return { ...state }
      },
      addTotal: (files, bytes) => {
        state.filesTotal += files
        state.bytesTotal += bytes
        this.emitProgress()
      },
      advance: (files, bytes) => {
        state.filesDone += files
        state.bytesDone += bytes
        this.emitProgress()
      },
      setPack: (id) => {
        state.packId = id
        this.emitProgress()
      },
      end: () => {
        if (ended) return
        ended = true
        this.progressJobs = this.progressJobs.filter((j) => j !== state)
        this.emitProgress()
      },
    }
  }

  private emitProgress(): void {
    const jobs = this.progressJobs
    const pick = [...jobs].reverse().find((j) => j.phase === 'map') ?? jobs[jobs.length - 1]
    this.progressSnapshot = pick ? { ...pick } : IDLE
    for (const cb of [...this.progressSubs]) {
      try {
        cb(this.progressSnapshot)
      } catch (err) {
        console.warn('[AssetPackManager] progress listener failed:', err)
      }
    }
  }

  /** Wake every waiter whose texture is now in the cache. */
  private flushTextureWaiters(): void {
    for (const [entryId, waiters] of [...this.textureWaiters]) {
      const tex = this.textureCache.get(entryId)
      if (!tex) continue
      this.textureWaiters.delete(entryId)
      for (const w of waiters) w(tex)
    }
  }

  private scheduleTextureNotify(): void {
    if (this.textureNotifyScheduled) return
    this.textureNotifyScheduled = true
    const run = () => {
      this.textureNotifyScheduled = false
      for (const cb of [...this.textureSubs]) {
        try {
          cb()
        } catch (err) {
          console.warn('[AssetPackManager] texture listener failed:', err)
        }
      }
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
    else setTimeout(run, 16)
  }

  getFrame(entryId: string): FrameData | null {
    return this.frameCache.get(entryId) ?? null
  }

  /** Every entry id a pack's manifest declares, pack-scoped. */
  getEntryIds(packId: string): string[] {
    return Object.keys(this.manifestCache.get(packId)?.entries ?? {}).map((id) => `${packId}:${id}`)
  }

  /** Every asset set a pack declares, smallest first, with how much of it is stored. */
  getAssetSetStatus(packId: string): AssetSetStatus[] {
    const manifest = this.manifestCache.get(packId)
    if (!manifest) return []
    const refs = { ...manifest.atlases, ...manifest.files }
    return allSetNames(manifest)
      .map((set) => {
        const files = [...filesForSet(manifest, set)]
        const missing = this.missingOf(packId, files)
        return {
          set,
          installed: files.length > 0 && missing.length === 0,
          files: files.length,
          bytes: files.reduce((s, f) => s + (refs[f]?.size ?? 0), 0),
          missingFiles: missing.length,
          missingBytes: missing.reduce((s, f) => s + (refs[f]?.size ?? 0), 0),
        }
      })
      .sort((a, b) => a.bytes - b.bytes || a.set.localeCompare(b.set))
  }

  /**
   * The files that hold the art of texture ids, grouped by pack: a loose entry's file, an
   * atlas entry's json and image. Bare ids resolve to the first pack declaring them; ids no
   * manifest knows are skipped.
   */
  filesForTextureIds(ids: string[]): Map<string, string[]> {
    const out = new Map<string, Set<string>>()
    for (const raw of ids) {
      const sep = raw.indexOf(':')
      let packId: string
      let entryId: string
      if (sep === -1) {
        const owner = [...this.manifestCache].find(([, m]) => m.entries[raw])
        if (!owner) continue
        packId = owner[0]
        entryId = raw
      } else {
        packId = raw.slice(0, sep)
        entryId = raw.slice(sep + 1)
      }
      const manifest = this.manifestCache.get(packId)
      const entry = manifest?.entries[entryId]
      if (!manifest || !entry) continue
      const files = out.get(packId) ?? new Set<string>()
      out.set(packId, files)
      for (const f of entryFiles(manifest, entry)) files.add(f)
    }
    return new Map([...out].map(([p, f]) => [p, [...f]]))
  }

  /** File count and manifest bytes of the files of `files` not stored yet. */
  missingFileTotals(packId: string, files: string[]): { files: number; bytes: number } {
    const manifest = this.manifestCache.get(packId)
    const refs = manifest ? { ...manifest.atlases, ...manifest.files } : {}
    const missing = this.missingOf(packId, files)
    return { files: missing.length, bytes: missing.reduce((s, f) => s + (refs[f]?.size ?? 0), 0) }
  }

  private missingOf(packId: string, files: string[]): string[] {
    const present = this.presentFiles.get(packId)
    return files.filter((f) => !present?.has(f) && !this.files.has(fileKey(packId, f)))
  }

  private markPresent(packId: string, files: Iterable<string>): void {
    const present = this.presentFiles.get(packId) ?? new Set<string>()
    for (const f of files) present.add(f)
    this.presentFiles.set(packId, present)
  }

  /** The updates the index offers; see `checkForUpdatesReport` for whether it answered. */
  async checkForUpdates(): Promise<PackUpdateInfo[]> {
    return (await this.checkForUpdatesReport()).updates
  }

  /**
   * Ask the pack index for updates, and say whether it answered. When it cannot be reached
   * or answers an error, the updates are the last ones known (as for a 304), so a pending
   * update is not wiped and "unreachable" is not mistaken for "up to date".
   */
  async checkForUpdatesReport(): Promise<{ status: 'ok' | 'unreachable'; updates: PackUpdateInfo[] }> {
    const lastKnown = () => ({ status: 'unreachable' as const, updates: this.cachedIndex ? this.updatesFrom(this.cachedIndex) : [] })
    try {
      // A 304 only says "the index you have is current", so it is only worth asking for
      // with that index in hand. The ETag outlives the page (localStorage) and the index
      // does not: the first check after a reload asks for the whole index.
      const etag = this.cachedIndex ? localStorage.getItem('index-etag') : null
      const headers: Record<string, string> = {}
      if (etag) headers['If-None-Match'] = etag

      const res = await fetch(`${this.config.cdnBaseUrl}/index.json`, {
        signal: AbortSignal.timeout(3_000),
        headers,
      })

      // Not modified: the updates are what the index already held. Answering [] here
      // wiped a pending update off the list on every check after the first.
      if (res.status === 304) return { status: 'ok', updates: this.cachedIndex ? this.updatesFrom(this.cachedIndex) : [] }
      if (!res.ok) {
        // Swallowing this cost a gate walk: a bad status on the pack index was
        // indistinguishable from "you are up to date", so a broken index could
        // sit in a deployed build with nothing anywhere saying so.
        console.warn(
          `[AssetPackManager] Pack index ${this.config.cdnBaseUrl}/index.json returned ${res.status} — skipping the update check.`,
        )
        return lastKnown()
      }

      const newEtag = res.headers.get('etag')
      if (newEtag) localStorage.setItem('index-etag', newEtag)

      const index = (await res.json()) as PackIndex
      if (!index?.packs || typeof index.packs !== 'object') return lastKnown()
      this.cachedIndex = index
      return { status: 'ok', updates: this.updatesFrom(index) }
    } catch (err) {
      // CDN unreachable — still never blocks the app, but no longer in silence.
      console.warn(
        `[AssetPackManager] Pack index ${this.config.cdnBaseUrl}/index.json unreachable — skipping the update check.`,
        err,
      )
      return lastKnown()
    }
  }

  /** Installed packs the index has a newer version of, against what is installed now. */
  private updatesFrom(index: PackIndex): PackUpdateInfo[] {
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
      if ((await sha256Hex(blobs.get(file)!)) !== ref.checksum.replace('sha256:', '')) {
        throw new Error(`Checksum mismatch for ${file}`)
      }
    }

    // 4. Check cache capacity, evict if needed
    const packSize = [...blobs.values()].reduce((s, b) => s + b.length, 0)
    if (this.packDB) {
      const usage = await this.getCacheUsage()
      if (usage.used + packSize > usage.limit) {
        const evicted = await this.packDB.evictLRU(packSize - (usage.limit - usage.used), packId)
        // Amendment B3: also clear in-memory textures for evicted packs/asset sets
        this.clearEvicted(evicted)
      }
    }

    // 5. Store and register. Every file downloaded above, so every set is installed.
    onProgress?.(85)
    this.clearPackTextures(packId)
    await this.storePack(packId, manifest, blobs, false, packSize)
    onProgress?.(100)
  }

  /**
   * Register a pre-downloaded pack directly: a pack file the DM installs (not bundled).
   * Skips fetch + checksum verification — caller is responsible for trusted data.
   * Decodes nothing: textures decode on first use.
   */
  async registerPack(
    packId: string,
    manifest: PackManifest,
    blobs: Map<string, Uint8Array>,
    bundled: boolean = false,
  ): Promise<void> {
    const packSize = [...blobs.values()].reduce((s, b) => s + b.length, 0)
    this.clearPackTextures(packId)
    await this.storePack(packId, manifest, blobs, bundled, packSize)
  }

  /**
   * Register a pack from its manifest alone, with no file stored: the bundled packs at
   * boot. Its sets download on demand (ensureAssetSets). Does not bump catalogVersion;
   * the caller does, once for every pack it registers.
   */
  async registerManifest(packId: string, manifest: PackManifest): Promise<void> {
    const size = manifestBytes(manifest)
    this.clearPackTextures(packId)
    if (this.packDB) {
      await this.packDB.installPack({
        packId,
        version: manifest.version,
        bundleSize: size,
        manifest: encodeManifest(manifest),
        blobs: new Map(),
        lastUsed: Date.now(),
        bundled: true,
        installedAssetSets: [],
      })
    }
    this.manifestCache.set(packId, manifest)
    this.presentFiles.set(packId, new Set())
    this.installedPacks.set(packId, {
      packId,
      version: manifest.version,
      entryCount: Object.keys(manifest.entries).length,
      themes: manifest.theme ?? [],
      bundleSize: size,
      bundled: true,
      installedAt: Date.now(),
    })
  }

  /** Write a fully-downloaded pack, mark every set installed and serve waiting requests. */
  private async storePack(
    packId: string,
    manifest: PackManifest,
    blobs: Map<string, Uint8Array>,
    bundled: boolean,
    packSize: number,
  ): Promise<void> {
    const setNames = allSetNames(manifest)
    if (this.packDB) {
      await this.packDB.installPack({
        packId,
        version: manifest.version,
        bundleSize: packSize,
        manifest: encodeManifest(manifest),
        blobs,
        lastUsed: Date.now(),
        bundled,
        installedAssetSets: setNames.length ? setNames : undefined,
      })
    } else {
      for (const [file, bytes] of blobs) this.files.set(fileKey(packId, file), bytes)
    }

    this.manifestCache.set(packId, manifest)
    this.presentFiles.set(packId, new Set(blobs.keys()))
    this.installedPacks.set(packId, {
      packId,
      version: manifest.version,
      entryCount: Object.keys(manifest.entries).length,
      themes: manifest.theme ?? [],
      bundleSize: packSize,
      bundled,
      installedAt: Date.now(),
    })
    this.catalogVersion++
    this.servePending(packId)
  }

  /**
   * Decode one pack file into textures: a loose file registers its entry, an atlas (json
   * plus image) every frame it holds. Memoised per file and capped by `decodeLimit`.
   * Resolves without decoding when the file is not stored.
   */
  decodeFile(packId: string, file: string): Promise<void> {
    const key = fileKey(packId, file)
    const known = this.decoding.get(key)
    if (known) return known
    const run = this.decodeLimit(() => this.decodeNow(packId, file)).then(
      (ok) => {
        if (!ok) this.failedDecodes.add(key)
      },
      (err: unknown) => {
        this.failedDecodes.add(key)
        console.warn(`[AssetPackManager] Failed to decode "${file}" for pack "${packId}":`, err)
      },
    )
    this.decoding.set(key, run)
    return run
  }

  /**
   * Uses manual Spritesheet creation instead of Assets.load() for atlases because
   * blob URLs lack file extensions for PixiJS parser detection.
   */
  private async decodeNow(packId: string, file: string): Promise<boolean> {
    const manifest = this.manifestCache.get(packId)
    if (!manifest) return false
    const PIXI = await loadPixi()

    if (manifest.atlases[file] && file.endsWith('.json')) {
      const jsonBytes = await this.readFile(packId, file)
      if (!jsonBytes) return false
      const json = JSON.parse(new TextDecoder().decode(jsonBytes))
      const imageFile = json.meta?.image as string | undefined
      if (!imageFile) return false
      const imageBytes = await this.readFile(packId, imageFile)
      if (!imageBytes) return false
      const baseTexture = await PIXI.Assets.load<Texture>({
        src: this.blobUrlFor(packId, imageFile, imageBytes),
        parser: 'loadTextures',
      })
      const spritesheet = new PIXI.Spritesheet(baseTexture, json)
      await spritesheet.parse()
      for (const [frameId, texture] of Object.entries(spritesheet.textures as Record<string, Texture>)) {
        this.textureCache.set(`${packId}:${frameId}`, texture)
      }
    } else if (manifest.files[file]) {
      const bytes = await this.readFile(packId, file)
      if (!bytes) return false
      const texture = await PIXI.Assets.load<Texture>({
        src: this.blobUrlFor(packId, file, bytes),
        parser: 'loadTextures',
      })
      // Registered under the entry KEY, which is what manifestBridge/resolveTexture look up.
      for (const [entryId, entryFile] of this.fileIndex(manifest)) {
        if (entryFile === file) this.textureCache.set(`${packId}:${entryId}`, texture)
      }
    } else {
      return false
    }

    this.textureVersion++
    this.flushTextureWaiters()
    this.scheduleTextureNotify()
    return true
  }

  private async readFile(packId: string, file: string): Promise<Uint8Array | null> {
    const key = fileKey(packId, file)
    const landed = this.landed.get(key)
    if (landed) {
      this.landed.delete(key)
      return landed
    }
    const inMemory = this.files.get(key)
    if (inMemory) return inMemory
    return this.packDB ? this.packDB.getFile(packId, file) : null
  }

  private blobUrlFor(packId: string, file: string, bytes: Uint8Array): string {
    const key = fileKey(packId, file)
    let url = this.blobUrls.get(key)
    if (!url) {
      url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/webp' }))
      this.blobUrls.set(key, url)
    }
    return url
  }

  /**
   * entry id → the file that holds its art. Atlas entries: the atlas's json. Loose
   * entries: the file whose name, less its `-<hash>.<ext>` suffix, is the entry's
   * `material_gridSize_variant`.
   */
  private fileIndex(manifest: PackManifest): Map<string, string> {
    const cached = this.fileIndexCache.get(manifest)
    if (cached) return cached
    const byStem = looseFiles(manifest)
    const index = new Map<string, string>()
    for (const [entryId, entry] of Object.entries(manifest.entries)) {
      if (entry.atlas) {
        index.set(entryId, atlasJsonOf(manifest, entry.atlas))
        continue
      }
      const file = byStem.get(loosePrefixFor(entry).slice(0, -1))
      if (file) index.set(entryId, file)
    }
    this.fileIndexCache.set(manifest, index)
    return index
  }

  /** Whether every file `entry` needs (an atlas: json and image) is stored, so a decode can start now. */
  private isStored(packId: string, manifest: PackManifest, entry: ManifestEntry): boolean {
    return this.missingOf(packId, entryFiles(manifest, entry)).length === 0
  }

  /** Files of `packId` were (re)written: retry their failed decodes and serve waiting requests. */
  private servePending(packId: string, files?: Iterable<string>): void {
    if (files) {
      for (const file of files) {
        const key = fileKey(packId, file)
        if (this.failedDecodes.delete(key)) this.decoding.delete(key)
      }
    }
    const prefix = `${packId}:`
    for (const entryId of [...this.pendingRequests]) {
      if (!entryId.startsWith(prefix)) continue
      this.pendingRequests.delete(entryId)
      this.requestTexture(entryId)
    }
  }

  /**
   * Phase 7: Differential pack update — only download files with changed checksums.
   * Falls back to full reinstall if the old manifest can't be read from IndexedDB.
   *
   * Set-aware: a file that belongs exclusively to an asset set not installed
   * locally (never fetched, or since evicted) is skipped entirely — an update
   * never re-adds content the cache doesn't have a reason to hold. Set
   * membership is read off the NEW manifest; files shared by installed
   * content (setless/base) always update.
   */
  async updatePack(packId: string): Promise<PackDiffResult> {
    // 1. Fetch new manifest — resolve content-hashed filename from index
    const manifestFilename = await this.resolveManifestPath(packId)
    const manifestUrl = `${this.config.cdnBaseUrl}/${packId}/${manifestFilename}`
    const manifestRes = await fetch(manifestUrl, { signal: AbortSignal.timeout(10_000) })
    if (!manifestRes.ok) throw new Error(`Failed to fetch manifest: ${manifestRes.status}`)
    const newManifest = (await manifestRes.json()) as PackManifest

    // 2. Load the stored record — old manifest for diffing, and which asset sets
    // are actually installed locally.
    let stored: StoredPackMeta | null = null
    let oldChecksums: Map<string, string> | null = null
    if (this.packDB) {
      stored = await this.packDB.getPackMeta(packId)
      if (stored) {
        try {
          const oldManifest = decodeManifest(stored.manifest)
          oldChecksums = new Map<string, string>()
          for (const [file, ref] of Object.entries({ ...oldManifest.atlases, ...oldManifest.files })) {
            oldChecksums.set(file, ref.checksum)
          }
        } catch {
          // Can't read old manifest — will do full download
        }
      }
    }

    // 3. Which files does this pack actually need? Setless entries always do;
    // set-tagged entries only if their set is installed locally. No prior
    // bookkeeping (legacy record, or first update after this feature shipped)
    // means "assume everything was installed" — the full-pack behavior
    // updatePack always had.
    const installedSets = new Set(stored?.installedAssetSets ?? allSetNames(newManifest))
    const keepFiles = neededFiles(newManifest, installedSets)

    // 4. Diff: find changed files, scoped to what's actually needed
    const newRefs = { ...newManifest.atlases, ...newManifest.files }
    const allKeptFiles = Object.keys(newRefs).filter((file) => keepFiles.has(file))
    let changedFiles: string[]
    let unchangedCount = 0

    if (oldChecksums) {
      changedFiles = allKeptFiles.filter((file) => {
        const oldChecksum = oldChecksums!.get(file)
        const newChecksum = newRefs[file]?.checksum
        if (oldChecksum && oldChecksum === newChecksum) {
          unchangedCount++
          return false
        }
        return true
      })
    } else {
      changedFiles = allKeptFiles
    }

    // 5. Download only changed files
    const blobs = new Map<string, Uint8Array>()

    // Reuse unchanged files from storage
    if (oldChecksums && stored && unchangedCount > 0) {
      const unchanged = allKeptFiles.filter((file) => !changedFiles.includes(file))
      const oldBlobs = this.packDB
        ? await this.packDB.getFiles(packId, unchanged)
        : new Map(unchanged.flatMap((f) => {
          const b = this.files.get(fileKey(packId, f))
          return b ? [[f, b] as const] : []
        }))
      for (const [file, bytes] of oldBlobs) blobs.set(file, bytes)
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

    // 6. Verify checksums for changed files
    for (const file of changedFiles) {
      const expected = newRefs[file]?.checksum?.replace('sha256:', '')
      if (expected && (await sha256Hex(blobs.get(file)!)) !== expected) {
        throw new Error(`Checksum mismatch for ${file}`)
      }
    }

    // 7. Clear old textures and reinstall
    this.clearPackTextures(packId)
    const packSize = [...blobs.values()].reduce((s, b) => s + b.length, 0)

    // Recompute set bookkeeping against what actually ended up in `blobs` —
    // a set dropped from the new manifest can't stay "installed", and bytes
    // may have moved.
    const newAllSets = allSetNames(newManifest)
    const keptSets = [...installedSets].filter((s) => newAllSets.includes(s))
    const keptDynamic = (stored?.dynamicAssetSets ?? []).filter((s) => keptSets.includes(s))
    const assetSetBytes: Record<string, number> = {}
    const assetSetFiles: Record<string, string[]> = {}
    for (const setName of keptSets) {
      const files = [...filesForSet(newManifest, setName)]
      assetSetFiles[setName] = files
      assetSetBytes[setName] = files.reduce((s, f) => s + (blobs.get(f)?.length ?? 0), 0)
    }

    const bundled = stored?.bundled ?? this.installedPacks.get(packId)?.bundled ?? false
    if (this.packDB) {
      await this.packDB.installPack({
        packId,
        version: newManifest.version,
        bundleSize: packSize,
        manifest: encodeManifest(newManifest),
        blobs,
        lastUsed: Date.now(),
        // An updated bundled pack is still the bundled pack: writing false here made the
        // cache count all of it, eviction free to drop it whole, and the retired-pack
        // sweep blind to it.
        bundled: stored?.bundled ?? false,
        installedAssetSets: keptSets.length ? keptSets : undefined,
        dynamicAssetSets: keptDynamic.length ? keptDynamic : undefined,
        assetSetBytes: Object.keys(assetSetBytes).length ? assetSetBytes : undefined,
        assetSetFiles: Object.keys(assetSetFiles).length ? assetSetFiles : undefined,
      })
    } else {
      for (const [file, bytes] of blobs) this.files.set(fileKey(packId, file), bytes)
    }

    this.installedPacks.set(packId, {
      packId,
      version: newManifest.version,
      entryCount: Object.keys(newManifest.entries).length,
      themes: newManifest.theme ?? [],
      bundleSize: packSize,
      bundled,
      installedAt: Date.now(),
    })
    // The cache backs getPackManifests(), which firstBootInstall reads to decide whether
    // the installed copy still matches the bundle. Leaving the pre-update manifest here
    // made every in-session reader see the old content until the next rehydrate.
    this.manifestCache.set(packId, newManifest)
    this.presentFiles.set(packId, new Set(blobs.keys()))
    this.catalogVersion++
    this.servePending(packId)

    const changedSize = sortedChanged.reduce((s, f) => s + (blobs.get(f)?.length ?? 0), 0)
    return {
      changedFiles: changedFiles.length,
      unchangedFiles: unchangedCount,
      downloadedBytes: changedSize,
      totalFiles: allKeptFiles.length,
    }
  }

  /**
   * Store every file of the requested sets not stored yet (see `ensureFiles`), then record
   * the sets on the pack's record. Decodes nothing. Bumps the asset-set LRU for every
   * requested set, hit or miss. `progress` hears each file as it lands.
   */
  async ensureAssetSets(
    packId: string,
    setNames: string[],
    progress?: Pick<ProgressJob, 'advance'>,
  ): Promise<void> {
    if (setNames.length === 0) return
    const manifest = this.manifestCache.get(packId)
    if (!manifest) {
      console.warn(`[AssetPackManager] ensureAssetSets: no cached manifest for pack "${packId}" — skipping`)
      return
    }

    for (const setName of setNames) bumpAssetSetLRU(packId, setName)

    if (!this.packDB) return
    const sets = [...new Set(setNames)]
    const files = new Set<string>()
    for (const s of sets) for (const f of filesForSet(manifest, s)) files.add(f)
    if (this.missingOf(packId, [...files]).length === 0) return // fast no-op

    await this.ensureFiles(packId, [...files], progress)
    const setFiles: Record<string, string[]> = {}
    const setBytes: Record<string, number> = {}
    for (const s of sets) {
      setFiles[s] = [...filesForSet(manifest, s)]
      setBytes[s] = setSize(manifest, s).bytes
    }
    await this.packDB.mergeAssetSetBlobs(packId, new Map(), setFiles, setBytes)
  }

  /**
   * Fetch and store the files of `files` not stored yet, each verified where
   * `crypto.subtle` exists. A file already downloading is awaited, not fetched twice.
   * Decodes nothing; a texture request waiting on a file is served as it lands. Rejects
   * with the first failure once the other files have settled.
   */
  async ensureFiles(
    packId: string,
    files: string[],
    progress?: Pick<ProgressJob, 'advance'>,
  ): Promise<void> {
    const manifest = this.manifestCache.get(packId)
    if (!manifest || !this.packDB) return
    const missing = this.missingOf(packId, [...new Set(files)])
    if (missing.length === 0) return
    const refs = { ...manifest.atlases, ...manifest.files }

    // Cap check + evict BEFORE writing — never evict what we're about to need.
    const adding = missing.reduce((s, f) => s + (refs[f]?.size ?? 0), 0)
    const usage = await this.getCacheUsage()
    if (usage.used + adding > usage.limit) {
      const evicted = await this.packDB.evictLRU(adding - (usage.limit - usage.used), packId)
      this.clearEvicted(evicted)
    }

    const results = await Promise.allSettled(
      missing.map((file) => this.fetchFile(packId, file, refs[file], progress)),
    )
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failed) throw failed.reason
  }

  private fetchFile(
    packId: string,
    file: string,
    ref: FileRef | undefined,
    progress?: Pick<ProgressJob, 'advance'>,
  ): Promise<void> {
    const key = fileKey(packId, file)
    let run = this.fetching.get(key)
    if (!run) {
      const verify = typeof globalThis.crypto?.subtle?.digest === 'function'
      // Only the download holds a network slot; hashing and the batched write run beside it.
      run = (async () => {
        if (this.presentFiles.get(packId)?.has(file)) return
        const bytes = await this.downloadLimit(async () => {
          const url = `${this.config.cdnBaseUrl}/${packId}/${file}`
          const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
          if (!res.ok) throw new Error(`Failed to download ${file}: ${res.status}`)
          return new Uint8Array(await res.arrayBuffer())
        })
        if (verify && ref && (await sha256Hex(bytes)) !== ref.checksum.replace('sha256:', '')) {
          throw new Error(`Checksum mismatch for ${file}`)
        }
        await this.queueWrite(packId, file, bytes)
        this.markPresent(packId, [file])
        // A texture waiting on this file decodes from these bytes, not a read back.
        this.landed.set(key, bytes)
        const before = this.decoding.get(key)
        this.servePending(packId, [file])
        if (this.decoding.get(key) === before) this.landed.delete(key)
      })().finally(() => this.fetching.delete(key))
      this.fetching.set(key, run)
    }
    return run.then(() => progress?.advance(1, ref?.size ?? 0))
  }

  /**
   * Store one downloaded file. Writes are batched: up to WRITE_BATCH files, or whatever
   * arrived within one task, go in one transaction per pack.
   */
  private queueWrite(packId: string, file: string, bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      this.writeQueue.push({ packId, file, bytes, resolve, reject })
      if (this.writeQueue.length >= WRITE_BATCH) void this.flushWrites()
      else if (!this.writeScheduled) {
        this.writeScheduled = true
        setTimeout(() => void this.flushWrites(), 0)
      }
    })
  }

  private async flushWrites(): Promise<void> {
    this.writeScheduled = false
    const batch = this.writeQueue.splice(0)
    const byPack = new Map<string, typeof batch>()
    for (const w of batch) byPack.set(w.packId, [...(byPack.get(w.packId) ?? []), w])
    await Promise.all(
      [...byPack].map(async ([packId, writes]) => {
        try {
          await this.packDB!.putFiles(packId, new Map(writes.map((w) => [w.file, w.bytes])))
          for (const w of writes) w.resolve()
        } catch (err) {
          for (const w of writes) w.reject(err)
        }
      }),
    )
  }

  /**
   * Resolve texture ids to the asset sets they need, grouped by pack, using
   * the cached manifests.
   */
  assetSetsForTextureIds(ids: string[]): Map<string, Set<string>> {
    return resolveAssetSets(ids, this.getPackManifests())
  }

  /**
   * Enumerate every texture a map references, resolve which asset sets those
   * textures need, and fetch only the missing ones. Safe to call whenever a
   * map is opened — a fully-installed map is a fast no-op — and never throws:
   * unknown/legacy-only ids are silently ignored by the resolution step, and
   * any per-pack fetch failure is logged and skipped rather than propagated.
   */
  async ensureTexturesForMap(mapData: MapTextureSource): Promise<void> {
    let ids: string[]
    try {
      ids = collectMapTextureIds(mapData)
    } catch (err) {
      console.warn('[AssetPackManager] ensureTexturesForMap: failed to enumerate map textures', err)
      return
    }

    const bySet = this.assetSetsForTextureIds(ids)
    await Promise.all(
      [...bySet.entries()].map(([packId, sets]) =>
        this.ensureAssetSets(packId, [...sets]).catch((err) => {
          console.warn(`[AssetPackManager] ensureTexturesForMap: failed to ensure asset sets for pack "${packId}"`, err)
        }),
      ),
    )
  }

  async uninstallPack(packId: string): Promise<void> {
    // Amendment B3: Remove from in-memory caches
    this.clearPackTextures(packId)

    if (this.packDB) {
      const manifest = this.manifestCache.get(packId)
      if (manifest) {
        try {
          const PIXI = await loadPixi()
          for (const atlasFile of Object.keys(manifest.atlases)) {
            if (atlasFile.endsWith('.json')) {
              await PIXI.Assets.unload(atlasFile).catch(() => {})
            }
          }
        } catch {
          // Unload failure is non-fatal during uninstall
        }
      }
      await this.packDB.deletePack(packId)
    }
    for (const key of [...this.files.keys()]) if (key.startsWith(`${packId}/`)) this.files.delete(key)

    this.installedPacks.delete(packId)
    this.manifestCache.delete(packId)
    this.presentFiles.delete(packId)
    this.catalogVersion++
  }

  /**
   * What the pack cache holds against its cap: the one reading eviction and the Packs
   * sheet both use. Bundled packs count only the asset sets fetched after the bundle
   * (see AssetPackDB.getCacheUsage); without a DB nothing is cached.
   */
  async getCacheUsage(): Promise<{ used: number; limit: number }> {
    if (!this.packDB) return { used: 0, limit: this.config.cacheLimit ?? 200 * 1024 * 1024 }
    return this.packDB.getCacheUsage()
  }

  clearCache(): void {
    this.textureCache.clear()
    this.frameCache.clear()
    this.installedPacks.clear()
    for (const url of this.blobUrls.values()) URL.revokeObjectURL(url)
    this.blobUrls.clear()
    this.decoding.clear()
    this.failedDecodes.clear()
    this.pendingRequests.clear()
    this.catalogVersion++
  }

  /**
   * Restore installed packs from IndexedDB at app boot: metadata only. Fills the pack list,
   * the manifests and which sets are stored; decodes nothing and reads no file.
   */
  async rehydrate(): Promise<void> {
    if (!this.packDB) return

    await this.packDB.open()
    const packs = await this.packDB.getAllPackMeta()
    // File names only, no bytes: which files each pack holds.
    const storedFiles = await this.packDB.getFileNames()
    for (const [packId, names] of storedFiles) this.presentFiles.set(packId, names)

    let loadedCount = 0
    for (const stored of packs) {
      try {
        const manifest = decodeManifest(stored.manifest)
        this.installedPacks.set(stored.packId, {
          packId: stored.packId,
          version: stored.version,
          entryCount: Object.keys(manifest.entries).length,
          themes: manifest.theme ?? [],
          bundleSize: stored.bundleSize,
          bundled: stored.bundled,
          installedAt: stored.lastUsed,
        })
        this.manifestCache.set(stored.packId, manifest)
        loadedCount++
      } catch (err) {
        console.warn(`[AssetPackManager] Failed to rehydrate pack "${stored.packId}":`, err)
      }
    }
    this.catalogVersion++

    if (loadedCount > 0) {
      console.info(`[AssetPackManager] Rehydrated ${loadedCount} pack(s)`)
    }
  }

  /** Clear in-memory textures, decodes and object URLs for a specific pack */
  private clearPackTextures(packId: string): void {
    const prefix = packId + ':'
    for (const key of [...this.textureCache.keys()]) {
      if (key.startsWith(prefix)) {
        this.textureCache.delete(key)
        this.frameCache.delete(key)
      }
    }
    this.forgetFiles((key) => key.startsWith(`${packId}/`))
  }

  /** Clear in-memory textures for one asset set of a pack, by manifest lookup. */
  private clearAssetSetTextures(packId: string, setName: string): void {
    const manifest = this.manifestCache.get(packId)
    if (!manifest) return
    for (const [entryId, entry] of Object.entries(manifest.entries)) {
      if (entry.set !== setName) continue
      const key = `${packId}:${entryId}`
      this.textureCache.delete(key)
      this.frameCache.delete(key)
    }
    const files = new Set([...filesForSet(manifest, setName)].map((f) => fileKey(packId, f)))
    this.forgetFiles((key) => files.has(key))
    const present = this.presentFiles.get(packId)
    for (const f of filesForSet(manifest, setName)) present?.delete(f)
  }

  /** Revoke the object URLs and drop the decode memos of the files `match` picks. */
  private forgetFiles(match: (key: string) => boolean): void {
    for (const [key, url] of [...this.blobUrls]) {
      if (!match(key)) continue
      URL.revokeObjectURL(url)
      this.blobUrls.delete(key)
    }
    for (const key of [...this.decoding.keys()]) if (match(key)) this.decoding.delete(key)
    for (const key of [...this.failedDecodes]) if (match(key)) this.failedDecodes.delete(key)
  }

  /**
   * Clear in-memory textures for whatever `AssetPackDB.evictLRU` evicted —
   * a bare packId for a whole pack, or `packId:setName` for one asset set.
   */
  private clearEvicted(evictedIds: string[]): void {
    for (const id of evictedIds) {
      const sep = id.indexOf(':')
      if (sep === -1) {
        this.clearPackTextures(id)
        this.presentFiles.delete(id)
      } else {
        this.clearAssetSetTextures(id.slice(0, sep), id.slice(sep + 1))
      }
    }
  }
}

let pixi: Promise<typeof import('pixi.js')> | null = null

/** Pixi, imported once on first decode: the manager is on the home path, Pixi is not. */
function loadPixi(): Promise<typeof import('pixi.js')> {
  pixi ??= import('pixi.js')
  return pixi
}

function fileKey(packId: string, file: string): string {
  return `${packId}/${file}`
}

function encodeManifest(manifest: PackManifest): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(manifest)).buffer as ArrayBuffer
}

function decodeManifest(buf: ArrayBuffer): PackManifest {
  return JSON.parse(new TextDecoder().decode(new Uint8Array(buf))) as PackManifest
}

/** Total bytes of every file a manifest lists. */
function manifestBytes(manifest: PackManifest): number {
  return [...Object.values(manifest.atlases), ...Object.values(manifest.files)].reduce((s, r) => s + (r.size ?? 0), 0)
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** `material_gridSize_variant-` prefix a loose file must start with to belong to `entry`. */
function loosePrefixFor(entry: ManifestEntry): string {
  return `${entry.material}_${entry.gridSize}_${entry.variant}-`
}

/** The frame-data json of an atlas, which shares its image's basename; the name itself if none. */
function atlasJsonOf(manifest: PackManifest, atlas: string): string {
  const jsonName = atlas.replace(/\.[a-z0-9]+$/i, '.json')
  return manifest.atlases[jsonName] ? jsonName : atlas
}

/** Every file (atlas json + image, or loose files) one manifest entry needs. */
function entryFiles(manifest: PackManifest, entry: ManifestEntry): string[] {
  if (entry.atlas) {
    const files = [entry.atlas]
    // The atlas image and its frame-data JSON share a basename — decodeFile
    // needs both to build a spritesheet.
    const jsonName = atlasJsonOf(manifest, entry.atlas)
    if (jsonName !== entry.atlas) files.push(jsonName)
    return files
  }
  const file = looseFiles(manifest).get(loosePrefixFor(entry).slice(0, -1))
  return file ? [file] : []
}

const looseFileCache = new WeakMap<PackManifest, Map<string, string>>()

/**
 * A manifest's loose files by name less their `-<hash>.<ext>` suffix, which is an
 * entry's `material_gridSize_variant`. Built once per manifest: scanning every file for
 * every entry made each set lookup thousands of string compares.
 */
function looseFiles(manifest: PackManifest): Map<string, string> {
  let byStem = looseFileCache.get(manifest)
  if (!byStem) {
    byStem = new Map()
    for (const file of Object.keys(manifest.files)) byStem.set(file.replace(/-[^-]*$/, ''), file)
    looseFileCache.set(manifest, byStem)
  }
  return byStem
}

/** Every asset set name any entry in the manifest declares. */
function allSetNames(manifest: PackManifest): string[] {
  return [...new Set(Object.values(manifest.entries).map((e) => e.set).filter((s): s is string => !!s))]
}

/** Every file (atlas + loose) that belongs to one asset set. */
function filesForSet(manifest: PackManifest, setName: string): Set<string> {
  let bySet = setFileCache.get(manifest)
  if (!bySet) {
    bySet = new Map()
    for (const entry of Object.values(manifest.entries)) {
      if (!entry.set) continue
      const files = bySet.get(entry.set) ?? new Set<string>()
      for (const file of entryFiles(manifest, entry)) files.add(file)
      bySet.set(entry.set, files)
    }
    setFileCache.set(manifest, bySet)
  }
  return new Set(bySet.get(setName))
}

const setFileCache = new WeakMap<PackManifest, Map<string, Set<string>>>()

/** File count and manifest bytes of one asset set. */
function setSize(manifest: PackManifest, setName: string): { files: number; bytes: number } {
  const refs = { ...manifest.atlases, ...manifest.files }
  const files = [...filesForSet(manifest, setName)]
  return { files: files.length, bytes: files.reduce((s, f) => s + (refs[f]?.size ?? 0), 0) }
}

/** Files needed for every setless entry plus every entry in `installedSets`. */
function neededFiles(manifest: PackManifest, installedSets: Set<string>): Set<string> {
  const files = new Set<string>()
  for (const entry of Object.values(manifest.entries)) {
    if (entry.set && !installedSets.has(entry.set)) continue
    for (const file of entryFiles(manifest, entry)) files.add(file)
  }
  return files
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
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}
