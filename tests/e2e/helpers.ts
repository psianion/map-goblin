import { type Page } from '@playwright/test'

/** Navigate to app and wait for canvas + Clipper2 WASM to be ready */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForSelector('[data-clipper-ready="true"]', { timeout: 20000 })
}

/** Wait for n animation frames */
export async function waitFrame(page: Page, n: number = 1): Promise<void> {
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())))
  }
}

/** Fire a pointer event on the canvas element */
export async function firePointer(
  page: Page,
  type: string,
  x: number,
  y: number,
  pressure = 0,
  buttons = 0,
): Promise<void> {
  await page.evaluate(
    ({ type, x, y, pressure, buttons }) => {
      const canvas = document.querySelector('canvas')
      if (!canvas) return
      canvas.dispatchEvent(
        new PointerEvent(type, {
          clientX: x,
          clientY: y,
          pressure,
          buttons,
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: 'mouse',
        }),
      )
    },
    { type, x, y, pressure, buttons },
  )
}

interface ShortcutMods {
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
}

/** Press a keyboard shortcut */
export async function pressShortcut(page: Page, key: string, mods: ShortcutMods = {}): Promise<void> {
  const parts: string[] = []
  if (mods.ctrl) parts.push('Control')
  if (mods.shift) parts.push('Shift')
  if (mods.alt) parts.push('Alt')
  parts.push(key)
  await page.keyboard.press(parts.join('+'))
}

/** Draw a rectangle on the canvas using pointer events */
export async function drawRect(
  page: Page,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Promise<void> {
  await firePointer(page, 'pointerdown', x1, y1, 0.5, 1)
  await firePointer(page, 'pointermove', x2, y2, 0.5, 1)
  await firePointer(page, 'pointerup', x2, y2, 0, 0)
  await waitFrame(page, 2)
}

/** Get pixel color at canvas coordinates */
export async function getPixelColor(
  page: Page,
  x: number,
  y: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement
    if (!canvas) return { r: 0, g: 0, b: 0, a: 0 }
    const ctx = canvas.getContext('2d')
    if (!ctx) return { r: 0, g: 0, b: 0, a: 0 }
    const d = ctx.getImageData(x, y, 1, 1).data
    return { r: d[0], g: d[1], b: d[2], a: d[3] }
  }, { x, y })
}
