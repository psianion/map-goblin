import { type Page } from '@playwright/test'

/**
 * A minute each rather than the twenty seconds this used to allow: the first page
 * of a run pays Vite's cold compile, and a boot that lands at 21 seconds is a slow
 * box, not a broken app. The waits cost nothing when the app is already up.
 *
 * Keep the sum under `timeout` in playwright.config.ts, which has to leave room
 * for a test body on top of the worst-case boot.
 */
const CLIPPER_TIMEOUT = 60_000
const ENGINE_TIMEOUT = 60_000

/**
 * Wait out the whole boot: Clipper2 WASM, then the engine.
 *
 * Both halves, always. `data-clipper-ready` alone was the old bar and it is the
 * wrong one — it is set well before the engine is up, so a spec that started
 * driving pointers at that point drew nothing into an empty scene graph and then
 * asserted on it. Specs that never noticed were the ones whose assertions passed
 * either way. Waiting for the engine here fixes every caller at once rather than
 * asking each spec to remember.
 */
export async function waitForBoot(page: Page): Promise<void> {
  await page.waitForSelector('[data-clipper-ready="true"]', { timeout: CLIPPER_TIMEOUT })
  await waitForEngine(page)
}

/** Navigate to the app and wait for it to finish booting. */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/')
  await waitForBoot(page)
}

/**
 * Wait until the engine has finished booting — `data-clipper-ready` is set well
 * before it, while the bundled asset pack is still being installed into a cold
 * IndexedDB, and until that finishes the canvas is an "Initializing…" overlay
 * with an empty scene graph. Anything driven by a real pointer has to wait for
 * this: the overlay sits on top of the canvas, so a click lands on a div.
 *
 * `gotoApp` already awaits this. Still exported because specs call it directly
 * after a reload, and because an explicit call documents the dependency.
 */
export async function waitForEngine(page: Page, timeout = ENGINE_TIMEOUT): Promise<void> {
  await page.waitForFunction(
    () => {
      const app = (window as Window & { __pixiApp?: { stage: { children: { children: unknown[] }[] } } })
        .__pixiApp
      return !!app && app.stage.children.length > 0 && app.stage.children[0].children.length > 0
    },
    undefined,
    { timeout },
  )
}

/**
 * Number of shape children on the dungeon layer.
 *
 * The check that makes a drawing test mean something. A spec that draws and then
 * only asserts the canvas is still visible passes just as happily when the draw
 * did nothing at all, which is how a boot-overlay regression hid here for so long.
 * Assert a count delta around the draw instead.
 */
export async function shapeCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const store = (window as Window & {
      __store?: {
        getState: () => { layers: { type: string; children: { childType: string }[] }[] }
      }
    }).__store
    const layer = store?.getState().layers.find((l) => l.type === 'dungeon')
    return layer ? layer.children.filter((c) => c.childType === 'shape').length : -1
  })
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

/**
 * Get pixel colour at canvas coordinates, in device pixels.
 *
 * Read straight out of the live WebGL drawing buffer. Two wrong ways came before it:
 *
 *  - `canvas.getContext('2d')` on Pixi's canvas returns `null`, because the element
 *    already holds a WebGL context. The helper silently returned `{0,0,0,0}` for every
 *    pixel of every test, which made `expect(a).toBe(255)` unsatisfiable and
 *    `expect(diff).toBeGreaterThanOrEqual(0)` unfalsifiable — without ever mentioning
 *    a canvas in the failure.
 *  - An element `.screenshot()` decoded in-page reads correctly, but wedges the worker:
 *    the very next test in the same file then hangs resolving any locator at all. The
 *    door light rows can afford it (their own file, whole-frame diffs); a helper every
 *    spec calls cannot.
 *
 * `preserveDrawingBuffer: true` (PixiRenderEngine) is what makes the buffer still
 * readable after the frame is composited.
 */
export async function getPixelColor(
  page: Page,
  x: number,
  y: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(
    ({ x, y }) => {
      const canvas = document.querySelector('canvas')
      if (!canvas) return { r: 0, g: 0, b: 0, a: 0 }
      const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as
        | WebGLRenderingContext
        | null
      if (!gl) return { r: 0, g: 0, b: 0, a: 0 }
      const px = Math.min(Math.max(Math.round(x), 0), canvas.width - 1)
      // readPixels counts from the bottom-left; every caller counts from the top.
      const py = Math.min(Math.max(canvas.height - 1 - Math.round(y), 0), canvas.height - 1)
      const out = new Uint8Array(4)
      gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out)
      return { r: out[0], g: out[1], b: out[2], a: out[3] }
    },
    { x, y },
  )
}
