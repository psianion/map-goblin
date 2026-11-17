// T11 — the DM's fog controls on the Testing map (`testing-cave.ggvtt`), as the live table had
// them: two claimed tokens outside the cave, the cave-kit double door at its mouth open,
// concealment and contained sight on, auto-explore off.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Viewer } from '@dnd/mechanics/contract'
import { doorsModule } from '@dnd/mechanics/doors'
import { fogModule, type FogState, type RoomFog, type SceneFog } from '@dnd/mechanics/fog'
import { SOLID_GROUND, STANDABLE, tokensModule, walkAreas, type Token, type TokensState } from '@dnd/mechanics/tokens'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the walls sight and walk both read
import { resolveWalls } from '@dnd/core/src/shared/wallResolve'
import type { DungeonLayer } from '@dnd/core/src/store/types'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { ModuleRegistry } from '../modules/registry'
import { autoExplore } from './autoExplore'
import { ensureClipperReady } from './clipperBoot'
import { createVision } from './vision'
import { createWalkGrids } from './walk'

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
const CAVE_ENT = '5e1f64a8-4fdc-417a-b7a9-d0e00d196974'
const BLOO = 'd52adfc6-153b-4bf7-9a25-622d02d49d52'
const YELLO = '9d001e8a-71c5-4acd-9b6b-fb55d6473a61'
const GREE = '874a0390-99c8-4033-8d68-cfc2344fba38'
const ROOMS = [CAVE_ENT, BLOO, YELLO, GREE]
const MOUTH_DOOR = 'd2d33a1e-6c90-4c31-9eab-df4672e6d5f3'
const lit: RoomFog = { status: 'revealed', wasEverRevealed: true }
const hidden: RoomFog = { status: 're_hidden', wasEverRevealed: true }

/** The live table: Pim outdoors with a torch, Yara just outside the cave mouth, the mouth door open. */
function table(mode: 'rooms' | 'vision') {
  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Testing')
  stores.maps.insert(SCENE, campaign.id, 'Testing', MAP)
  stores.scenes.create(SCENE, campaign.id, SCENE, 'Testing')
  const vision = createVision(stores)
  const registry = new ModuleRegistry(stores.moduleState, autoExplore(vision))
  registry.register(tokensModule(vision.visionOf))
  registry.register(fogModule(vision.roomsOf, vision.frameOf, vision.roomAtOf, undefined, undefined, (id) => vision.keptRoomsOf(id)))
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
  const fogOf = (): SceneFog => (stores.moduleState.get(campaign.id, 'fog') as FogState).byScene[SCENE]
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
  expect(run('fog', 'set-bulk', { rooms: { '@outdoors': lit, ...Object.fromEntries(ROOMS.map((id) => [id, lit])) } })).toBeNull()
  expect(run('doors', 'toggle', { id: MOUTH_DOOR })).toBeNull()
  if (mode === 'vision') {
    expect(run('fog', 'set-mode', { mode: 'vision' })).toBeNull()
    expect(run('fog', 'set-auto-explore', { autoExplore: false })).toBeNull()
  }
  return { vision, run, fogOf, tokensOf }
}

describe('Hide all, then Reveal all, in By sight (T11 I1)', () => {
  it('still sends the ground a party token stands on and sees', () => {
    const t = table('vision')
    expect(t.vision.playerMap(SCENE)!.openGround).toBeDefined()

    // Hide all forgets the record and, with auto-explore off, writes nothing back…
    const all = Object.fromEntries(Object.keys(t.fogOf().rooms).map((id) => [id, hidden]))
    expect(t.run('fog', 'set-bulk', { rooms: all, forget: true })).toBeNull()
    // …but the tokens still see the ground round them, so it is still sent.
    expect(t.vision.playerMap(SCENE)!.openGround).toBeDefined()

    // A Reveal all from a client that left Outdoors out.
    expect(t.run('fog', 'set-bulk', { rooms: Object.fromEntries(ROOMS.map((id) => [id, lit])) })).toBeNull()
    expect(t.fogOf().rooms['@outdoors']).toBeUndefined()
    expect(t.vision.playerMap(SCENE)!.openGround).toBeDefined()
    // Pim stands on known ground the whole way through.
    expect(t.vision.visionOf(SCENE, { role: 'player', identityId: 'p-1' })!.openGround!(7.5, 22.5)).toBe(true)
  })

  it('sends no open ground while nobody sees any and nothing is known', () => {
    const t = table('vision')
    for (const token of t.tokensOf()) t.run('tokens', 'delete', { id: token.id })
    const all = Object.fromEntries(Object.keys(t.fogOf().rooms).map((id) => [id, hidden]))
    t.run('fog', 'set-bulk', { rooms: all, forget: true })
    expect(t.vision.playerMap(SCENE)!.openGround).toBeUndefined()
  })
})

