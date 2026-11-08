// Shared by the lighting specs (lighting-render, environment-light): the goblin warren under a
// frozen clock, a light added by store as the Light tool would write it, and the mean
// brightness of a small box on the canvas. Pixel checks compare two states of the same box,
// never an absolute value, so a palette tweak moves both sides.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'
import { waitForBoot, waitFrame } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Any = any

const WARREN = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../session/testdata/goblin-warren.mapbuilder', import.meta.url)), 'utf8'),
)

export const NOON = 720
export const NIGHT = 120

export async function inPage<T>(page: Page, fn: string, arg?: unknown): Promise<T> {
  return page.evaluate(
    ({ fn, arg }) => {
      const w = window as Any
      const s = () => w.__store.getState()
      const layer = () => s().layers.find((l: Any) => l.id === s().ui.activeLayerId && l.type === 'dungeon')
      const world = () => w.__pixiApp.stage.children[0]
      const w2s = (x: number, y: number) => {
        const r = w.__pixiApp.canvas.getBoundingClientRect()
        const wd = world()
        return { x: r.left + x * wd.scale.x + wd.position.x, y: r.top + y * wd.scale.x + wd.position.y }
      }
      return new Function('s', 'layer', 'w2s', 'arg', `return (${fn})(s, layer, w2s, arg)`)(s, layer, w2s, arg)
    },
    { fn, arg },
  )
}

/** The editor under a freeze at `minutes`, the lit preview as asked, on a fresh copy of the warren. */
export async function openWarren(page: Page, minutes = NOON, lit = true): Promise<void> {
  await page.addInitScript((lit) => localStorage.setItem('mapbuilder-lit-preview', lit ? '1' : '0'), lit)
  await page.goto(`/?e2e=1&freeze=${minutes}`)
  await waitForBoot(page)
  await page.getByTestId('v2-new-map-card').click()
  await page.getByTestId('v2-new-map-submit').click()
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(async (data) => {
    const st = (window as Any).__store.getState()
    st.loadFromFile(structuredClone(data))
    st.setRoomsSheetOpen(false)
    st.setSelectedIds([])
    st.setFocusMode('manual')
    await st.saveCurrentMap()
  }, WARREN)
  await page.waitForFunction(() => {
    const s = (window as Any).__store.getState()
    const l = s.layers.find((x: Any) => x.type === 'dungeon')
    return (l?.rooms ?? []).length > 0 && l.rooms.every((r: Any) => Array.isArray(r.face) && r.face.length > 2)
  })
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const l = st.layers.find((x: Any) => x.type === 'dungeon')
    st.setActiveLayerId(l.id)
    st.setActiveTool('select')
  })
  await page.getByRole('button', { name: 'Fit' }).click()
  await waitFrame(page, 6)
}

/** Every authored light off, and the map underground, so a test's own light is the only one. */
export async function darkStage(page: Page, environment = 'underground'): Promise<void> {
  await page.evaluate((environment) => {
    const st = (window as Any).__store.getState()
    for (const l of st.layers) {
      if (l.type !== 'dungeon') continue
      for (const c of l.children) if (c.childType === 'light') st.updateChild(l.id, c.id, { visible: false })
    }
    st.setEnvironmentSettings({ environment, naturalLight: false })
  }, environment)
  await waitFrame(page, 4)
}

let seq = 0
/** A light on the active layer, as the Light tool would write it, by store. */
export async function addLight(page: Page, at: { x: number; y: number }, patch: Record<string, unknown> = {}): Promise<string> {
  const id = `qa-light-${++seq}`
  await page.evaluate(
    ({ id, at, patch }) => {
      const st = (window as Any).__store.getState()
      st.addChild(st.ui.activeLayerId, {
        id,
        name: id,
        childType: 'light',
        visible: true,
        color: '#ffb561',
        radius: 8,
        featherRadius: 4,
        intensity: 0.9,
        falloff: 'quadratic',
        position: at,
        ...patch,
      })
    },
    { id, at, patch },
  )
  await waitFrame(page, 4)
  return id
}

export const roomAnchor = (page: Page, name: string) =>
  inPage<{ x: number; y: number }>(page, `(s, layer, w2s, name) => { const r = layer().rooms.find((x) => x.name === name); return { x: r.anchor[0], y: r.anchor[1] } }`, name)

/** Bare floor just above a room's anchor: the anchor itself carries the room's label chip, drawn over the lighting. */
export const floorNear = (anchor: { x: number; y: number }) => ({ x: anchor.x, y: anchor.y - 1.5 })

