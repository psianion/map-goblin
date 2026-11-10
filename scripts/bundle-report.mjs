#!/usr/bin/env node
// Dev only. For each built app: every chunk's raw and gzipped size, and which chunks
// index.html loads eagerly (its scripts, modulepreloads and stylesheets, plus every
// chunk those import statically).
//
//   node scripts/bundle-report.mjs [distDir ...] [--forbid <chunk>]
//
// Defaults to canvas/dist and session/client/dist. `--forbid pixi` exits 1 when a chunk
// named pixi is eager in the first dist given (the canvas home shell must not load it).

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const args = process.argv.slice(2)
const forbidAt = args.indexOf('--forbid')
const forbid = forbidAt === -1 ? null : args.splice(forbidAt, 2)[1]
const root = resolve(import.meta.dirname, '..')
const dists = args.length ? args : ['canvas/dist', 'session/client/dist']

const kb = (n) => `${(n / 1024).toFixed(1)} KB`
/** `pixi-AbC123.js` → `pixi`. */
const chunkName = (file) => file.replace(/-[\w-]{8}\.(js|css)$/, '')

let failed = false
for (const [i, rel] of dists.entries()) {
  const dist = resolve(root, rel)
  const assets = join(dist, 'assets')
  if (!existsSync(join(dist, 'index.html'))) {
    console.error(`${rel}: no index.html (build it first)`)
    failed = true
    continue
  }
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  const files = readdirSync(assets).filter((f) => /\.(js|css)$/.test(f))

  // Eager: what index.html names, then the static imports of those, transitively.
  const eager = new Set(
    [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.(?:js|css))"/g)].map((m) => m[1]),
  )
  const queue = [...eager].filter((f) => f.endsWith('.js'))
  while (queue.length) {
    const code = readFileSync(join(assets, queue.pop()), 'utf8')
    // Static imports only: `import"./x.js"`, `from"./x.js"`. Dynamic `import("./x.js")` is lazy.
    for (const m of code.matchAll(/(?:\bfrom|\bimport)\s*["']\.\/([^"']+\.js)["']/g)) {
      if (!eager.has(m[1])) {
        eager.add(m[1])
        queue.push(m[1])
      }
    }
  }

  const rows = files
    .map((f) => {
      const buf = readFileSync(join(assets, f))
      return { f, raw: buf.length, gz: gzipSync(buf, { level: 6 }).length, eager: eager.has(f) }
    })
    .sort((a, b) => Number(b.eager) - Number(a.eager) || b.gz - a.gz)

  console.log(`\n${rel}`)
  console.log(`  ${'chunk'.padEnd(44)} ${'raw'.padStart(10)} ${'gzip'.padStart(10)}  load`)
  for (const r of rows) {
    console.log(`  ${r.f.padEnd(44)} ${kb(r.raw).padStart(10)} ${kb(r.gz).padStart(10)}  ${r.eager ? 'eager' : 'lazy'}`)
  }
  const eagerRows = rows.filter((r) => r.eager)
  const eagerGz = eagerRows.reduce((s, r) => s + r.gz, 0)
  console.log(`  eager: ${eagerRows.map((r) => chunkName(r.f)).join(', ')} (${kb(eagerGz)} gzipped)`)

  if (forbid && i === 0 && eagerRows.some((r) => chunkName(r.f) === forbid)) {
    console.error(`  FAIL: ${rel}/index.html loads the ${forbid} chunk eagerly`)
    failed = true
  }
}
process.exit(failed ? 1 : 0)
