// The fog rework on real maps: the cleared record per level, the brush's floor rule, and (as
// the rules move over) sight, what a player is sent and where they may move.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Viewer } from '@dnd/mechanics/contract'
import { doorsModule } from '@dnd/mechanics/doors'
import { fogModule, getCell, type FogState, type SceneFog } from '@dnd/mechanics/fog'
import { tokensModule, type Token, type TokensState } from '@dnd/mechanics/tokens'
import { triggersModule } from '@dnd/mechanics/triggers'
import type { AnyChild } from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { ModuleRegistry } from '../modules/registry'
import { createTriggerDeps } from '../triggers/prepResolver'
import { autoExplore } from './autoExplore'
import { ensureClipperReady } from './clipperBoot'
import { createVision } from './vision'

beforeAll(async () => {
  expect(await ensureClipperReady()).toBe(true)
}, 30_000)

const fixture = (name: string) => readFileSync(join(import.meta.dirname, '../../../testdata', name), 'utf8')
const TWO_LEVELS = fixture('two-levels.ggvtt')
const TWO_ROOMS = fixture('vision-two-rooms.mapbuilder')
const OUTDOOR_CAVE = fixture('outdoor-cave.ggvtt')

/** A map with extra children on its first dungeon layer. */
function withChildren(map: string, children: AnyChild[]): string {
  const data = JSON.parse(map) as SerializedMapData
  const layer = data.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!
  layer.children = [...(layer.children ?? []), ...children]
  return JSON.stringify(data)
}

const DM: Viewer = { role: 'dm', identityId: 'dm-1' }
const ROSTER = [
  { identityId: 'dm-1', name: 'Ayla', role: 'dm' as const, connected: true },
  { identityId: 'p-1', name: 'Pim', role: 'player' as const, connected: true },
]

/** A table on one map, wired the way index.ts wires the fog, tokens and doors modules. */
function table(map: string, scene = 'scene-1') {
  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Fog')
  stores.maps.insert(scene, campaign.id, 'Map', map)
  stores.scenes.create(scene, campaign.id, scene, 'Map')
  const vision = createVision(stores)
  const registry = new ModuleRegistry(stores.moduleState, autoExplore(vision))
  registry.register(tokensModule(vision.visionOf, vision.levelFilterOf))
  registry.register(
    fogModule(
      vision.roomsOf,
      vision.frameOf,
      vision.roomAtOf,
      (id) => vision.visibleOf(id),
      vision.groundAtOf,
      (id) => vision.keptRoomsOf(id),
      vision.levelsOf,
      vision.floorOnOf,
    ),
  )
  registry.register(doorsModule(vision.doorsOf, vision.playerDoors))
  registry.register(triggersModule(createTriggerDeps(stores, vision.sceneMapOf)))
  const run = (module: string, action: string, payload: object, sender: Viewer = DM) =>
    registry.dispatch(module, action, { sceneId: scene, ...payload }, {
      campaignId: campaign.id,
      sessionId: 's-1',
      activeSceneId: scene,
      sender,
      players: ROSTER,
      broadcast: () => {},
    })
  const fog = (): SceneFog => (stores.moduleState.get(campaign.id, 'fog') as FogState | undefined)?.byScene[scene] ?? { rooms: {}, concealBehindDoors: true }
  const tokens = (): Token[] => Object.values((stores.moduleState.get(campaign.id, 'tokens') as TokensState | undefined)?.byScene[scene] ?? {})
  const cleared = (levelId: string, x: number, y: number): boolean => {
    const mask = fog().cleared?.[levelId]
    return !!mask && getCell(mask, Math.floor(x - mask.minX), Math.floor(y - mask.minY))
  }
  return { stores, campaign, vision, registry, run, fog, tokens, cleared, scene }
}

