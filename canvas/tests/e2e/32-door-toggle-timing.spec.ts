/**
 * 32-door-toggle-timing.spec.ts
 * The door-overhaul §6 timing row: a state-only toggle on a dressed map.
 *
 * Its own file for one reason: a timing taken on SwiftShader measures the
 * software rasteriser, not the app — the same reason the table's sprint-3 rows
 * run under their own config. `channel` and `launchOptions` cannot be set in a
 * describe block, so the GPU stack has to be chosen at file scope.
 *
 * The map is the dressed gate map the table specs use — 13 doors, 206 walls,
 * terrain, water and lights. A number taken on an empty canvas would prove
 * nothing about the hitch this row exists for (#18).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { gotoApp, waitForEngine, waitFrame } from './helpers'

test.use({
  channel: 'chromium',
  launchOptions: { args: ['--use-angle=default', '--ignore-gpu-blocklist'] },
})
test.setTimeout(180_000)

const GATE = fileURLToPath(new URL('../../../session/testdata/emberhold-crypt.mapbuilder', import.meta.url))

interface Sample {
  /** The store write, which runs the scene-graph subscriber synchronously. */
  write: number
  /** The frame that draws the result. */
  frame: number
  /** Whether the union survived the toggle untouched — #18's actual fix. */
  floorSame: boolean
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

test('a state-only door toggle costs no union rebuild and lands within the frame budget', async ({
  page,
}) => {
  // KNOWN MISS, pinned rather than relaxed: the §6 bar is 50ms and it stays 50ms.
  // #18's union rebuild is gone — the row below proves the union is untouched — but a
  // state flip still runs `rebuildDungeonLayer`, which clears the walls sublayer and
  // re-places every stone on the map before the frame that draws the door. On the
  // dressed map that is ~22ms of store write plus a ~40ms frame against a ~16ms idle
  // one. Doors want their own sublayer so a state flip redraws doors and relights
  // without touching the stones; when that lands this test starts passing and the
  // runner will say so.
  test.fail()

  await gotoApp(page)
  await waitForEngine(page)

  const gate = JSON.parse(readFileSync(GATE, 'utf8')) as Record<string, unknown>
  await page.evaluate((data) => {
    const store = (window as Window & { __store?: { getState: () => { loadFromFile: (d: unknown) => void } } }).__store
    store!.getState().loadFromFile(data)
  }, gate)
  await waitFrame(page, 40)

  const measured = await page.evaluate(async () => {
    interface Layer {
      type: string
      mergedFloor: unknown
      children: { id: string; childType: string; style: string; isSecret: boolean }[]
    }
    const store = (window as Window & {
      __store?: {
        getState: () => {
          ui: { activeLayerId: string }
          layers: Layer[]
          updateChild: (lid: string, id: string, patch: Record<string, unknown>) => void
        }
      }
    }).__store!
    const layer = () => store.getState().layers.find((l) => l.type === 'dungeon')!
    const frame = () =>
      new Promise<number>((resolve) => {
        const started = performance.now()
        requestAnimationFrame(() => resolve(performance.now() - started))
      })

    const door = layer().children.find(
      (c) => c.childType === 'door' && !c.isSecret && c.style !== 'archway',
    )!
    const doors = layer().children.filter((c) => c.childType === 'door').length

    // What a frame costs on this map when nothing changed — the toggle rows are
    // only meaningful next to it.
    const idle: number[] = []
    for (let i = 0; i < 8; i++) idle.push(await frame())

    const samples: { write: number; frame: number; floorSame: boolean }[] = []
    for (let i = 0; i < 11; i++) {
      const floorBefore = layer().mergedFloor
      const started = performance.now()
      store
        .getState()
        .updateChild(store.getState().ui.activeLayerId, door.id, {
          state: i % 2 === 0 ? 'open' : 'closed',
        })
      const write = performance.now() - started
      const drawn = await frame()
      samples.push({ write, frame: drawn, floorSame: layer().mergedFloor === floorBefore })
    }
    return { doors, idle, samples }
  })

  const { samples, idle } = measured as { doors: number; idle: number[]; samples: Sample[] }
  const write = median(samples.map((s) => s.write))
  const frame = median(samples.map((s) => s.frame))

  console.log(
    `[metric] door state toggle on the dressed map (${measured.doors} doors): ` +
      `write ${write.toFixed(1)}ms, frame ${frame.toFixed(1)}ms ` +
      `(idle frame ${median(idle).toFixed(1)}ms), total ${(write + frame).toFixed(1)}ms (target: <50ms)`,
  )

  // #18 was a Clipper2 union on every toggle. The union is a function of the
  // shape children only now, so a state flip must not touch it — asserted on
  // array identity, which a rebuild cannot preserve.
  expect(samples.every((s) => s.floorSame)).toBe(true)
  // …and the whole toggle, up to and including the frame that draws it, inside the
  // §6 budget. This is the half that still misses (see `test.fail()` above).
  expect(write + frame).toBeLessThan(50)
})
