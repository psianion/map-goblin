// R3 (rca-live.md): the player's fog is driven by the server's frame. The frame is stamped
// whenever the map has something to hide (rooms, ground pieces or base ground), and only a
// roomless imported picture goes over unframed and unfogged in By hand mode.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { FogState, SceneFog } from '@dnd/mechanics/fog'
import type { Token, TokensState } from '@dnd/mechanics/tokens'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { ensureClipperReady } from './clipperBoot'
import { createVision } from './vision'

beforeAll(async () => {
  expect(await ensureClipperReady()).toBe(true)
}, 30_000)

const read = (name: string): string => readFileSync(join(import.meta.dirname, '../../../testdata', name), 'utf8')
const SCENE = 'scene-frame'

function table(map: string, fog: Partial<SceneFog> = {}, token?: Partial<Token>) {
  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Frame')
  stores.maps.insert(SCENE, campaign.id, 'Frame', map)
  stores.scenes.create(SCENE, campaign.id, SCENE, 'Frame')
  stores.moduleState.put(campaign.id, 'fog', {
    byScene: { [SCENE]: { rooms: {}, concealBehindDoors: true, ...fog } },
  } satisfies FogState)
  if (token) {
    const pc = { id: 'pc', name: 'Bram', size: 'medium', x: 15.5, y: 9.5, ownerId: 'p-1', hidden: false, ...token } as Token
    stores.moduleState.put(campaign.id, 'tokens', { library: {}, byScene: { [SCENE]: { pc } } } satisfies TokensState)
  }
  return createVision(stores)
}

/** outdoor-cave with its rooms taken away, and optionally its ground too: an imported picture. */
function roomless(ground: boolean): string {
  const map = JSON.parse(read('outdoor-cave.ggvtt')) as SerializedMapData
  const layer = map.layers.find((l) => l.type === 'dungeon') as DungeonLayer
  layer.rooms = []
  layer.children = layer.children
    .filter((c) => ground || !(c.childType === 'shape' && c.ground))
    .map((c) => (c.childType === 'door' ? { ...c, roomA: null, roomB: null } : c))
  if (!ground) delete map.mapSettings.ground
  return JSON.stringify(map)
}

describe('the frame (R3)', () => {
  it('veils testing-cave whole at Start dark: framed, no room, terrain only', () => {
    const player = table(read('testing-cave.ggvtt')).playerMap(SCENE)!
    expect(player.frame).toEqual({ minX: 0, minY: 0, maxX: 30, maxY: 30 })
    const layer = player.layers.find((l) => l.type === 'dungeon') as DungeonLayer
    expect(layer.rooms).toEqual([])
    expect(layer.children.every((c) => c.childType === 'plateau' || (c.childType === 'shape' && c.ground))).toBe(true)
  })

  it('frames a roomless map with ground, and fogs it by hand through its Outdoors row', () => {
    const dark = table(roomless(true))
    expect(dark.playerMap(SCENE)!.frame).toBeTruthy()
    expect(dark.visionOf(SCENE)).not.toBeNull()
    // The doors of a roomless map with ground are cut like any other's, not handed over.
    expect(JSON.stringify(dark.playerMap(SCENE))).not.toContain('door-hall')
    // A party token put down reveals the Outdoors row it stands in.
    expect(table(roomless(true), {}, {}).partyHerePatch(SCENE)).toEqual({ sceneId: SCENE, rooms: ['@outdoors'] })
    const lit = { status: 'revealed' as const, wasEverRevealed: true }
    const outside = table(roomless(true), { rooms: { '@outdoors': lit } }, {})
    expect(outside.visionOf(SCENE)!.visible.has('@outdoors')).toBe(true)
    expect(outside.playerMap(SCENE)!.openGround).toBeTruthy()
  })

  it('leaves an imported picture unframed and unfogged in By hand mode', () => {
    const picture = table(roomless(false))
    expect(picture.playerMap(SCENE)!.frame).toBeUndefined()
    expect(picture.visionOf(SCENE)).toBeNull()
  })
})