describe('the brush on the two-level map', () => {
  it('clears the named level only, over ground both levels share (row 3)', () => {
    const t = table(TWO_LEVELS)
    // (9, 6) is inside both the cellar and the loft.
    expect(t.run('fog', 'region-set', { levelId: 'lvl-low', op: 'clear', cells: [[9, 6], [4, 6]] })).toBeNull()
    expect(t.cleared('lvl-low', 9.5, 6.5)).toBe(true)
    expect(t.cleared('lvl-low', 4.5, 6.5)).toBe(true)
    expect(t.fog().cleared?.['lvl-high']).toBeUndefined()
  })

  it('opens only the floor of the level it paints, plus the band beside it (row 4)', () => {
    const t = table(TWO_LEVELS)
    // x 14 is loft floor only; x 12 is the cellar's one-cell band; x 18 is nobody's floor.
    expect(t.run('fog', 'region-set', { levelId: 'lvl-low', op: 'clear', cells: [[14, 6], [12, 6], [18, 6]] })).toBeNull()
    expect(t.cleared('lvl-low', 14.5, 6.5)).toBe(false)
    expect(t.cleared('lvl-low', 12.5, 6.5)).toBe(true)
    expect(t.cleared('lvl-low', 18.5, 6.5)).toBe(false)
    expect(t.run('fog', 'region-set', { levelId: 'lvl-high', op: 'clear', cells: [[14, 6]] })).toBeNull()
    expect(t.cleared('lvl-high', 14.5, 6.5)).toBe(true)
  })

  it('knows the map’s levels', () => {
    const t = table(TWO_LEVELS)
    expect(t.vision.levelsOf(t.campaign.id, t.scene)).toEqual(['lvl-low', 'lvl-high'])
    expect(t.run('fog', 'region-set', { levelId: 'lvl-attic', op: 'clear', cells: [] })).toMatchObject({ code: 'invalid-command' })
  })

  it('names the one level of a map stored before levels the same way on every read', () => {
    const t = table(TWO_ROOMS)
    expect(t.vision.levelsOf(t.campaign.id, t.scene)).toEqual(['level-1'])
    t.vision.invalidateScene(t.scene)
    expect(t.vision.levelsOf(t.campaign.id, t.scene)).toEqual(['level-1'])
    expect(t.vision.sceneMapOf(t.scene)!.data.layers.every((l) => l.levelId === 'level-1')).toBe(true)
  })
})

/** The DM places a PC (an eye whether or not anyone claims it) and returns its id. */
function placePc(t: ReturnType<typeof table>, x: number, y: number, over: Partial<Token> = {}): string {
  const before = new Set(t.tokens().map((tk) => tk.id))
  expect(t.run('tokens', 'place', { name: 'Bram', kind: 'pc', x, y, ...over })).toBeNull()
  return t.tokens().find((tk) => !before.has(tk.id))!.id
}

/** The one level of a single-level map. */
const onlyLevel = (t: ReturnType<typeof table>): string => t.vision.levelsOf(t.campaign.id, t.scene)[0]

const lamp = (id: string, x: number, y: number, radius: number): AnyChild =>
  ({
    id,
    name: id,
    childType: 'light',
    visible: true,
    color: '#ffcc88',
    radius,
    featherRadius: 0.5,
    intensity: 1,
    falloff: 'quadratic',
    position: { x, y },
  }) as AnyChild

