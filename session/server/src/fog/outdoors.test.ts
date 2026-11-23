// Table fix pass §2.4 to §2.7 on the outdoor-cave fixture, as the fog rework left them: the
// cells sight clears from outside, a republish that moves the frame, whose eyes see, and the
// open ground a fogged seat is sent.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { rebaseRegion, setCells, type FogState, type SceneFog } from '@dnd/mechanics/fog'
import type { DoorsState } from '@dnd/mechanics/doors'
import type { Token, TokensState } from '@dnd/mechanics/tokens'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { ensureClipperReady } from './clipperBoot'
import { pointInPoly } from './sceneMap'
import { createVision } from './vision'

beforeAll(async () => {
  expect(await ensureClipperReady()).toBe(true)
}, 30_000)

const MAP = readFileSync(join(import.meta.dirname, '../../../testdata/outdoor-cave.ggvtt'), 'utf8')
const SCENE = 'scene-cave'

/** The fixture with a room in its cave, so the cave is a room of its own. */
function withCaveRoom(open = true): string {
  const map = JSON.parse(MAP)
  const layer = map.layers.find((l: { type: string }) => l.type === 'dungeon')
  layer.rooms.push({ id: 'room-cave', name: 'Cave', anchor: [22, 9] })
  if (!open) delete layer.caveOpenings
  return JSON.stringify(map)
}

const pc = (over: Partial<Token> = {}): Token =>
  ({ id: 'pc', name: 'Bram', size: 'medium', x: 15.5, y: 9.5, ownerId: 'p-1', hidden: false, sight: null, ...over }) as Token

function table(map = MAP) {
  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Cave')
  stores.maps.insert(SCENE, campaign.id, 'Outdoor Cave', map)
  stores.scenes.create(SCENE, campaign.id, SCENE, 'Outdoor Cave')
  const vision = createVision(stores)
  const campaignId = campaign.id
  const setFog = (scene: Partial<SceneFog>) =>
    stores.moduleState.put(campaignId, 'fog', {
      byScene: { [SCENE]: { ...scene } },
    } satisfies FogState)
  const setTokens = (...tokens: Token[]) =>
    stores.moduleState.put(campaignId, 'tokens', {
      library: {},
      byScene: { [SCENE]: Object.fromEntries(tokens.map((t) => [t.id, t])) },
    } satisfies TokensState)
  const setDoors = (open: boolean) =>
    stores.moduleState.put(campaignId, 'doors', {
      byScene: { [SCENE]: { 'door-hall': { open, locked: false, revealed: true } } },
    } satisfies DoorsState)
  const fogOf = () => (stores.moduleState.get(campaignId, 'fog') as FogState).byScene[SCENE]
  return { stores, campaignId, vision, setFog, setTokens, setDoors, fogOf }
}

