// Character card: satori (HTML/CSS -> SVG) + resvg (SVG -> PNG), the same pipeline the plan
// calls out (§8). Pure render function; portrait fetching is a separate, unmocked-in-tests
// concern so renderCharacterCard itself never touches the network.

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import satori from 'satori'
import { html } from 'satori-html'

// Bundled OFL Cardo (bot/assets/fonts) — a classical serif that reads as parchment/ink per
// the art style guide, without pulling in a webfont CDN at render time.
const FONT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/fonts')
const loadFont = (f: string) => readFileSync(resolve(FONT_DIR, f))
const FONTS = [
  { name: 'Cardo', data: loadFont('Cardo-Regular.ttf'), weight: 400 as const, style: 'normal' as const },
  { name: 'Cardo', data: loadFont('Cardo-Bold.ttf'), weight: 700 as const, style: 'normal' as const },
]

const WIDTH = 900
const HEIGHT = 320

// Parchment/ink palette — ACCENT matches lib/ui.ts's container accent.
const INK = '#2a2016'
const PARCHMENT = '#f4ead9'
const PARCHMENT_2 = '#e8dcc4'
const ACCENT = '#b08d57'
const MUTED = '#6b5c46'

export interface CharacterCardInput {
  name: string
  className: string
  level: number
  campaignName: string
  lastPlayed?: number
  /** Already resolved to a data: URI — renderCharacterCard never fetches. */
  portraitDataUri?: string
}

/** The portrait slot: top-left inside the card's padding, a rounded square with an accent ring. */
const PORTRAIT = { x: 32, y: 32, size: 240, radius: 16 }

/**
 * Satori draws the ring and the monogram, never the picture. Its handling of an embedded image
 * grows far worse than linearly with the bytes — a 64 px portrait costs a third of a second, a
 * 256 px one fifteen seconds, and a 512 px one never returns, blocking the whole bot with it
 * (seen live on a 1254 px upload). The picture is placed into the finished SVG instead, where
 * resvg draws a full-size one in well under a second (`placePortrait`).
 */
function portraitHtml(input: CharacterCardInput): string {
  const { size, radius } = PORTRAIT
  const initial = input.portraitDataUri ? '' : input.name.trim().charAt(0).toUpperCase() || '?'
  return `<div style="display:flex;width:${size}px;height:${size}px;border-radius:${radius}px;align-items:center;justify-content:center;background-color:${PARCHMENT_2};box-shadow:0 0 0 4px ${ACCENT};font-size:96px;font-weight:700;color:${MUTED}">${initial}</div>`
}

/** Lays the portrait over its slot in satori's SVG, clipped to the same rounded square. */
export function placePortrait(svg: string, portraitDataUri: string | undefined): string {
  if (!portraitDataUri) return svg
  const { x, y, size, radius } = PORTRAIT
  const image =
    `<defs><clipPath id="portrait"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${radius}"/></clipPath></defs>` +
    `<image x="${x}" y="${y}" width="${size}" height="${size}" href="${portraitDataUri}" preserveAspectRatio="xMidYMid slice" clip-path="url(#portrait)"/>`
  const end = svg.lastIndexOf('</svg>')
  return end < 0 ? svg : svg.slice(0, end) + image + svg.slice(end)
}

function cardMarkup(input: CharacterCardInput): string {
  const lastPlayed = input.lastPlayed
    ? `<div style="display:flex;font-size:18px;color:${MUTED}">Last played ${new Date(input.lastPlayed).toISOString().slice(0, 10)}</div>`
    : ''
  return `
    <div style="display:flex;width:${WIDTH}px;height:${HEIGHT}px;padding:32px;background-color:${PARCHMENT};font-family:Cardo;color:${INK}">
      <div style="display:flex">${portraitHtml(input)}</div>
      <div style="display:flex;flex-direction:column;margin-left:36px;flex:1;justify-content:center">
        <div style="display:flex;font-size:16px;font-weight:700;letter-spacing:0.14em;color:${ACCENT}">${input.campaignName.toUpperCase()}</div>
        <div style="display:flex;font-size:56px;font-weight:700;margin-top:8px">${input.name}</div>
        <div style="display:flex;font-size:26px;margin-top:10px;color:${MUTED}">${input.className} · Level ${input.level}</div>
        ${lastPlayed}
      </div>
    </div>
  `
}

/** Renders a character to a PNG buffer. No network — pass an already-resolved data URI. */
export async function renderCharacterCard(input: CharacterCardInput): Promise<Buffer> {
  const svg = await satori(html(cardMarkup(input)) as Parameters<typeof satori>[0], {
    width: WIDTH,
    height: HEIGHT,
    fonts: FONTS,
  })
  return new Resvg(placePortrait(svg, input.portraitDataUri), { fitTo: { mode: 'width', value: WIDTH * 2 } }).render().asPng()
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

/**
 * Resolves a stored `characters.portrait_url` to a data: URI, or undefined on any failure
 * (missing value, missing file, network error, non-2xx) — the card falls back to the monogram
 * placeholder either way. Handles all three shapes the column can hold: a local relative path
 * under `botData` (current rows, read from disk), a legacy http(s) Discord CDN link (rows saved
 * before portraits were persisted to disk — still fetched so old cards keep working until they
 * expire), or null.
 *
 * ponytail: embeds whatever content-type the legacy-fetch response gives (Discord attachments
 * can be PNG or JPEG); the plan's "prefer JPEG, PNG blocks resvg's Linux event loop" note
 * applies to large backgrounds, not small portraits — revisit only if a portrait render is
 * measurably slow.
 */
export async function fetchPortraitDataUri(botData: string, portraitUrl: string | null | undefined): Promise<string | undefined> {
  if (!portraitUrl) return undefined
  if (/^https?:\/\//i.test(portraitUrl)) {
    try {
      const res = await fetch(portraitUrl, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return undefined
      const contentType = res.headers.get('content-type') ?? 'image/png'
      const buf = Buffer.from(await res.arrayBuffer())
      return `data:${contentType};base64,${buf.toString('base64')}`
    } catch {
      return undefined
    }
  }
  try {
    const buf = readFileSync(join(botData, portraitUrl))
    const ext = portraitUrl.split('.').pop()?.toLowerCase() ?? ''
    return `data:${MIME_BY_EXT[ext] ?? 'application/octet-stream'};base64,${buf.toString('base64')}`
  } catch {
    return undefined
  }
}
