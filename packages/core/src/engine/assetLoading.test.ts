// Tiered asset loading against the packs the apps ship (canvas/public/packs) and a real
// AssetPackDB on fake-indexeddb: boot reads no pack file, a map fetches only its sets,
// textures decode on first use.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getAssetPackManager, resetAssetPackManager } from './assetPackInstance'
import { bootAssets, resetBootAssets } from './boot'
import { ensureMapAssets, installLibrary } from './firstBootInstall'
import { AssetPackDB } from './assetPackDB'
import { AssetPackManager, type AssetProgress, type PackManifest } from './assetPackManager'
import { collectMapTextureIds, type MapTextureSource } from './mapTextureRefs'
import { createDefaultState, createDungeonLayer } from '../store/factories'
import type { DungeonLayer } from '../store/types'

const loads = vi.hoisted(() => ({ count: 0 }))

vi.mock('pixi.js', () => {
  class MockSpritesheet {
    textures: Record<string, unknown> = {}
    constructor(_base: unknown, data: { frames?: Record<string, unknown> }) {
      for (const id of Object.keys(data.frames ?? {})) this.textures[id] = { width: 32, height: 32 }
    }
    async parse(): Promise<Record<string, unknown>> {
      return this.textures
    }
  }
  return {
    Assets: {
      load: vi.fn(async () => {
        loads.count++
        return { width: 64, height: 64 }
      }),
      unload: vi.fn(async () => {}),
      get: vi.fn(),
      cache: { has: () => false },
    },
    Spritesheet: MockSpritesheet,
    Texture: { from: vi.fn(() => ({ width: 1, height: 1 })), EMPTY: { width: 1 }, WHITE: { width: 1 } },
    Rectangle: class {},
  }
})

// Tests run from packages/core.
const PACKS_DIR = resolve(process.cwd(), '../../canvas/public/packs') + '/'

function readPacksFile(rel: string): Buffer {
  return readFileSync(PACKS_DIR + rel)
}

function shippedManifest(packId: string): PackManifest {
  const index = JSON.parse(readPacksFile('index.json').toString()) as { packs: Record<string, { manifest: string }> }
  return JSON.parse(readPacksFile(index.packs[packId].manifest).toString()) as PackManifest
}

/** Every file a set's entries need, worked out from the manifest on its own terms. */
function filesOfSets(manifest: PackManifest, sets: string[]): string[] {
  const out = new Set<string>()
  for (const entry of Object.values(manifest.entries)) {
    if (!entry.set || !sets.includes(entry.set)) continue
    if (entry.atlas) {
      out.add(entry.atlas)
      out.add(entry.atlas.replace(/\.webp$/, '.json'))
    } else {
      const prefix = `${entry.material}_${entry.gridSize}_${entry.variant}-`
      for (const f of Object.keys(manifest.files)) if (f.startsWith(prefix)) out.add(f)
    }
  }
  return [...out].sort()
}

/** Serves /packs from disk; records the pack files (not index or manifests) fetched. */
function servePacks(): { packFiles: string[]; all: string[] } {
  const seen = { packFiles: [] as string[], all: [] as string[] }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      seen.all.push(url)
      const rel = url.replace(/^\/packs\//, '')
      let body: Buffer
      try {
        body = readPacksFile(rel)
      } catch {
        return { ok: false, status: 404 } as Response
      }
      if (!/(^index\.json$|\/pack-[0-9a-f]+\.json$)/.test(rel)) seen.packFiles.push(rel)
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(body.toString()),
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      } as unknown as Response
    }),
  )
  return seen
}

function mapOf(layer: DungeonLayer): MapTextureSource {
  return {
    mapSettings: { name: 'x', cellScale: { value: 5, unit: 'ft' }, ambientLight: '#000', sightDropCells: 2, crossingKinds: [] },
    layers: [layer],
  } as MapTextureSource
}