describe('sight from outside (§2.4, §2.5, §2.7)', () => {
  it('11: a sweep from outside clears outdoor cells on the token’s level', () => {
    const t = table()
    t.setTokens(pc())
    t.setFog({ on: true })
    const patch = t.vision.autoExplorePatch(SCENE)!
    expect(Object.keys(patch.byLevel)).toEqual(['lvl-1'])
    expect(patch.byLevel['lvl-1']).toContainEqual([14, 9])
  })

  it('12: a republish that moves the frame keeps cleared cells where they were (row 14)', () => {
    const t = table()
    const frame = t.vision.frameOf(t.campaignId, SCENE)!
    t.setTokens(pc())
    t.setFog({ on: true, cleared: { 'lvl-1': setCells(rebaseRegion(undefined, frame)!, [[15, 9]]) } })
    expect(t.vision.visionOf(SCENE)!.known(undefined, 15.5, 9.5)).toBe(true)
    // The same map, grown: a new frame, so the stored record no longer matches it.
    const grown = JSON.parse(MAP)
    grown.mapSettings.fixedSize = { width: 34, height: 24, locked: true }
    t.stores.maps.insert('map-2', t.campaignId, 'Outdoor Cave', JSON.stringify(grown))
    t.stores.scenes.republish(SCENE, 'map-2')
    t.vision.invalidateScene(SCENE)
    const moved = t.vision.frameOf(t.campaignId, SCENE)!
    expect(moved).not.toEqual(frame)
    expect(t.vision.visionOf(SCENE)!.known(undefined, 15.5, 9.5)).toBe(true)
    expect(t.vision.visionOf(SCENE)!.known(undefined, 16.5, 9.5)).toBe(false)
  })

  it('13: a player’s token with no sight sees, an unowned PC sees for the party, an NPC does not', () => {
    const owned = table()
    owned.setTokens(pc())
    owned.setFog({ on: true })
    expect(owned.vision.autoExplorePatch(SCENE)?.byLevel['lvl-1'].length).toBeGreaterThan(0)

    const unownedPc = table()
    unownedPc.setTokens(pc({ ownerId: null, kind: 'pc' }))
    unownedPc.setFog({ on: true })
    expect(unownedPc.vision.autoExplorePatch(SCENE)?.byLevel['lvl-1'].length).toBeGreaterThan(0)

    const npc = table()
    npc.setTokens(pc({ ownerId: null, kind: 'npc' }))
    npc.setFog({ on: true })
    expect(npc.vision.autoExplorePatch(SCENE)).toBeNull()
  })
})

describe('the open ground a seat is owed (S3)', () => {
  const frameRing = (w: number, h: number) => [[0, 0], [w, 0], [w, h], [0, h]]
  const inside = (rings: [number, number][][], x: number, y: number) =>
    rings.filter((ring) => pointInPoly(ring, x, y)).length % 2 === 1

  /** Fog on, and what the token's sight clears written to the record. */
  const cleared = (t: ReturnType<typeof table>) => {
    t.setFog({ on: true })
    const frame = t.vision.frameOf(t.campaignId, SCENE)!
    const { byLevel } = t.vision.autoExplorePatch(SCENE)!
    t.setFog({ on: true, cleared: Object.fromEntries(Object.entries(byLevel).map(([l, cells]) => [l, setCells(rebaseRegion(undefined, frame)!, cells)])) })
  }

  it('stays the frame less the walled floors on a base-ground map', () => {
    // Each token stands on open ground, so what it clears includes outdoor cells.
    for (const [map, w, h, x, y] of [[MAP, 30, 20, 15.5, 9.5], [readFileSync(join(import.meta.dirname, '../../../testdata/testing-cave.ggvtt'), 'utf8'), 30, 30, 7.5, 22.5]] as const) {
      const t = table(map)
      t.setTokens(pc({ x, y }))
      cleared(t)
      const scene = t.vision.sceneMapOf(SCENE)!
      const floors = scene.data.layers.flatMap((l) => (l.type === 'dungeon' ? (l.mergedFloor ?? []) : []))
      expect(t.vision.playerMap(SCENE)!.openGround![0].rings).toEqual([frameRing(w, h), ...floors])
    }
  })

  it('on a ground-pieces map, opens only around cleared ground: not the empty frame, not far rock', () => {
    const map = JSON.parse(withCaveRoom())
    delete map.mapSettings.ground
    const t = table(JSON.stringify(map))
    t.setTokens(pc({ x: 5.5, y: 16.5 }))
    cleared(t)
    const rings = t.vision.playerMap(SCENE)!.openGround![0].rings as [number, number][][]
    // The grass patch, and a band pad round it.
    expect(inside(rings, 5.5, 16.5)).toBe(true)
    expect(inside(rings, 14.5, 16.5)).toBe(true)
    // The empty frame, the cave's far rock and the cave inside stay under the fog.
    expect(inside(rings, 28.5, 18.5)).toBe(false)
    expect(inside(rings, 26.3, 5)).toBe(false)
    expect(inside(rings, 22, 9)).toBe(false)
  })
})
