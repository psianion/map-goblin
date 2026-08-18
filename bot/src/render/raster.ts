// SVG string → PNG buffer. The map schematic is hand-written SVG rather than satori output,
// so unlike card-kit.ts its text is still text — resvg needs the bundled fonts to draw it.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import { MAX_WIDTH_PX } from './map-svg'

// Same bundled OFL Cardo the character card uses (bot/assets/fonts) — one typeface across
// every image the bot posts, and no webfont fetch at render time.
const FONT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/fonts')
const FONT = {
  fontFiles: [resolve(FONT_DIR, 'Cardo-Regular.ttf'), resolve(FONT_DIR, 'Cardo-Bold.ttf')],
  defaultFontFamily: 'Cardo',
  // The container image has no font config of its own; a system-font scan there finds nothing
  // and costs startup time on every render.
  loadSystemFonts: false,
}

/**
 * Renders at the SVG's own pixel size, capped. `mapSvg` already picks its px-per-cell against
 * the same ceiling, so the cap only ever catches a caller passing something else.
 */
export function rasterize(svg: string, maxWidth = MAX_WIDTH_PX): Buffer {
  const declared = Number(/\bwidth="(\d+(?:\.\d+)?)"/.exec(svg)?.[1] ?? maxWidth)
  const width = Math.max(1, Math.min(maxWidth, Number.isFinite(declared) ? declared : maxWidth))
  return new Resvg(svg, { font: FONT, fitTo: { mode: 'width', value: Math.round(width) } }).render().asPng()
}