describe('Auto-explore (rows 7 to 10, 16)', () => {
  it('7: a moved PC clears what it sees; the wall and a closed door block; opening the door clears beyond it', () => {
    const t = table(TWO_ROOMS)
    const level = onlyLevel(t)
    expect(t.run('fog', 'set-on', { on: true })).toBeNull()
    const id = placePc(t, 2.5, 5.5)
    expect(t.cleared(level, 2.5, 5.5)).toBe(true)
    expect(t.run('tokens', 'move', { id, x: 5.5, y: 5.5 })).toBeNull()
    expect(t.cleared(level, 9.5, 8.5)).toBe(true)
    // East of the wall, through the shut door: nothing.
    expect(t.cleared(level, 14.5, 5.5)).toBe(false)
    expect(t.cleared(level, 14.5, 1.5)).toBe(false)
    expect(t.run('doors', 'toggle', { id: 'door-mid' })).toBeNull()
    expect(t.cleared(level, 14.5, 5.5)).toBe(true)
    // …and it stays cleared once the door shuts again.
    expect(t.run('doors', 'toggle', { id: 'door-mid' })).toBeNull()
    expect(t.cleared(level, 14.5, 5.5)).toBe(true)
  })

  it('8: a token with range 6 clears to 6 cells and no further; an unset range clears to 12', () => {
    const six = table(OUTDOOR_CAVE)
    expect(six.run('fog', 'set-on', { on: true })).toBeNull()
    placePc(six, 5.5, 16.5, { sight: { range: 6, angle: 360, visionMode: 'normal' } })
    expect(six.cleared('lvl-1', 10.5, 16.5)).toBe(true)
    expect(six.cleared('lvl-1', 12.5, 16.5)).toBe(false)

    const twelve = table(OUTDOOR_CAVE)
    expect(twelve.run('fog', 'set-on', { on: true })).toBeNull()
    placePc(twelve, 5.5, 16.5)
    expect(twelve.cleared('lvl-1', 16.5, 16.5)).toBe(true)
    expect(twelve.cleared('lvl-1', 18.5, 16.5)).toBe(false)
  })

  it('8: a carried torch does not carry sight past the token’s own range', () => {
    const t = table(OUTDOOR_CAVE)
    expect(t.run('fog', 'set-on', { on: true })).toBeNull()
    placePc(t, 5.5, 16.5, {
      sight: { range: 2, angle: 360, visionMode: 'normal' },
      light: { dim: 8, bright: 4, color: '#ffbb66', angle: 360 } as Token['light'],
    })
    expect(t.cleared('lvl-1', 6.5, 16.5)).toBe(true)
    expect(t.cleared('lvl-1', 9.5, 16.5)).toBe(false)
  })

  it('9: in the dark a token clears lit ground within range, and unlit ground only with darkvision', () => {
    const t = table(withChildren(TWO_ROOMS, [lamp('lamp-west', 1.5, 5.5, 2)]))
    const level = onlyLevel(t)
    expect(t.run('fog', 'set-on', { on: true })).toBeNull()
    expect(t.run('triggers', 'set-darkness', { value: 1 })).toBeNull()
    placePc(t, 5.5, 5.5, { sight: { range: 8, angle: 360, visionMode: 'normal' } })
    expect(t.cleared(level, 1.5, 5.5)).toBe(true)
    expect(t.cleared(level, 8.5, 5.5)).toBe(false)

    const far = table(withChildren(TWO_ROOMS, [lamp('lamp-west', 1.5, 5.5, 2)]))
    expect(far.run('fog', 'set-on', { on: true })).toBeNull()
    expect(far.run('triggers', 'set-darkness', { value: 1 })).toBeNull()
    // The lamp's pool is six cells off, past a range of three: lit, but out of sight.
    placePc(far, 7.5, 5.5, { sight: { range: 3, angle: 360, visionMode: 'normal' } })
    expect(far.cleared(onlyLevel(far), 1.5, 5.5)).toBe(false)

    const dv = table(TWO_ROOMS)
    expect(dv.run('fog', 'set-on', { on: true })).toBeNull()
    expect(dv.run('triggers', 'set-darkness', { value: 1 })).toBeNull()
    placePc(dv, 5.5, 5.5, { sight: { range: 3, angle: 360, visionMode: 'darkvision' } })
    expect(dv.cleared(onlyLevel(dv), 7.5, 5.5)).toBe(true)
    expect(dv.cleared(onlyLevel(dv), 9.5, 5.5)).toBe(false)
  })

  it('10: with Auto-explore off, or fog off, moving a PC clears nothing', () => {
    const off = table(TWO_ROOMS)
    expect(off.run('fog', 'set-on', { on: true })).toBeNull()
    expect(off.run('fog', 'set-auto-explore', { autoExplore: false })).toBeNull()
    const id = placePc(off, 5.5, 5.5)
    expect(off.run('tokens', 'move', { id, x: 6.5, y: 5.5 })).toBeNull()
    expect(off.fog().cleared).toBeUndefined()
    // Switching it back on clears what the party sees now, with no step needed.
    expect(off.run('fog', 'set-auto-explore', { autoExplore: true })).toBeNull()
    expect(off.cleared(onlyLevel(off), 6.5, 5.5)).toBe(true)

    const unfogged = table(TWO_ROOMS)
    placePc(unfogged, 5.5, 5.5)
    expect(unfogged.fog().cleared).toBeUndefined()
  })

  it('16: never clears an explore-lock zone, which the brush still can', () => {
    const zone = {
      id: 'zone-lock',
      name: 'Sealed alcove',
      childType: 'zone',
      visible: true,
      shape: { kind: 'rect', x: 7, y: 7, width: 3, height: 3 },
      blocksAutoExplore: true,
    } as AnyChild
    const t = table(withChildren(TWO_ROOMS, [zone]))
    const level = onlyLevel(t)
    expect(t.run('fog', 'set-on', { on: true })).toBeNull()
    placePc(t, 3.5, 3.5)
    expect(t.cleared(level, 5.5, 5.5)).toBe(true)
    expect(t.cleared(level, 8.5, 8.5)).toBe(false)
    const frame = t.vision.frameOf(t.campaign.id, t.scene)!
    const cell = [Math.floor(8.5 - frame.minX), Math.floor(8.5 - frame.minY)]
    expect(t.run('fog', 'region-set', { levelId: level, op: 'clear', cells: [cell] })).toBeNull()
    expect(t.cleared(level, 8.5, 8.5)).toBe(true)
  })

  it('writes nothing when a step earns nothing new', () => {
    const t = table(TWO_ROOMS)
    expect(t.run('fog', 'set-on', { on: true })).toBeNull()
    const id = placePc(t, 5.5, 5.5)
    const settled = t.fog()
    expect(t.vision.autoExplorePatch(t.scene)).toBeNull()
    expect(t.run('tokens', 'move', { id, x: 5.5, y: 5.5 })).toBeNull()
    expect(t.fog()).toEqual(settled)
  })

  it('clears each level from the eyes standing on it', () => {
    const t = table(TWO_LEVELS)
    expect(t.run('fog', 'set-on', { on: true })).toBeNull()
    const id = placePc(t, 9.5, 6.5)
    expect(t.run('tokens', 'set-token-level', { id, levelId: 'lvl-high' })).toBeNull()
    expect(t.cleared('lvl-high', 14.5, 6.5)).toBe(true)
    // The cellar keeps only what the PC saw before it climbed.
    expect(t.cleared('lvl-low', 14.5, 6.5)).toBe(false)
  })
})