describe('By hand with conceal behind doors on the Testing map (T11 I3)', () => {
  it('shows every revealed room once the mouth door is open (T12)', () => {
    const t = table('rooms')
    expect([...t.vision.visibleOf(SCENE)!].sort()).toEqual(['@outdoors', ...ROOMS].sort())

    // Why, on the walk grid: the tunnel inside the mouth is under a cell wide at y 17 to 19.
    // Its cells whose centres lie on the cave floor stand, so one walk area runs from outside
    // the mouth into every room.
    const map = t.vision.sceneMapOf(SCENE)!
    const grid = createWalkGrids().gridFor(map, { [MOUTH_DOOR]: { open: true, locked: false, revealed: true } }, undefined, SCENE)!
    const at = (col: number, row: number) => row * grid.cols + col
    for (const [col, row] of [
      [12, 17],
      [14, 17],
      [14, 18],
    ]) {
      expect(grid.cell[at(col, row)], `${col},${row}`).toBe(STANDABLE)
    }
    const labels = walkAreas(grid)
    const mouth = labels[at(15, 19)]
    expect(map.roomAt(15.5, 19.5)).toBe(CAVE_ENT)
    expect(labels[at(7, 22)]).toBe(mouth)
    for (const [room, col, row] of [
      [BLOO, 24, 9],
      [YELLO, 25, 15],
      [GREE, 8, 13],
      [CAVE_ENT, 15, 10],
    ] as const) {
      expect(map.roomAt(col + 0.5, row + 0.5)).toBe(room)
      expect(labels[at(col, row)], room).toBe(mouth)
    }
  })

  it('stands no wall, for walk or sight, on the two sliver contours inside BLOO (T12)', () => {
    const map = table('rooms').vision.sceneMapOf(SCENE)!
    const walls = map.data.layers.flatMap((l) => (l.type === 'dungeon' && l.children ? resolveWalls(l as DungeonLayer) : []))
    expect(walls.some((w) => w.kind === 'cave')).toBe(true)
    const near = (x: number, y: number) => walls.some((w) => w.points.some(([px, py]) => Math.hypot(px - x, py - y) < 0.3))
    expect(near(23.6, 11.07)).toBe(false)
    expect(near(25.96, 10.11)).toBe(false)
  })

  it('walks a player from outside the mouth into Cave Ent., BLOO, YELLO and GREE (T12)', () => {
    const t = table('rooms')
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

  it('recomputes what the party sees on every door and fog change', () => {
    const t = table('rooms')
    expect(t.vision.visibleOf(SCENE)).toContain(CAVE_ENT)
    t.run('doors', 'toggle', { id: MOUTH_DOOR })
    expect(t.vision.visibleOf(SCENE)).not.toContain(CAVE_ENT)
    t.run('doors', 'toggle', { id: MOUTH_DOOR })
    expect(t.vision.visibleOf(SCENE)).toContain(CAVE_ENT)
    t.run('fog', 'hide', { roomId: CAVE_ENT })
    expect(t.vision.visibleOf(SCENE)).not.toContain(CAVE_ENT)
    t.run('fog', 'set-conceal', { concealBehindDoors: false })
    expect([...t.vision.visibleOf(SCENE)!].sort()).toEqual(['@outdoors', BLOO, YELLO, GREE].sort())
  })
})
