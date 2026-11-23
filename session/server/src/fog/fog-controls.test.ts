// T11 — the Testing map (`testing-cave.ggvtt`) as the live table had it: two claimed tokens
// outside the cave, the cave-kit double door at its mouth open.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Viewer } from '@dnd/mechanics/contract'
import { doorsModule } from '@dnd/mechanics/doors'
import { fogModule } from '@dnd/mechanics/fog'
import { SOLID_GROUND, tokensModule, type Token, type TokensState } from '@dnd/mechanics/tokens'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the walls sight and walk both read
import { resolveWalls } from '@dnd/core/src/shared/wallResolve'
import type { DungeonLayer } from '@dnd/core/src/store/types'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { ModuleRegistry } from '../modules/registry'
import { autoExplore } from './autoExplore'
import { ensureClipperReady } from './clipperBoot'
import { createVision } from './vision'

beforeAll(async () => {
  expect(await ensureClipperReady()).toBe(true)
}, 30_000)

const MAP = readFileSync(join(import.meta.dirname, '../../../testdata/testing-cave.ggvtt'), 'utf8')
const SCENE = 'scene-testing'
const DM: Viewer = { role: 'dm', identityId: 'dm-1' }
const ROSTER = [
  { identityId: 'dm-1', name: 'Ayla', role: 'dm' as const, connected: true },
  { identityId: 'p-1', name: 'Pim', role: 'player' as const, connected: true },
  { identityId: 'p-2', name: 'Yara', role: 'player' as const, connected: true },
]
const MOUTH_DOOR = 'd2d33a1e-6c90-4c31-9eab-df4672e6d5f3'

/** The live table: Pim outdoors with a torch, Yara just outside the cave mouth, the mouth door open. */
function table() {
  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Testing')
  stores.maps.insert(SCENE, campaign.id, 'Testing', MAP)
  stores.scenes.create(SCENE, campaign.id, SCENE, 'Testing')
  const vision = createVision(stores)
  const registry = new ModuleRegistry(stores.moduleState, autoExplore(vision))
  registry.register(tokensModule(vision.visionOf))
  registry.register(fogModule(vision.frameOf, vision.levelsOf, vision.floorOnOf))
  registry.register(doorsModule(vision.doorsOf, vision.playerDoors))
  const run = (module: string, action: string, payload: object, sender: Viewer = DM) =>
    registry.dispatch(module, action, { sceneId: SCENE, ...payload }, {
      campaignId: campaign.id,
      sessionId: 's-1',
      activeSceneId: SCENE,
      sender,
      players: ROSTER,
      broadcast: () => {},
    })
  const tokensOf = (): Token[] => Object.values((stores.moduleState.get(campaign.id, 'tokens') as TokensState).byScene[SCENE])

  const pim: Partial<Token> = {
    sight: { range: 6, angle: 360, visionMode: 'normal' },
    light: { dim: 8, bright: 4, color: '#ffbb66', angle: 360 } as Token['light'],
  }
  const yara: Partial<Token> = { sight: { range: 6, angle: 360, visionMode: 'darkvision' } }
  for (const [name, x, y, owner, over] of [
    ['Pim', 7.5, 22.5, 'p-1', pim],
    ['Yara', 18.5, 23.5, 'p-2', yara],
  ] as const) {
    expect(run('tokens', 'place', { name, kind: 'pc', x, y })).toBeNull()
    const id = tokensOf().find((t) => t.name === name)!.id
    expect(run('tokens', 'update', { id, ...over })).toBeNull()
    expect(run('tokens', 'assign', { id, identityId: owner })).toBeNull()
  }
  expect(run('doors', 'toggle', { id: MOUTH_DOOR })).toBeNull()
  return { vision, run, tokensOf }
}

describe('the cave on the Testing map (T11 I3)', () => {

  it('stands no wall, for walk or sight, on the two sliver contours inside BLOO (T12)', () => {
    const map = table().vision.sceneMapOf(SCENE)!
    const walls = map.data.layers.flatMap((l) => (l.type === 'dungeon' && l.children ? resolveWalls(l as DungeonLayer) : []))
    expect(walls.some((w) => w.kind === 'cave')).toBe(true)
    const near = (x: number, y: number) => walls.some((w) => w.points.some(([px, py]) => Math.hypot(px - x, py - y) < 0.3))
    expect(near(23.6, 11.07)).toBe(false)
    expect(near(25.96, 10.11)).toBe(false)
  })

  it('walks a player from outside the mouth into Cave Ent., BLOO, YELLO and GREE (T12)', () => {
    const t = table()
    const yara = t.tokensOf().find((tk) => tk.name === 'Yara')!
    const P2: Viewer = { role: 'player', identityId: 'p-2' }
    // The mouth, Cave Ent., BLOO, YELLO and GREE, each walked to from the last.
    for (const [x, y] of [
      [15.5, 19.5],
      [15.5, 10.5],
      [24.5, 9.5],
      [25.5, 15.5],
      [8.5, 13.5],
    ]) {
      expect(t.run('tokens', 'move', { id: yara.id, x, y }, P2), `${x},${y}`).toBeNull()
    }
    // Standing in the drawn rock is still refused: this centre lies outside the floor, under the rock.
    expect(JSON.stringify(t.run('tokens', 'move', { id: yara.id, x: 12.5, y: 18.5 }, P2))).toContain(SOLID_GROUND)
  })

})
