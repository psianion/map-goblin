// The fog rework on real maps: the cleared record per level, the brush's floor rule, and (as
// the rules move over) sight, what a player is sent and where they may move.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Viewer } from '@dnd/mechanics/contract'
import { doorsModule } from '@dnd/mechanics/doors'
import { fogModule, getCell, type FogState, type SceneFog } from '@dnd/mechanics/fog'
import { tokensModule, type Token, type TokensState } from '@dnd/mechanics/tokens'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { ModuleRegistry } from '../modules/registry'
import { autoExplore } from './autoExplore'
import { ensureClipperReady } from './clipperBoot'
import { createVision } from './vision'

beforeAll(async () => {
  expect(await ensureClipperReady()).toBe(true)
}, 30_000)

const fixture = (name: string) => readFileSync(join(import.meta.dirname, '../../../testdata', name), 'utf8')
const TWO_LEVELS = fixture('two-levels.ggvtt')

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
})
