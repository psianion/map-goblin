// Minimal PNG reader for the live check: resvg writes 8-bit RGBA, non-interlaced, so this
// only has to inflate the IDATs and undo the five scanline filters. No dependency.

import { inflateSync } from 'node:zlib'

export interface Image {
  width: number
  height: number
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Buffer
}

export function decodePng(buf: Buffer): Image {
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat: Buffer[] = []
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      if (data[12] !== 0) throw new Error('interlaced PNG')
    } else if (type === 'IDAT') idat.push(Buffer.from(data))
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth}`)
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (!channels) throw new Error(`colour type ${colorType}`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(width * height * 4)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const at = y * (stride + 1)
    const filter = raw[at]
    const line = Buffer.from(raw.subarray(at + 1, at + 1 + stride))
    unfilter(filter, line, prev, channels)
    for (let x = 0; x < width; x++) {
      const s = x * channels
      const d = (y * width + x) * 4
      out[d] = line[s]
      out[d + 1] = line[s + 1]
      out[d + 2] = line[s + 2]
      out[d + 3] = channels === 4 ? line[s + 3] : 255
    }
    prev = line
  }
  return { width, height, data: out }
}

function unfilter(filter: number, line: Buffer, prev: Buffer, bpp: number): void {
  for (let i = 0; i < line.length; i++) {
    const a = i >= bpp ? line[i - bpp] : 0
    const b = prev[i]
    const c = i >= bpp ? prev[i - bpp] : 0
    switch (filter) {
      case 0:
        break
      case 1:
        line[i] = (line[i] + a) & 0xff
        break
      case 2:
        line[i] = (line[i] + b) & 0xff
        break
      case 3:
        line[i] = (line[i] + ((a + b) >> 1)) & 0xff
        break
      case 4:
        line[i] = (line[i] + paeth(a, b, c)) & 0xff
        break
      default:
        throw new Error(`filter ${filter}`)
    }
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

// ── the parchment test ─────────────────────────────────────────────────────────────────
// map-svg.ts draws in nine flat colours, some of them at fill-opacity over the page. Every
// pixel of a pure schematic is therefore on a segment between two of those nine (that covers
// both anti-aliasing and the opacity blends). A photographic battlemap is not.

const PALETTE: [number, number, number][] = [
  [0xe7, 0xd9, 0xbf], // PAGE
  [0xf5, 0xec, 0xda], // FLOOR
  [0x2a, 0x20, 0x16], // INK
  [0xb0, 0x8d, 0x57], // ACCENT
  [0x6b, 0x5c, 0x46], // MUTED
  [0x6f, 0x8a, 0x93], // WATER
  [0x4f, 0x70, 0x43], // friendly
  [0x8a, 0x7a, 0x52], // neutral
  [0x8c, 0x3b, 0x2e], // hostile
]

const TOLERANCE = 24

function distanceToSegment(p: number[], a: number[], b: number[]): number {
  let dot = 0
  let len = 0
  for (let i = 0; i < 3; i++) {
    dot += (p[i] - a[i]) * (b[i] - a[i])
    len += (b[i] - a[i]) ** 2
  }
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, dot / len))
  let d = 0
  for (let i = 0; i < 3; i++) d += (p[i] - (a[i] + t * (b[i] - a[i]))) ** 2
  return Math.sqrt(d)
}

/** True when the pixel could not have come out of the schematic's palette. */
export function isNonParchment(r: number, g: number, b: number): boolean {
  const p = [r, g, b]
  for (let i = 0; i < PALETTE.length; i++) {
    for (let j = i; j < PALETTE.length; j++) {
      if (distanceToSegment(p, PALETTE[i], PALETTE[j]) <= TOLERANCE) return false
    }
  }
  return true
}

export interface NonParchment {
  count: number
  /** Every offending pixel, as [x, y]. Capped so a full battlemap does not fill memory. */
  sample: [number, number][]
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function nonParchmentPixels(image: Image, sampleCap = 200_000): NonParchment {
  const out: NonParchment = {
    count: 0,
    sample: [],
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  }
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const d = (y * image.width + x) * 4
      if (!isNonParchment(image.data[d], image.data[d + 1], image.data[d + 2])) continue
      out.count += 1
      if (out.sample.length < sampleCap) out.sample.push([x, y])
      if (x < out.minX) out.minX = x
      if (y < out.minY) out.minY = y
      if (x > out.maxX) out.maxX = x
      if (y > out.maxY) out.maxY = y
    }
  }
  return out
}
