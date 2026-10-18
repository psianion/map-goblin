// Stand-in thumbnails until the real art lands: one parchment tile per card family, drawn as
// SVG and rastered once. Swapping in painted art means replacing GLYPH's entry with a file
// read — every caller already treats the result as "an attached image with a name".

import type { AttachedFile } from '../lib/ui'
import { rasterize } from './raster'

const INK = '#3b2f23'
const PAPER = '#e8dcc0'
const GILT = '#b08d57'
const STROKE = `fill="none" stroke="${INK}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"`

const GLYPH = {
  // A d20 seen face-on: the hexagon, the front triangle, and the edges running to it.
  dice: `<polygon points="64,20 102,42 102,86 64,108 26,86 26,42" ${STROKE}/>
    <polygon points="64,44 86,82 42,82" fill="${GILT}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M64 20v24M26 42l38 2M102 42l-38 2M26 86l16-4M102 86l-16-4M64 108L42 82M64 108l22-26" ${STROKE}/>`,
  // A pennant on its pole.
  campaign: `<path d="M38 22v86" ${STROKE}/>
    <path d="M38 28h58l-14 19 14 19H38z" fill="${GILT}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`,
  // A hooded figure, head and shoulders.
  character: `<path d="M26 108c3-24 17-36 38-36s35 12 38 36z" fill="${GILT}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    <circle cx="64" cy="48" r="19" fill="${PAPER}" stroke="${INK}" stroke-width="5"/>`,
  // A note pinned to the board, three lines of writing on it.
  quest: `<rect x="34" y="26" width="60" height="80" rx="6" fill="${PAPER}" stroke="${INK}" stroke-width="5"/>
    <path d="M48 54h32M48 70h32M48 86h20" ${STROKE}/>
    <circle cx="64" cy="26" r="9" fill="${GILT}" stroke="${INK}" stroke-width="5"/>`,
  // A drawstring purse, pulled shut.
  purse: `<path d="M42 50c-8 11-12 23-12 32 0 14 15 24 34 24s34-10 34-24c0-9-4-21-12-32z" fill="${GILT}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M42 50c7-7 37-7 44 0M56 34l6 16M72 34l-6 16" ${STROKE}/>`,
  // An open book, a page of writing on each half.
  journal: `<path d="M20 36c14-8 30-8 44 4 14-12 30-12 44-4v58c-14-8-30-8-44 4-14-12-30-12-44-4z" fill="${PAPER}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M64 40v58" ${STROKE}/>
    <path d="M32 56h22M32 72h22M74 56h22M74 72h22" ${STROKE}/>`,
  // A letter folded shut under a wax seal.
  handout: `<rect x="22" y="32" width="84" height="64" rx="6" fill="${PAPER}" stroke="${INK}" stroke-width="5"/>
    <path d="M22 38l42 30 42-30" ${STROKE}/>
    <circle cx="64" cy="84" r="14" fill="${GILT}" stroke="${INK}" stroke-width="5"/>`,
  // An hourglass between its stands, the sand run through.
  schedule: `<path d="M38 22h52M38 106h52" ${STROKE}/>
    <path d="M44 26h40l-16 38 16 38H44l16-38z" fill="${PAPER}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M47 100c2-13 9-22 17-22s15 9 17 22z" fill="${GILT}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`,
  // A calendar page on its rings, one day marked.
  calendar: `<rect x="24" y="34" width="80" height="74" rx="8" fill="${PAPER}" stroke="${INK}" stroke-width="5"/>
    <path d="M46 22v20M82 22v20M27 58h74" ${STROKE}/>
    <rect x="44" y="68" width="18" height="16" rx="3" fill="${GILT}" stroke="${INK}" stroke-width="5"/>
    <path d="M74 76h10M44 96h10M74 96h10" ${STROKE}/>`,
}

export type PlaceholderKind = keyof typeof GLYPH

const cache = new Map<PlaceholderKind, Buffer>()

export function placeholderSvg(kind: PlaceholderKind): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <rect x="3" y="3" width="122" height="122" rx="18" fill="${PAPER}" stroke="${GILT}" stroke-width="6"/>
    ${GLYPH[kind]}
  </svg>`
}

/** The file to attach and the url a thumbnail points at it with. */
export function placeholderThumb(kind: PlaceholderKind): { file: AttachedFile; url: string } {
  let data = cache.get(kind)
  if (!data) cache.set(kind, (data = rasterize(placeholderSvg(kind), 128)))
  const name = `thumb-${kind}.png`
  return { file: { name, data }, url: `attachment://${name}` }
}