function bareLayer(): DungeonLayer {
  const layer = createDungeonLayer('L')
  layer.style.defaultTextureId = undefined
  layer.style.wallTextureSetId = undefined
  return layer
}

const ring = { contours: [[[0, 0], [4, 0], [4, 4], [0, 4]]] }

let revoked: string[] = []

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  localStorage.clear()
  resetAssetPackManager()
  resetBootAssets()
  loads.count = 0
  revoked = []
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:test/${n++}`)
  URL.revokeObjectURL = vi.fn((u: string) => {
    revoked.push(u)
  })
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetAssetPackManager()
})

describe('bootAssets', () => {
  it('reads the index and manifests, fetches no pack file and decodes nothing', async () => {
    const seen = servePacks()
    const pm = getAssetPackManager()
    const before = pm.catalogVersion
    await bootAssets(pm)
    await bootAssets(pm) // a remount shares the one run

    expect(seen.packFiles).toEqual([])
    expect(seen.all.filter((u) => u.endsWith('index.json'))).toHaveLength(1)
    expect(pm.getInstalledPacks().map((p) => p.packId).sort()).toEqual(['gg-demo', 'gg-forge'])
    expect(pm.getAssetSetStatus('gg-forge').every((s) => !s.installed)).toBe(true)
    expect(pm.catalogVersion).toBeGreaterThan(before)
    expect(loads.count).toBe(0)
  })
})

describe('ensureMapAssets', () => {
  it('fetches exactly the files of the two sets a map uses, with progress, decoding nothing', async () => {
    const seen = servePacks()
    const pm = getAssetPackManager()
    await bootAssets(pm)

    const layer = bareLayer()
    layer.style.wallTextureSetId = 'GG_Fieldstone'
    layer.style.defaultTextureId = 'gg-forge:cave_floor_8x8_floor_A'
    const ids = collectMapTextureIds(mapOf(layer))
    expect([...(pm.assetSetsForTextureIds(ids).get('gg-forge') ?? [])].sort()).toEqual(['GG_Cave_Floor', 'GG_Fieldstone'])

    const events: AssetProgress[] = []
    await ensureMapAssets(pm, ids, (p) => events.push(p))

    expect([...seen.packFiles].sort()).toEqual(
      filesOfSets(shippedManifest('gg-forge'), ['GG_Fieldstone', 'GG_Cave_Floor']).map((f) => `gg-forge/${f}`),
    )
    const last = events[events.length - 1]
    expect(last.phase).toBe('map')
    expect(last.filesTotal).toBe(seen.packFiles.length)
    expect(last.filesDone).toBe(last.filesTotal)
    expect(last.bytesDone).toBe(last.bytesTotal)
    expect(pm.getProgress().phase).toBe('idle')
    expect(loads.count).toBe(0)

    // A second open of the same map fetches nothing.
    await ensureMapAssets(pm, ids)
    expect(seen.packFiles).toHaveLength(filesOfSets(shippedManifest('gg-forge'), ['GG_Fieldstone', 'GG_Cave_Floor']).length)
  })

  it('dedupes concurrent requests for one set', async () => {
    const seen = servePacks()
    const pm = getAssetPackManager()
    await bootAssets(pm)
    await Promise.all([
      pm.ensureAssetSets('gg-forge', ['GG_Cave_Floor']),
      pm.ensureAssetSets('gg-forge', ['GG_Cave_Floor']),
      ensureMapAssets(pm, ['gg-forge:cave_floor_8x8_floor_A']),
    ])
    expect(seen.packFiles).toEqual(filesOfSets(shippedManifest('gg-forge'), ['GG_Cave_Floor']).map((f) => `gg-forge/${f}`))
  })

  it('a new blank map fetches its seed floor file and the Fieldstone atlas pair, nothing else', async () => {
    const seen = servePacks()
    const pm = getAssetPackManager()
    await bootAssets(pm)
    await ensureMapAssets(pm, collectMapTextureIds(createDefaultState()))
    const fieldstone = filesOfSets(shippedManifest('gg-forge'), ['GG_Fieldstone']).map((f) => `gg-forge/${f}`)
    expect(fieldstone).toHaveLength(2) // one atlas: json and image
    expect([...seen.packFiles].sort()).toEqual([...filesOfIds(['gg-demo:floor_small_8x8_floor_A']), ...fieldstone].sort())
    expect(seen.packFiles.filter((f) => f.startsWith('gg-demo/'))).toHaveLength(1)
  })

  it('the Goblin Warren fetches only the files its art uses, and the library then skips them', async () => {
    const seen = servePacks()
    const pm = getAssetPackManager()
    await bootAssets(pm)
    const ids = collectMapTextureIds(warren())
    const expected = filesOfIds(ids)
    await ensureMapAssets(pm, ids)

    expect([...seen.packFiles].sort()).toEqual(expected)
    const demo = expected.filter((f) => f.startsWith('gg-demo/'))
    const forge = expected.filter((f) => f.startsWith('gg-forge/'))
    expect(demo).toHaveLength(39)
    expect(forge).toHaveLength(47)
    // Against the whole sets those ids belong to: 623 gg-demo files.
    const wholeSets = [...(pm.assetSetsForTextureIds(ids).get('gg-demo') ?? [])]
    expect(filesOfSets(shippedManifest('gg-demo'), wholeSets).length).toBeGreaterThan(600)
    expect(bytesOf(demo)).toBeLessThan(600_000)

    // A set a map only partly stored is not installed until the library finishes it.
    expect(pm.getAssetSetStatus('gg-demo').find((s) => s.set === 'demo-traps')).toMatchObject({ installed: false })
    await installLibrary(pm, ['gg-forge', 'gg-demo'])
    expect(new Set(seen.packFiles).size).toBe(seen.packFiles.length) // nothing fetched twice
    expect(pm.getAssetSetStatus('gg-demo').every((s) => s.installed)).toBe(true)
  })
})

/** The files the art of `ids` lives in, as `<pack>/<file>`, from the manifests on their own terms. */
function filesOfIds(ids: string[]): string[] {
  const manifests = { 'gg-forge': shippedManifest('gg-forge'), 'gg-demo': shippedManifest('gg-demo') }
  const out = new Set<string>()
  for (const raw of ids) {
    const sep = raw.indexOf(':')
    const packId = (sep === -1 ? Object.keys(manifests).find((p) => manifests[p as keyof typeof manifests].entries[raw]) : raw.slice(0, sep)) as keyof typeof manifests | undefined
    const manifest = packId && manifests[packId]
    const entry = manifest?.entries[sep === -1 ? raw : raw.slice(sep + 1)]
    if (!manifest || !entry) continue
    if (entry.atlas) {
      out.add(`${packId}/${entry.atlas}`)
      out.add(`${packId}/${entry.atlas.replace(/\.webp$/, '.json')}`)
    } else {
      const prefix = `${entry.material}_${entry.gridSize}_${entry.variant}-`
      for (const f of Object.keys(manifest.files)) if (f.startsWith(prefix)) out.add(`${packId}/${f}`)
    }
  }
  return [...out].sort()
}

/** Manifest bytes of `<pack>/<file>` names. */
function bytesOf(files: string[]): number {
  return files.reduce((s, pf) => {
    const [packId, file] = [pf.slice(0, pf.indexOf('/')), pf.slice(pf.indexOf('/') + 1)]
    const m = shippedManifest(packId)
    return s + (m.files[file]?.size ?? m.atlases[file]?.size ?? 0)
  }, 0)
}

function warren(): MapTextureSource {
  return JSON.parse(readFileSync(resolve(process.cwd(), '../../session/testdata/goblin-warren.mapbuilder'), 'utf8'))
}

describe('lazy decode', () => {
  it('decodes a texture on first use, once, and tells subscribers', async () => {
    servePacks()
    const pm = getAssetPackManager()
    await bootAssets(pm)
    const id = 'gg-forge:cave_floor_8x8_floor_A'

    // Asked for before its set is stored: kept, and served once the set lands.
    expect(pm.getTextureOrNull(id)).toBeNull()
    const notified = vi.fn()
    pm.subscribeTextures(notified)
    const waiting = pm.waitForTexture(id, 5_000)
    await ensureMapAssets(pm, [id])
    await expect(waiting).resolves.toEqual({ width: 64, height: 64 })
    expect(loads.count).toBe(1)
    expect(pm.textureVersion).toBe(1)

    pm.getTexture(id, () => ({ width: 1 }) as never)
    pm.getTextureOrNull(id)
    expect(loads.count).toBe(1)

    await new Promise((r) => setTimeout(r, 40))
    expect(notified).toHaveBeenCalledTimes(1)
  })

  it('fetches the file of a texture asked for before it is stored, once, with no map open', async () => {
    const seen = servePacks()
    const pm = getAssetPackManager()
    await bootAssets(pm)
    const frame = Object.keys(shippedManifest('gg-forge').entries).find((k) => k.startsWith('GG_Fieldstone_'))!
    const id = `gg-forge:${frame}`

    // A wall set picked after the map opened: nothing else will download it soon.
    const waiting = pm.waitForTexture(id, 5_000)
    await expect(waiting).resolves.not.toBeNull()
    const fieldstone = filesOfSets(shippedManifest('gg-forge'), ['GG_Fieldstone']).map((f) => `gg-forge/${f}`)
    expect([...seen.packFiles].sort()).toEqual(fieldstone)

    pm.getTextureOrNull(id)
    pm.requestTexture(id)
    expect(seen.packFiles).toHaveLength(fieldstone.length)
  })

  it('decodes an atlas once for every frame it holds', async () => {
    servePacks()
    const pm = getAssetPackManager()
    await bootAssets(pm)
    await pm.ensureAssetSets('gg-forge', ['GG_Fieldstone'])
    const frames = Object.entries(shippedManifest('gg-forge').entries)
      .filter(([, e]) => e.set === 'GG_Fieldstone')
      .map(([k]) => `gg-forge:${k}`)
    await pm.waitForTexture(frames[0], 5_000)
    expect(loads.count).toBe(1)
    expect(pm.getTextureOrNull(frames[frames.length - 1])).not.toBeNull()
    expect(loads.count).toBe(1)
  })

  it('a warm boot reads metadata only, and the stored set decodes from IndexedDB', async () => {
    const seen = servePacks()
    await bootAssets(getAssetPackManager())
    await ensureMapAssets(getAssetPackManager(), ['gg-forge:cave_floor_8x8_floor_A'])
    const fetchedCold = seen.packFiles.length

    // Reload: a new manager on the same database.
    resetAssetPackManager()
    resetBootAssets()
    const getFile = vi.spyOn(AssetPackDB.prototype, 'getFile')
    const pm = getAssetPackManager()
    await bootAssets(pm)
    expect(getFile).not.toHaveBeenCalled()
    expect(pm.getAssetSetStatus('gg-forge').find((s) => s.set === 'GG_Cave_Floor')?.installed).toBe(true)

    await expect(pm.waitForTexture('gg-forge:cave_floor_8x8_floor_A', 5_000)).resolves.not.toBeNull()
    expect(getFile).toHaveBeenCalled()
    expect(seen.packFiles).toHaveLength(fetchedCold)
  })

  it('revokes object URLs on uninstall', async () => {
    servePacks()
    const pm = getAssetPackManager()
    await bootAssets(pm)
    await ensureMapAssets(pm, ['gg-forge:cave_floor_8x8_floor_A'])
    await pm.waitForTexture('gg-forge:cave_floor_8x8_floor_A', 5_000)
    await pm.uninstallPack('gg-forge')
    expect(revoked).toEqual(['blob:test/0'])
    expect(pm.getTextureOrNull('gg-forge:cave_floor_8x8_floor_A')).toBeNull()
  })
})

describe('installLibrary', () => {
  it('fetches every set not stored, smallest first, and stops between sets on abort', async () => {
    const seen = servePacks()
    const pm = getAssetPackManager()
    await bootAssets(pm)
    await ensureMapAssets(pm, ['gg-forge:cave_floor_8x8_floor_A'])
    const afterMap = seen.packFiles.length

    const ctrl = new AbortController()
    const phases: string[] = []
    let sets = 0
    await installLibrary(pm, ['gg-forge'], (p) => {
      phases.push(p.phase)
      if (p.filesDone > 0 && ++sets === 1) ctrl.abort()
    }, ctrl.signal)
    const status = pm.getAssetSetStatus('gg-forge')
    const installed = status.filter((s) => s.installed).map((s) => s.set)
    // The map's set plus the smallest other one; the rest wait for a resume.
    const smallest = status.filter((s) => s.set !== 'GG_Cave_Floor').sort((a, b) => a.bytes - b.bytes)[0].set
    expect(installed.sort()).toEqual(['GG_Cave_Floor', smallest].sort())
    expect(new Set(phases)).toEqual(new Set(['library']))

    await installLibrary(pm, ['gg-forge'])
    expect(pm.getAssetSetStatus('gg-forge').every((s) => s.installed)).toBe(true)
    expect(seen.packFiles.length - afterMap).toBe(
      filesOfSets(shippedManifest('gg-forge'), status.map((s) => s.set).filter((s) => s !== 'GG_Cave_Floor')).length,
    )
    expect(pm.getProgress().phase).toBe('idle')
  })
})

describe('checksums', () => {
  it('are skipped where crypto.subtle is missing (plain-HTTP LAN entrance)', async () => {
    servePacks()
    const pm = new AssetPackManager({ cdnBaseUrl: '/packs', packDB: new AssetPackDB('no-subtle') })
    await pm.rehydrate()
    const manifest = shippedManifest('gg-forge')
    for (const ref of [...Object.values(manifest.files), ...Object.values(manifest.atlases)]) ref.checksum = 'sha256:bad'
    await pm.registerManifest('gg-forge', manifest)
    vi.stubGlobal('crypto', {})
    await expect(pm.ensureAssetSets('gg-forge', ['GG_Cave_Floor'])).resolves.toBeUndefined()
    vi.unstubAllGlobals()
    servePacks()
    await expect(pm.ensureAssetSets('gg-forge', ['GG_Fieldstone'])).rejects.toThrow('Checksum mismatch')
  })
})

describe('collectMapTextureIds — fixture over the shipped packs', () => {
  function seedShipped(): AssetPackManager {
    const pm = getAssetPackManager()
    const cache = (pm as unknown as { manifestCache: Map<string, PackManifest> }).manifestCache
    cache.set('gg-forge', shippedManifest('gg-forge'))
    cache.set('gg-demo', shippedManifest('gg-demo'))
    pm.catalogVersion++
    return pm
  }

  function setsOf(pm: AssetPackManager, layer: DungeonLayer, extraIds?: string[]): Record<string, string[]> {
    const bySet = pm.assetSetsForTextureIds(collectMapTextureIds(mapOf(layer), extraIds))
    return Object.fromEntries([...bySet].map(([p, s]) => [p, [...s].sort()]).sort())
  }

  const demo = shippedManifest('gg-demo')
  const forge = shippedManifest('gg-forge')
  const propId = `gg-demo:${Object.keys(demo.entries).find((k) => demo.entries[k].set === 'demo-effects')}`
  const tokenId = `gg-demo:${Object.keys(demo.entries).find((k) => demo.entries[k].set === 'demo-creatures')}`
  const pathId = `gg-forge:${Object.keys(forge.entries).find((k) => forge.entries[k].set === 'GG_Palisade' && forge.entries[k].pieceType === 'path')}`

  const prop = { id: 'a', name: 'a', childType: 'asset', objectType: 'asset', assetId: propId, visible: true }
  const path = { id: 'p', name: 'p', childType: 'pathway', pieceId: pathId, visible: true, ...ring }
  const plateau = { id: 'h', name: 'h', childType: 'plateau', height: 1, edge: 'cliff', visible: true, ...ring }
  const door = { id: 'd', name: 'd', childType: 'door', style: 'single', kit: 'cave', wallId: '', state: 'closed', visible: true }
  const patch = { id: 'm', material: 'GG_Cave_Ink', rings: [], smooth: false, border: true }

  it('resolves each gap to its set', () => {
    const pm = seedShipped()
    const withChildren = (children: unknown[]): DungeonLayer => {
      const layer = bareLayer()
      layer.children = children as DungeonLayer['children']
      return layer
    }
    expect(setsOf(pm, withChildren([prop]))).toEqual({ 'gg-demo': ['demo-effects'] })
    expect(setsOf(pm, withChildren([path]))).toEqual({ 'gg-forge': ['GG_Palisade'] })
    expect(setsOf(pm, withChildren([plateau]))).toEqual({ 'gg-forge': ['GG_Cave_Ink'] })
    expect(setsOf(pm, withChildren([door]))['gg-forge']).toContain('GG_Door_Kits')
    const painted = bareLayer()
    painted.materials = [patch] as DungeonLayer['materials']
    expect(setsOf(pm, painted)).toEqual({ 'gg-forge': ['GG_Cave_Floor', 'GG_Cave_Ink'] })
    expect(setsOf(pm, bareLayer(), [tokenId])).toEqual({ 'gg-demo': ['demo-creatures'] })
  })

  it('resolves the whole fixture map', () => {
    const pm = seedShipped()
    const layer = bareLayer()
    layer.children = [prop, path, plateau, door] as unknown as DungeonLayer['children']
    layer.materials = [patch] as DungeonLayer['materials']
    expect(setsOf(pm, layer, [tokenId])).toEqual({
      'gg-demo': ['demo-creatures', 'demo-effects'],
      'gg-forge': ['GG_Cave_Floor', 'GG_Cave_Ink', 'GG_Door_Kits', 'GG_Palisade'],
    })
  })

  function resolveMap(pm: AssetPackManager, map: MapTextureSource): Record<string, string[]> {
    const bySet = pm.assetSetsForTextureIds(collectMapTextureIds(map))
    return Object.fromEntries([...bySet].map(([p, s]) => [p, [...s].sort()]).sort())
  }

  it('a new blank map resolves to its wall set and its seed floor only', () => {
    const pm = seedShipped()
    // The seed floor (factories.ts DEFAULT_DUNGEON_STYLE) is gg-demo's small plaster.
    expect(resolveMap(pm, createDefaultState())).toEqual({
      'gg-demo': ['demo-floors'],
      'gg-forge': ['GG_Fieldstone'],
    })
  })

  it('one placed prop adds exactly its own set', () => {
    const pm = seedShipped()
    const map = createDefaultState()
    const layer = map.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!
    layer.children = [prop] as unknown as DungeonLayer['children']
    expect(resolveMap(pm, map)).toEqual({
      'gg-demo': ['demo-effects', 'demo-floors'],
      'gg-forge': ['GG_Fieldstone'],
    })
  })

  it('the Goblin Warren resolves to the sets its 144 props, cave band and kit doors use', () => {
    const pm = seedShipped()
    const warren = JSON.parse(readFileSync(resolve(process.cwd(), '../../session/testdata/goblin-warren.mapbuilder'), 'utf8'))
    expect(resolveMap(pm, warren)).toEqual({
      'gg-demo': [
        'demo-clutter', 'demo-decor', 'demo-effects', 'demo-floors', 'demo-furniture',
        'demo-gear', 'demo-lighting', 'demo-nature', 'demo-storage', 'demo-traps',
      ],
      'gg-forge': ['GG_Cave_Ink', 'GG_Door_Kits'],
    })
  })
})