export const lightOf = (page: Page, id: string) => inPage<Any>(page, `(s, layer, w2s, id) => layer().children.find((c) => c.id === id)`, id)

export const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

export const undo = async (page: Page) => {
  await blur(page)
  await page.keyboard.press('Control+z')
  await waitFrame(page, 3)
}

/** Picks the ids with Select in hand, so the slot shows their card. */
export async function select(page: Page, ids: string[]): Promise<void> {
  await page.evaluate((ids) => {
    const st = (window as Any).__store.getState()
    st.setActiveTool('select')
    st.setSelectedIds(ids)
  }, ids)
  await waitFrame(page, 3)
}

/** The status bar's lit chip. */
export const litChip = (page: Page) => page.getByTestId('shell-status').getByRole('button', { name: /^Lit/ })

/** Mean brightness (0..255) of a box `half` CSS px around world point `p`. */
export async function lum(page: Page, p: { x: number; y: number }, half = 4): Promise<number> {
  await waitFrame(page, 3)
  return page.evaluate(
    ({ p, half }) => {
      const w = window as Any
      const gl = w.__pixiApp.canvas as HTMLCanvasElement
      const r = gl.getBoundingClientRect()
      const wd = w.__pixiApp.stage.children[0]
      const sx = p.x * wd.scale.x + wd.position.x
      const sy = p.y * wd.scale.x + wd.position.y
      const k = gl.width / r.width
      const size = Math.max(1, Math.round(2 * half * k))
      const c = document.createElement('canvas')
      c.width = size
      c.height = size
      const ctx = c.getContext('2d')!
      ctx.drawImage(gl, (sx - half) * k, (sy - half) * k, size, size, 0, 0, size, size)
      const d = ctx.getImageData(0, 0, size, size).data
      let sum = 0
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      return sum / (d.length / 4)
    },
    { p, half },
  )
}

/** Flip the Lit preview (key I). */
export async function toggleLit(page: Page): Promise<void> {
  await blur(page)
  await page.keyboard.press('i')
  await waitFrame(page, 4)
}

/**
 * A point of bare sheet inside the map's frame: the centre of a box of plain paper between
 * the rooms, read with the Lit preview off. `clear` is the CSS px the paper has to run on
 * around the point. The grid's dots run on across the sheet, so they are switched off first.
 */
export async function bareSheet(page: Page, clear = 14): Promise<{ x: number; y: number }> {
  await page.evaluate(() => (window as Any).__store.getState().setGridVisible(false))
  await waitFrame(page, 4)
  const found = await page.evaluate((clear) => {
    const w = window as Any
    const s = w.__store.getState()
    const layer = s.layers.find((l: Any) => l.id === s.ui.activeLayerId)
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
    for (const r of layer.rooms) {
      for (const [x, y] of r.face) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
    const css = getComputedStyle(document.documentElement).getPropertyValue('--sheet').trim() || '#fbfbfb'
    const sheet = parseInt(css.replace('#', ''), 16)
    const paper = [(sheet >> 16) & 0xff, (sheet >> 8) & 0xff, sheet & 0xff]
    const gl = w.__pixiApp.canvas as HTMLCanvasElement
    const rect = gl.getBoundingClientRect()
    const k = gl.width / rect.width
    const c = document.createElement('canvas')
    c.width = gl.width
    c.height = gl.height
    const ctx = c.getContext('2d')!
    ctx.drawImage(gl, 0, 0)
    const data = ctx.getImageData(0, 0, c.width, c.height).data
    const wd = w.__pixiApp.stage.children[0]
    const isPaper = (px: number, py: number): boolean => {
      const i = (Math.round(py) * c.width + Math.round(px)) * 4
      return Math.abs(data[i] - paper[0]) <= 1 && Math.abs(data[i + 1] - paper[1]) <= 1 && Math.abs(data[i + 2] - paper[2]) <= 1
    }
    for (let y = minY + 1; y <= maxY - 1; y += 0.5) {
      for (let x = minX + 1; x <= maxX - 1; x += 0.5) {
        const sx = (x * wd.scale.x + wd.position.x) * k
        const sy = (y * wd.scale.x + wd.position.y) * k
        const r = clear * k
        if (sx - r < 0 || sy - r < 0 || sx + r >= c.width || sy + r >= c.height) continue
        let ok = true
        for (let dy = -r; ok && dy <= r; dy += 1) for (let dx = -r; ok && dx <= r; dx += 1) ok = isPaper(sx + dx, sy + dy)
        if (ok) return { x, y }
      }
    }
    return null
  }, clear)
  expect(found, 'no bare sheet between the rooms').not.toBeNull()
  return found!
}
