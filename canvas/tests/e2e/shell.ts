// Shared by the shell specs: the editor on the goblin warren at 1400x1000, chrome held (no
// auto fade), picking tools the way a DM does, and the frame screenshots for review.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, type Locator, type Page } from '@playwright/test'
import { gotoApp, waitFrame } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const WARREN = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../session/testdata/goblin-warren.mapbuilder', import.meta.url)), 'utf8'),
)

export const VIEWPORT = { width: 1400, height: 1000 }

/** The editor on the warren, Select in hand, nothing picked, the map fitted. */
export async function openEditor(page: Page, theme: 'light' | 'dark' = 'light', viewport = VIEWPORT): Promise<void> {
  await page.setViewportSize(viewport)
  await page.addInitScript((t) => localStorage.setItem('v2-theme', t), theme)
  await gotoApp(page)
  await page.evaluate(async (data) => {
    const st = (window as Any).__store.getState()
    st.loadFromFile(structuredClone(data))
    st.setRoomsSheetOpen(false)
    st.setSelectedIds([])
    st.setFocusMode('manual')
    st.setActiveTool('select')
    await st.saveCurrentMap()
  }, WARREN)
  await page.getByRole('button', { name: 'Fit' }).click()
  await waitFrame(page, 10)
  // A fresh session: no family tool held yet, so the dock is Level and Layers only.
  await page.evaluate(() => (window as Any).__shell.setState({ lastToolId: null, flyout: null, sheet: null }))
  await waitFrame(page, 2)
}

/** Opens a family's flyout and picks one of its tools. */
export async function pickFromFlyout(page: Page, family: string, tool: string): Promise<void> {
  await page.getByTestId('shell-rail').getByRole('button', { name: family }).click()
  await page.getByTestId('shell-flyout').getByRole('button', { name: new RegExp(`^${tool}`) }).click()
  await waitFrame(page, 2)
}

/** Where each tool lives in the shell: a rail button, or a family's flyout row plus, for a floor shape, its dock button. */
const TOOLS = {
  select: { rail: 'Select' },
  pan: { rail: 'Pan' },
  measure: { rail: 'Measure' },
  rectangle: { family: 'Design', tool: 'Floor', dock: 'Rectangle' },
  polygon: { family: 'Design', tool: 'Floor', dock: 'Polygon' },
  regularPolygon: { family: 'Design', tool: 'Floor', dock: 'Regular polygon' },
  wall: { family: 'Design', tool: 'Wall' },
  door: { family: 'Design', tool: 'Door' },
  elevation: { family: 'Design', tool: 'Elevation' },
  terrain: { family: 'Terrain', tool: 'Terrain brush' },
  stamp: { family: 'Objects', tool: 'Stamp' },
  scatter: { family: 'Objects', tool: 'Scatter' },
  light: { family: 'Environment', tool: 'Light' },
  label: { family: 'Text', tool: 'Label' },
  zone: { family: 'Text', tool: 'Zone' },
  roomRect: { family: 'Text', tool: 'Rectangle room' },
  roomPolygon: { family: 'Text', tool: 'Polygon room' },
  divide: { family: 'Text', tool: 'Divide' },
} as const

export type ShellTool = keyof typeof TOOLS

/** Takes a tool in hand through the shell: the rail, or the family flyout and, for a floor shape, the dock. */
export async function pickTool(page: Page, name: ShellTool): Promise<void> {
  const where: { rail?: string; family?: string; tool?: string; dock?: string } = TOOLS[name]
  if (where.rail) {
    await page.getByTestId('shell-rail').getByRole('button', { name: new RegExp(`^${where.rail}`) }).click()
  } else {
    await pickFromFlyout(page, where.family!, where.tool!)
    if (where.dock) await page.getByTestId('shell-dock').getByRole('button', { name: where.dock, exact: true }).click()
  }
  await waitFrame(page, 2)
}

/**
 * Whether the floors are painted with their texture yet, not the flat colour that stands in
 * while the art downloads on first use. A pixel read before that reads the stand-in.
 */
export function floorArtLanded(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const find = (n: Any): Any => (n.label === 'sublayer-floor' ? n : (n.children ?? []).map(find).find(Boolean))
    const floor = find((window as Any).__pixiApp.stage)
    const textured = (n: Any): boolean => (n.tilePosition && n.texture?.width > 1) || (n.children ?? []).some(textured)
    return !!floor && textured(floor)
  })
}

/** The camera at `zoom` px a cell with world `p` at the canvas centre. */
export async function lookAt(page: Page, p: { x: number; y: number }, zoom: number): Promise<void> {
  await page.evaluate(
    ({ p, zoom }) => {
      const app = (window as Any).__pixiApp
      const world = app.stage.children[0]
      const r = app.canvas.getBoundingClientRect()
      world.scale.set(zoom)
      world.position.set(r.width / 2 - p.x * zoom, r.height / 2 - p.y * zoom)
    },
    { p, zoom },
  )
  await waitFrame(page, 10)
}

/** Writes the frame for review when SHELL_SHOTS is set. */
export async function shot(page: Page, name: string): Promise<void> {
  if (!process.env.SHELL_SHOTS) return
  await page.mouse.move(VIEWPORT.width - 2, VIEWPORT.height / 2)
  await waitFrame(page, 20)
  await page.screenshot({ path: fileURLToPath(new URL(`../../../docs/plans/canvas-v2-shell/steps/${name}.png`, import.meta.url)) })
}

export async function box(l: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await l.boundingBox()
  if (!b) throw new Error('not laid out')
  return b
}

/** The shell's fixed geometry, true in every frame. */
export async function expectFrameGeometry(page: Page): Promise<void> {
  const rail = await box(page.getByTestId('shell-rail'))
  expect(rail.x).toBe(0)
  expect(rail.width).toBe(56)
  expect(rail.height).toBe(VIEWPORT.height)
  const dock = await box(page.getByTestId('shell-dock'))
  expect(dock.height).toBe(112)
  expect(dock.y + dock.height).toBe(VIEWPORT.height - 40)
  const status = await box(page.getByTestId('shell-status'))
  expect(status.height).toBe(28)
  expect(status.x).toBe(56)
  const title = await box(page.getByTestId('shell-title-card'))
  expect([title.x, title.y, title.height]).toEqual([68, 12, 44])
  const top = await box(page.getByTestId('shell-top-actions'))
  expect([top.x + top.width, top.y, top.height]).toEqual([VIEWPORT.width - 12, 12, 44])
}

export async function expectSlot(page: Page): Promise<void> {
  const slot = await box(page.getByTestId('shell-slot'))
  expect([slot.x, slot.y, slot.width]).toEqual([68, 68, 272])
}

/** The dock's column captions, left to right. */
export async function dockColumns(page: Page): Promise<string[]> {
  return page.getByTestId('shell-dock').locator('[data-composite="dock-column"]').evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.column ?? ''),
  )
}
