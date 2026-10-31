// Builds the pack files the Packs sheet's tests install. Run from canvas/:
//   node tests/fixtures/packs/build-fixture-packs.mjs
// Writes, beside this script:
//   fixture-crates.zip    a valid pack: "Fixture Crates" 1.0.0, two loose PNG props
//   no-manifest.zip       the same art with no manifest.json
//   bad-bundled-id.zip    a valid pack whose name ("gg-forge") is a bundled pack's id
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync, zlibSync } from 'fflate'

const here = (name) => fileURLToPath(new URL(name, import.meta.url))

// ── A minimal RGBA PNG ───────────────────────────────────────────────
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(bytes) {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(strToU8(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}
/** A w×h PNG: a filled box with a darker 4 px border and a cross, so it reads on a map. */
function png(w, h, fill, edge) {
  const rows = new Uint8Array(h * (1 + w * 4))
  for (let y = 0; y < h; y++) {
    rows[y * (1 + w * 4)] = 0 // filter: none
    for (let x = 0; x < w; x++) {
      const border = x < 4 || y < 4 || x >= w - 4 || y >= h - 4
      const cross = Math.abs(x * h - y * w) < w * 2 || Math.abs((w - 1 - x) * h - y * w) < w * 2
      const [r, g, b] = border || cross ? edge : fill
      rows.set([r, g, b, 255], y * (1 + w * 4) + 1 + x * 4)
    }
  }
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, w)
  v.setUint32(4, h)
  ihdr.set([8, 6, 0, 0, 0], 8) // 8-bit RGBA
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', zlibSync(rows)), chunk('IEND', new Uint8Array())]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** A loose prop: its manifest entry key, entry and file (named the way the loader matches). */
function prop(material, gridSize, image) {
  const hex = sha(image)
  return {
    key: `${material}_${gridSize}_object_A`,
    entry: { type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set: 'fixture-props', tags: ['fixture'] },
    file: `${material}_${gridSize}_A-${hex.slice(0, 8)}.png`,
    ref: { checksum: `sha256:${hex}`, size: image.length },
    image,
  }
}

function manifestFor(name, version, props) {
  return {
    name,
    description: 'Test props for the Packs sheet',
    version,
    theme: ['fantasy'],
    entries: Object.fromEntries(props.map((p) => [p.key, p.entry])),
    atlases: {},
    files: Object.fromEntries(props.map((p) => [p.file, p.ref])),
    bundleSize: props.reduce((n, p) => n + p.image.length, 0),
  }
}

function write(name, files) {
  writeFileSync(here(name), zipSync(files, { mtime: new Date('2026-10-31T00:00:00Z') }))
  console.log(`wrote ${name}`)
}

const crate = prop('fixture_crate', '1x1', png(64, 64, [176, 124, 72], [92, 60, 30]))
const bench = prop('fixture_bench', '2x1', png(128, 64, [120, 140, 150], [50, 60, 70]))
const art = Object.fromEntries([crate, bench].map((p) => [p.file, p.image]))

write('fixture-crates.zip', { 'manifest.json': strToU8(JSON.stringify(manifestFor('Fixture Crates', '1.0.0', [crate, bench]), null, 2)), ...art })
write('no-manifest.zip', art)
write('bad-bundled-id.zip', {
  'manifest.json': strToU8(JSON.stringify(manifestFor('gg-forge', '9.9.9', [crate]), null, 2)),
  [crate.file]: crate.image,
})
