// Character card: hand-written SVG → resvg PNG, through the same `rasterize` the map sheet
// uses (bundled Cardo, no webfont, no network). Pure render function; portrait fetching is a
// separate concern below so renderCharacterCard itself never touches the network.
//
// The look (chosen 2026-09-17 from six rendered options): the portrait is the whole card,
// washed onto parchment — it bleeds in from the left and soaks out into the paper along a
// ragged watercolour edge; the name and class sit in ink on the paper side.
//
// Why not satori: its handling of an embedded image grows far worse than linearly with the
// bytes — a 64 px portrait cost a third of a second, a 256 px one fifteen seconds, and a
// 512 px one never returned, blocking the whole bot with it (seen live on a 1254 px upload).
// resvg draws the same picture in well under a second.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { rasterize } from './raster'

export const CARD_WIDTH = 900
export const CARD_HEIGHT = 320

// Parchment/ink palette — the art style guide's, matching lib/ui.ts's container accent.
const PARCHMENT = '#f4ead9'
const INK = '#2a2016'
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

const esc = (s: string): string =>
  s.replace(/[<>&"']/g, (c) => `&${{ '<': 'lt', '>': 'gt', '&': 'amp', '"': 'quot', "'": 'apos' }[c]!};`)

const text = (s: string, x: number, y: number, size: number, attrs: Record<string, string | number>): string => {
  const extra = Object.entries(attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ')
  return `<text x="${x}" y="${y}" font-family="Cardo" font-size="${size}" ${extra}>${esc(s)}</text>`
}

/** The right edge the text hangs from, and the width a name may fill before it shrinks. */
const TEXT_RIGHT = 868
const NAME_MAX_WIDTH = 500
const NAME_MAX_SIZE = 72
const NAME_MIN_SIZE = 40

/** Cardo Bold runs about 0.55 em per glyph; a long name shrinks rather than runs off the sheet. */
export function nameFontSize(name: string): number {
  const fit = Math.floor(NAME_MAX_WIDTH / (0.55 * Math.max(1, name.length)))
  return Math.max(NAME_MIN_SIZE, Math.min(NAME_MAX_SIZE, fit))
}

/** Paper grain over the whole sheet — low-contrast noise, per the style guide's "texture everywhere". */
const GRAIN =
  `<filter id="grain" x="0" y="0" width="100%" height="100%">` +
  `<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7"/>` +
  `<feColorMatrix type="matrix" values="0 0 0 0 0.3 0 0 0 0 0.25 0 0 0 0 0.18 0 0 0 0.08 0"/>` +
  `<feComposite in2="SourceGraphic" operator="over"/></filter>`

/**
 * The wash: opaque across the left, gone by two thirds of the way over, with a soaked ragged
 * edge from displacing the gradient by turbulence. Seeded, so the same card renders the same.
 */
const WASH =
  `<linearGradient id="washGrad" x1="0" x2="1"><stop offset="0.38" stop-color="#fff"/><stop offset="0.72" stop-color="#000"/></linearGradient>` +
  `<filter id="soak" x="-10%" y="-10%" width="120%" height="120%">` +
  `<feTurbulence type="fractalNoise" baseFrequency="0.012 0.03" numOctaves="3" seed="3" result="n"/>` +
  `<feDisplacementMap in="SourceGraphic" in2="n" scale="42" xChannelSelector="R" yChannelSelector="G"/>` +
  `<feGaussianBlur stdDeviation="2"/></filter>` +
  `<mask id="wash" maskUnits="userSpaceOnUse" x="0" y="0" width="${CARD_WIDTH}" height="${CARD_HEIGHT}">` +
  `<rect x="-40" y="-40" width="${CARD_WIDTH + 80}" height="${CARD_HEIGHT + 80}" fill="url(#washGrad)" filter="url(#soak)"/></mask>` +
  `<filter id="pigment"><feColorMatrix type="saturate" values="0.88"/></filter>` +
  `<clipPath id="sheet"><rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}"/></clipPath>`

/** With a portrait: the picture, top-anchored so a square upload keeps its head, soaked into the paper. */
function portraitWash(uri: string): string {
  return (
    `<g mask="url(#wash)" clip-path="url(#sheet)" style="mix-blend-mode:multiply">` +
    `<image x="0" y="0" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" href="${uri}" preserveAspectRatio="xMidYMin slice" filter="url(#pigment)"/>` +
    `</g>`
  )
}

/** Without one: the character's initial, a faint ink wash where the picture would be. */
function monogramWash(name: string): string {
  const initial = name.trim().charAt(0).toUpperCase() || '?'
  return (
    `<g mask="url(#wash)" clip-path="url(#sheet)">` +
    text(initial, 250, 268, 300, { fill: INK, 'fill-opacity': '0.16', 'font-weight': '700', 'text-anchor': 'middle' }) +
    `</g>`
  )
}

/** The card as SVG — exported so tests can read the structure without decoding a PNG. */
export function cardSvg(input: CharacterCardInput): string {
  const nameSize = nameFontSize(input.name)
  const lastPlayed = input.lastPlayed
    ? text(`Last played ${new Date(input.lastPlayed).toISOString().slice(0, 10)}`, TEXT_RIGHT, 286, 16, {
        fill: MUTED,
        'text-anchor': 'end',
      })
    : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH * 2}" height="${CARD_HEIGHT * 2}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">` +
    `<defs>${GRAIN}${WASH}</defs>` +
    `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${PARCHMENT}"/>` +
    (input.portraitDataUri ? portraitWash(input.portraitDataUri) : monogramWash(input.name)) +
    `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="transparent" filter="url(#grain)"/>` +
    text(input.campaignName.toUpperCase(), TEXT_RIGHT, 84, 15, { fill: ACCENT, 'letter-spacing': '4', 'text-anchor': 'end' }) +
    text(input.name, TEXT_RIGHT, 180, nameSize, { fill: INK, 'font-weight': '700', 'text-anchor': 'end' }) +
    text(`${input.className}  ·  Level ${input.level}`, TEXT_RIGHT, 226, 28, { fill: MUTED, 'text-anchor': 'end' }) +
    `<rect x="${TEXT_RIGHT - 56}" y="248" width="56" height="2" fill="${ACCENT}"/>` +
    lastPlayed +
    `</svg>`
  )
}

/** Renders a character to a PNG buffer at 2× the sheet size. No network — pass an already-resolved data URI. */
export async function renderCharacterCard(input: CharacterCardInput): Promise<Buffer> {
  return rasterize(cardSvg(input), CARD_WIDTH * 2)
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
 * wash either way. Handles all three shapes the column can hold: a local relative path under
 * `botData` (current rows, read from disk), a legacy http(s) Discord CDN link (rows saved before
 * portraits were persisted to disk — still fetched so old cards keep working until they
 * expire), or null.
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
