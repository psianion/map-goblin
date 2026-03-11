import type { Page } from '@playwright/test'

/** Navigate to the app root and wait for canvas + WASM to be ready */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForSelector('canvas', { timeout: 15000 })
  // Wait for PixiJS init (WebGL context ready)
  await page.waitForFunction(
    () => document.querySelector('canvas') !== null,
    { timeout: 10000 },
  )
  await waitFrame(page, 2)
}

/** Draw a rectangle on the canvas by click-drag */
export async function drawRect(
  page: Page,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Promise<void> {
  const canvas = page.locator('canvas')
  await canvas.dispatchEvent('pointerdown', { clientX: x1, clientY: y1, button: 0 })
  await canvas.dispatchEvent('pointermove', { clientX: x2, clientY: y2, button: 0 })
  await canvas.dispatchEvent('pointerup', { clientX: x2, clientY: y2, button: 0 })
  await waitFrame(page, 2)
}

/** Fire a single pointer event on the canvas */
export async function firePointer(
  page: Page,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
): Promise<void> {
  const canvas = page.locator('canvas')
  await canvas.dispatchEvent(type, { clientX: x, clientY: y, button: 0 })
}

/** Press a keyboard shortcut (e.g. 'Control+z') */
export async function pressShortcut(page: Page, shortcut: string): Promise<void> {
  await page.keyboard.press(shortcut)
  await waitFrame(page, 1)
}

/** Wait for N animation frames */
export async function waitFrame(page: Page, frames = 1): Promise<void> {
  for (let i = 0; i < frames; i++) {
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    )
  }
}

/** Read a pixel color from the canvas at physical (px, py) pixel coordinates */
export async function getPixelColor(
  page: Page,
  px: number,
  py: number,
): Promise<[number, number, number, number]> {
  return page.evaluate(
    ([x, y]) => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2d context')
      const d = ctx.getImageData(x, y, 1, 1).data
      return [d[0], d[1], d[2], d[3]] as [number, number, number, number]
    },
    [px, py],
  )
}
