// P7: sight, light and memory end at the map's edge. A token one cell in from the frame's
// right edge, with a 12-cell range, sweeps far past it; nothing it earns may lie outside.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { FogState, SceneFog } from '@dnd/mechanics/fog'
import type { Token, TokensState } from '@dnd/mechanics/tokens'
import type { SerializedMapData } from '@dnd/core/src/store/types'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { ensureClipperReady } from './clipperBoot'
import { createVision } from './vision'

beforeAll(async () => {
  expect(await ensureClipperReady()).toBe(true)
}, 30_000)

const read = (name: string): string => readFileSync(join(import.meta.dirname, '../../../testdata', name), 'utf8')
const SCENE = 'scene-edge'
const lit = { status: 'revealed' as const, wasEverRevealed: true }

function table(map: string, fog: Partial<SceneFog>, at: (frame: { maxX: number; minY: number; maxY: number }) => [number, number]) {
  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Edge')
  stores.maps.insert(SCENE, campaign.id, 'Edge', map)
  stores.scenes.create(SCENE, campaign.id, SCENE, 'Edge')
  const put = (f: Partial<SceneFog>) =>
    stores.moduleState.put(campaign.id, 'fog', {
      byScene: { [SCENE]: { rooms: {}, concealBehindDoors: true, mode: 'vision', ...f } },
    } satisfies FogState)
  put(fog)
  const vision = createVision(stores)
  const frame = vision.frameOf(campaign.id, SCENE)!
  const [x, y] = at(frame)
  const pc = {
    id: 'pc',
    name: 'Bram',
    size: 'medium',
    x,
    y,
    ownerId: 'p-1',
    hidden: false,
    sight: { range: 12, angle: 360, visionMode: 'normal' },
  } as Token
  stores.moduleState.put(campaign.id, 'tokens', { library: {}, byScene: { [SCENE]: { pc } } } satisfies TokensState)
  return { vision, frame, put }
}

/** Open outdoor ground on both fixtures: one cell in from the right edge, five down. */
const byTheRightEdge = (f: { maxX: number; minY: number }): [number, number] => [f.maxX - 1.5, f.minY + 5.5]

describe('the map edge (P7)', () => {
  it.each(['testing-cave.ggvtt', 'outdoor-cave.ggvtt'])(
    '%s: a token by the edge records cells up to it and none past it',
    (name) => {
      const { vision, frame } = table(read(name), { rooms: { '@outdoors': lit } }, byTheRightEdge)
      const patch = vision.autoExplorePatch(SCENE)
      expect(patch).not.toBeNull()
      const cols = Math.round(frame.maxX - frame.minX)
      const rows = Math.round(frame.maxY - frame.minY)
      // The sweep did reach the edge: the last column is written…
      expect(patch!.cells.some(([col]) => col === cols - 1)).toBe(true)
      // …and nothing at or past it, on either axis.
      for (const [col, row] of patch!.cells) {
        expect(col).toBeGreaterThanOrEqual(0)
        expect(row).toBeGreaterThanOrEqual(0)
        expect(col).toBeLessThan(cols)
        expect(row).toBeLessThan(rows)
      }
    },
  )

  /** testing-cave with its base ground lifted: ground pieces only, so open ground is grown cells. */
  const piecesOnly = (): string => {
    const map = JSON.parse(read('testing-cave.ggvtt')) as SerializedMapData
    delete map.mapSettings.ground
    return JSON.stringify(map)
  }

  it.each([
    ['testing-cave', () => read('testing-cave.ggvtt')],
    ['outdoor-cave', () => read('outdoor-cave.ggvtt')],
    ['testing-cave, ground pieces only', piecesOnly],
  ])(
    '%s: the open ground a seat is sent never reaches past the frame',
    (_name, map) => {
      const { vision, frame } = table(map(), { rooms: { '@outdoors': lit } }, byTheRightEdge)
      const open = vision.playerMap(SCENE)!.openGround ?? []
      expect(open.length).toBeGreaterThan(0)
      const eps = 1e-6
      for (const entry of open) {
        for (const ring of entry.rings) {
          for (const [x, y] of ring) {
            expect(x).toBeGreaterThanOrEqual(frame.minX - eps)
            expect(y).toBeGreaterThanOrEqual(frame.minY - eps)
            expect(x).toBeLessThanOrEqual(frame.maxX + eps)
            expect(y).toBeLessThanOrEqual(frame.maxY + eps)
          }
        }
      }
    },
  )
})
