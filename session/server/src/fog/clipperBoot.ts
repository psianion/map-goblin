// D3's runtime waiver, per-line like sweep.ts's header: Clipper2Engine.ts is pure geometry,
// pixi-free by design — this is what makes `sceneMap.ts`'s `healMergedFloor` real rather than
// the identity fallback `clipper2Engine.union`/`.difference` silently return when nothing has
// called `setClipperModule` (see that gate's comment for why a degraded union is worse than
// leaving `mergedFloor` null).
//
// Loads once at server boot, before `startServer` starts accepting connections (index.ts), so
// every `sceneMapOf()` for the life of the process sees Clipper already up — `index()` itself
// stays synchronous and just checks `isClipperReady()`. The ESM build (`dist/es/clipper2z.js`)
// fails under plain Node with "fetch failed": it tries to fetch its own .wasm relative to
// `import.meta.url`, which Node's loader does not serve. The UMD build takes a `wasmBinary`
// directly and skips the fetch.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Clipper2ZFactoryFunction, MainModule } from 'clipper2-wasm/dist/clipper2z'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design (see above)
import { setClipperModule } from '@dnd/core/src/geometry/Clipper2Engine'

let bootPromise: Promise<boolean> | null = null

/**
 * Loads Clipper2's WASM and hands it to core's engine. Memoized — every call after the first
 * (one per test file, one per `startServer`) returns the same settled promise rather than
 * re-instantiating the module.
 *
 * Never rejects: a load failure is caught and reported `false`, and `sceneMap.ts`'s gate
 * leaves `mergedFloor` null exactly as it does today — the known-safe fallback.
 */
export function ensureClipperReady(): Promise<boolean> {
  bootPromise ??= load()
  return bootPromise
}

async function load(): Promise<boolean> {
  try {
    const require = createRequire(import.meta.url)
    const clipperPath = require.resolve('clipper2-wasm/dist/umd/clipper2z.js')
    const factory = require(clipperPath) as Clipper2ZFactoryFunction
    // `readFileSync` hands back Node's `Buffer` (a `Uint8Array<ArrayBufferLike>`), which is not
    // assignable to the plain `ArrayBuffer` the factory declares — a fresh `Uint8Array` copy's
    // own `.buffer` is one.
    const wasmBinary = new Uint8Array(readFileSync(clipperPath.replace(/\.js$/, '.wasm'))).buffer
    const mod: MainModule = await factory({ wasmBinary })
    setClipperModule(mod)
    return true
  } catch (err) {
    console.error('Clipper2 WASM failed to load — mergedFloor heal stays off:', err)
    return false
  }
}
