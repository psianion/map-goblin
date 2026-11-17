// Table fix pass §2.4 to §2.7, tests 6.1 rows 7 to 13, on the outdoor-cave fixture: the Outdoors
// fog row, what the party sees behind doors and cave mouths, the stored party reveal, the record
// written from outside, a republish, and whose eyes see.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { fogModule, getCell, regionFor, setCells, type FogState, type SceneFog } from '@dnd/mechanics/fog'
import type { DoorsState } from '@dnd/mechanics/doors'
import { tokensModule, type Token, type TokensState } from '@dnd/mechanics/tokens'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { ModuleRegistry } from '../modules/registry'
import { ensureClipperReady } from './clipperBoot'
import { partyHere } from './partyHere'
import { pointInPoly } from './sceneMap'
import { createVision } from './vision'

beforeAll(async () => {
  expect(await ensureClipperReady()).toBe(true)
}, 30_000)

const MAP = readFileSync(join(import.meta.dirname, '../../../testdata/outdoor-cave.ggvtt'), 'utf8')
const SCENE = 'scene-cave'
const lit = { status: 'revealed' as const, wasEverRevealed: true }
const DM = { role: 'dm' as const, identityId: 'dm-1' }

/** The fixture with a room in its cave, so the cave is a fog row of its own. */
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
      byScene: { [SCENE]: { rooms: {}, concealBehindDoors: true, ...scene } },
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

describe('the Outdoors row and what the party sees (§2.1, §2.6)', () => {
  it('7: is a fog row the DM can reveal and hide', () => {
    const { vision, campaignId } = table()
    expect(vision.roomsOf(campaignId, SCENE)).toEqual(['room-hall', '@outdoors'])
    const fog = fogModule(vision.roomsOf)
    let state: FogState = { byScene: {} }
    const ctx = {
      campaignId,
      sessionId: 's',
      activeSceneId: SCENE,
      sender: DM,
      players: [],
      broadcast: () => {},
      get state() {
        return state
      },
      setState: (next: FogState) => {
        state = next
      },
    }
    expect(fog.handler('reveal', { roomId: '@outdoors' }, ctx)).toBeUndefined()
    expect(state.byScene[SCENE].rooms['@outdoors']).toEqual(lit)
    expect(fog.handler('hide', { roomId: '@outdoors' }, ctx)).toBeUndefined()
    expect(state.byScene[SCENE].rooms['@outdoors']).toEqual({ status: 're_hidden', wasEverRevealed: true })
  })

  it('8: a one-sided door links a room and Outdoors', () => {
    const t = table()
    t.setTokens(pc())
    t.setFog({ rooms: { 'room-hall': lit, '@outdoors': lit } })
    expect([...t.vision.visionOf(SCENE)!.visible].sort()).toEqual(['@outdoors'])
    t.setDoors(true)
    expect([...t.vision.visionOf(SCENE)!.visible].sort()).toEqual(['@outdoors', 'room-hall'])
    expect(t.vision.visibleOf(SCENE)).toEqual(expect.arrayContaining(['@outdoors', 'room-hall']))
  })

  it('9: a cave mouth links without a door', () => {
    const open = table(withCaveRoom())
    open.setTokens(pc())
    open.setFog({ rooms: { 'room-cave': lit, '@outdoors': lit } })
    expect([...open.vision.visionOf(SCENE)!.visible].sort()).toEqual(['@outdoors', 'room-cave'])
    const sealed = table(withCaveRoom(false))
    sealed.setTokens(pc())
    sealed.setFog({ rooms: { 'room-cave': lit, '@outdoors': lit } })
    expect([...sealed.vision.visionOf(SCENE)!.visible]).toEqual(['@outdoors'])
  })

  it('10: a party token put in an unrevealed room reveals it, and it stays revealed', () => {
    const t = table()
    const registry = new ModuleRegistry(t.stores.moduleState, partyHere(t.vision))
    registry.register(tokensModule(t.vision.visionOf))
    registry.register(fogModule(t.vision.roomsOf, t.vision.frameOf, t.vision.roomAtOf))
    const ctx = { campaignId: t.campaignId, sessionId: 's', activeSceneId: SCENE, sender: DM, players: [], broadcast: () => {} }
    expect(registry.dispatch('tokens', 'place', { name: 'Bram', kind: 'pc', x: 8.5, y: 7.5 }, ctx)).toBeNull()
    expect(t.fogOf().rooms['room-hall']).toEqual(lit)
    // The DM revealing somewhere else does not take it back (F8).
    expect(registry.dispatch('fog', 'reveal', { roomId: '@outdoors' }, ctx)).toBeNull()
    expect(t.fogOf().rooms['room-hall']).toEqual(lit)
    expect(t.vision.visionOf(SCENE)!.visible.has('room-hall')).toBe(true)
  })
})

describe('sight from outside (§2.4, §2.5, §2.7)', () => {
  it('11: a sweep from outside records outdoor cells, and the cave ships when its rock is seen', () => {
    const t = table()
    t.setTokens(pc())
    t.setFog({ mode: 'vision', containedSight: false })
    const before = t.vision.playerMap(SCENE)!
    const ids = (map: typeof before) => map.layers.flatMap((l) => ('children' in l ? l.children.map((c) => c.id) : []))
    expect(ids(before)).not.toContain('cave-floor')

    const patch = t.vision.autoExplorePatch(SCENE)!
    const frame = t.vision.frameOf(t.campaignId, SCENE)!
    expect(patch.cells).toContainEqual([14, 9])
    t.setFog({ mode: 'vision', containedSight: false, region: setCells(regionFor(undefined, frame)!, patch.cells) })
    const after = t.vision.playerMap(SCENE)!
    expect(ids(after)).toContain('cave-floor')
    // The ground piece always ships, and the open ground arrives with the first outdoor cell.
    expect(ids(after)).toContain('grass-patch')
    expect(after.openGround?.[0].rings.length).toBeGreaterThan(1)
  })

  it('12: a republish that keeps the frame keeps the record', () => {
    const t = table()
    const frame = t.vision.frameOf(t.campaignId, SCENE)!
    const region = setCells(regionFor(undefined, frame)!, [[15, 9]])
    t.setTokens(pc())
    t.setFog({ mode: 'vision', region })
    expect(t.vision.visionOf(SCENE)!.openGround!(15.5, 9.5)).toBe(true)
    t.stores.maps.insert('map-2', t.campaignId, 'Outdoor Cave', MAP)
    t.stores.scenes.republish(SCENE, 'map-2')
    t.vision.invalidateScene(SCENE)
    expect(getCell(regionFor(t.fogOf().region, t.vision.frameOf(t.campaignId, SCENE)!), 15, 9)).toBe(true)
    expect(t.vision.visionOf(SCENE)!.openGround!(15.5, 9.5)).toBe(true)
  })

  it('13: a player’s token with no sight sees, an unowned PC sees for the party, an NPC does not', () => {
    const owned = table()
    owned.setTokens(pc())
    owned.setFog({ mode: 'vision' })
    expect(owned.vision.autoExplorePatch(SCENE)?.cells.length).toBeGreaterThan(0)

    const unownedPc = table()
    unownedPc.setTokens(pc({ ownerId: null, kind: 'pc' }))
    unownedPc.setFog({ mode: 'vision' })
    expect(unownedPc.vision.autoExplorePatch(SCENE)?.cells.length).toBeGreaterThan(0)

    const npc = table()
    npc.setTokens(pc({ ownerId: null, kind: 'npc' }))
    npc.setFog({ mode: 'vision' })
    expect(npc.vision.autoExplorePatch(SCENE)).toBeNull()
  })
})

describe('the open ground a seat is owed (S3)', () => {
  const frameRing = (w: number, h: number) => [[0, 0], [w, 0], [w, h], [0, h]]
  const inside = (rings: [number, number][][], x: number, y: number) =>
    rings.filter((ring) => pointInPoly(ring, x, y)).length % 2 === 1

  it('stays the frame less the walled floors on a base-ground map', () => {
    for (const [map, w, h] of [[MAP, 30, 20], [readFileSync(join(import.meta.dirname, '../../../testdata/testing-cave.ggvtt'), 'utf8'), 30, 30]] as const) {
      const t = table(map)
      t.setTokens(pc())
      t.setFog({ rooms: { '@outdoors': lit } })
      const scene = t.vision.sceneMapOf(SCENE)!
      const floors = scene.data.layers.flatMap((l) => (l.type === 'dungeon' ? (l.mergedFloor ?? []) : []))
      expect(t.vision.playerMap(SCENE)!.openGround![0].rings).toEqual([frameRing(w, h), ...floors])
    }
  })

  it('on a ground-pieces map, opens only around known ground: not the empty frame, not far rock', () => {
    const map = JSON.parse(withCaveRoom())
    delete map.mapSettings.ground
    const t = table(JSON.stringify(map))
    t.setTokens(pc({ x: 5.5, y: 16.5 }))
    t.setFog({ rooms: { '@outdoors': lit } })
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

// T10 — Outdoors hidden again is fogged fully: shown, sent and walkable only while revealed, or
// By sight where an eye sees it now.
describe('the Outdoors row hidden again (T10)', () => {
  const P1 = { role: 'player' as const, identityId: 'p-1' }
  const hidden = { status: 're_hidden' as const, wasEverRevealed: true }
  const OUT: [number, number] = [13.5, 9.5]

  it('by hand: is shown, sent and walkable only while revealed', () => {
    const { vision, setFog, setTokens } = table()
    setTokens(pc())
    const known = () => vision.visionOf(SCENE, P1)!.openGround!(...OUT)
    setFog({ rooms: { '@outdoors': lit } })
    expect([known(), vision.visibleOf(SCENE), vision.keptRoomsOf(SCENE)!.has('@outdoors')]).toEqual([true, ['@outdoors'], true])
    expect(vision.playerMap(SCENE)!.openGround).toBeDefined()

    setFog({ rooms: { '@outdoors': hidden } })
    expect([known(), vision.visibleOf(SCENE), vision.keptRoomsOf(SCENE)!.has('@outdoors')]).toEqual([false, [], false])
    expect(vision.playerMap(SCENE)!.openGround).toBeUndefined()
  })

  it('by sight: hidden ground is known only where an eye sees it now', () => {
    const { vision, setFog, setTokens } = table()
    const known = () => vision.visionOf(SCENE, P1)!.openGround!(...OUT)
    setFog({ mode: 'vision', rooms: { '@outdoors': hidden } })
    setTokens(pc())
    expect(known()).toBe(true)
    setTokens(pc({ hidden: true }))
    expect(known()).toBe(false)
    setFog({ mode: 'vision', rooms: { '@outdoors': lit } })
    expect(known()).toBe(true)
  })
})
