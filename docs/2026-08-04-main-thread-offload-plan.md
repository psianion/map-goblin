# Main-thread offload — plan (2026-08-04)

Goal: zero perceptible main-thread stalls from terrain painting, autosave, map
switch, and session map load. Not "smaller freeze" — no full-map work on the
render thread, ever. Audit (Sonnet agent, this session) found four offenders;
everything else in the codebase is already async/bounded.

## Audit findings → disposition

| # | Finding | Disposition |
|---|---------|-------------|
| 1 | `persistNow()`: 2× full 2048² `extract.pixels` + 8M-px bounds scan + `extract.base64` PNG encode, behind 1.2 s debounce | **Fix** — worker owns splat state; persist becomes a postMessage |
| 2 | `endStroke()`/`extractRegion()`: 4 region readbacks per mouse-up, unbounded by stroke bbox (corner-to-corner drag ≈ full canvas ×4) | **Fix** — async WebGL2 readback (PBO + fence), snapshots become async |
| 3 | Autosave + every map switch: full-document `JSON.stringify` incl. all base64 images (splats + imports), then gzip | **Fix** — serialize/deserialize in worker; splat base64 never exists on main thread |
| 4 | Session map load: customImages base64 inside JSON over HTTP; `restoreCustomImages` decodes sequentially | **Fix** (user opted in) — binary asset endpoints + parallel fetch |
| 5 | `exportPipeline.ts:111` `extract.image` at uncapped export resolution | **Track** — explicit one-shot user action; GitHub issue, not this PR |
| 6 | `roomSync` wholesale recompute (~8 ms) | Leave — already ponytail-flagged in code, not in this cost class |

## Decisions (user-confirmed)

- `.mapbuilder` stays **single JSON** (gzip'd, magic header, base64 data URLs
  inside). No container format change; old files keep loading. The base64 is
  simply *produced in a worker at save time* instead of living in the store.
- **Binary session sync in this PR**: server splits customImages out of the
  map JSON and serves them as binary; client fetches in parallel.
- Undo/redo stalls included. No dropped findings — fix or track.

## Architecture

### One worker: `terrainSaveWorker` (packages/core)

Single module worker, message-typed ops. Lives in core so editor (canvas) and
session client both get it. Vite's `new Worker(new URL(...), {type:'module'})`
works with zero config in both apps.

**Splat ops** — the worker owns the canonical CPU copy of both 2048² splatmaps
(32 MB in worker heap, none on main thread):
- `seed {rtIndex, pngBytes}` — decode via createImageBitmap + OffscreenCanvas,
  hold raw pixels. Sent on map load / map switch / reset.
- `patch {rtIndex, rect, bytes}` — apply a stroke/undo region to the copy,
  mark dirty, debounce 1.2 s → then, *in the worker*: full bounds scan
  (8M iterations off-thread ≈ tens of ms, replaces incremental-AABB
  complexity — always rescan, always correct) + PNG encode via
  OffscreenCanvas.convertToBlob → reply `{bounds, pngBytes per dirty rt}`.
- Main thread on reply: `setTerrainData({bounds})`, retain PNG bytes as Blob
  for save/export. No readback, no scan, no encode on main.

**Save ops**:
- `serialize {doc, splatPngs}` — inject splat base64 into
  `customImages` (base64 computed here), `JSON.stringify`, `gzipSync`,
  transfer bytes back. Replaces body of `serializeToBytes`.
- `deserialize {bytes}` — gunzip, parse, extract splat data URLs → decoded
  raw pixels + png bytes, transfer back `{doc, splats}`. Replaces body of
  `deserializeFromBytes`. Main uploads raw pixels straight to RTs
  (BufferImageSource — no Image.decode on main).

API note: `serializeToBytes`/`deserializeFromBytes` are already async — call
sites don't change.

### Async GPU readback (engine utility)

WebGL2: `readPixels` into PIXEL_PACK_BUFFER → `fenceSync` → poll on ticker →
`getBufferSubData`. Never blocks the pipeline. Sync `extract.pixels` fallback
if the context isn't WebGL2. Used by `extractRegion` only (the per-stroke
undo snapshots) — full-map readback no longer exists anywhere.

`endStroke()` becomes async; `TerrainStrokeCommand` is pushed after snapshots
resolve (pointer events are sequential, ordering holds). `regionsEqual` moves
to a Uint32 word-compare with alpha mask (~4× fewer iterations, few ms worst
case at mouse-up only).

### Splats leave the store

`assets.customImages` no longer carries `__terrain-splat-N__` data URLs — the
store holds no splat bitmap data at all (bounds only). The
TerrainRenderer store-subscribe watcher is replaced by an explicit load/seed
path. `restoreCustomImages` skips splat keys and loads the rest with
`Promise.all` (fixes the sequential-decode finding). Imported pictures stay
as data URLs in the store — their stringify cost rides in the worker now, and
their base64 was paid once at import.

Consequences handled: autosave change-detection (`isDocumentChange` compares
customImages) gets a terrain dirty-counter instead; map switch resets + seeds
the worker; `.mapbuilder` output is byte-compatible with today's format.

### Session binary sync

Server (`session/server`): on map import, split `customImages` out of the
stored JSON; `GET .../maps/:id/images/:key` serves raw image bytes
(decoded once, cached). Scene map JSON lists image keys instead of inline
data URLs. Client (`loadSceneMap`): fetch JSON + all image binaries in
parallel; blobs → ImageBitmap → textures; splat blobs → RT upload + worker
seed. Internal API (client+server ship together) — no wire-format compat
shim, but importing old .mapbuilder files still works since the split happens
server-side at import.

## Order of work

1. Branch `perf-main-thread-offload`.
2. Worker skeleton + splat ops; rewrite TerrainRenderer persist/restore.
3. Async readback utility; endStroke/undo async snapshots.
4. Serialize/deserialize ops; wire saveLoad/autosave/map-switch.
5. Session server split + client parallel fetch.
6. Small fixes: Promise.all restore, Uint32 regionsEqual; file issue for
   export-resolution cap.
7. Tests: worker handlers as pure importable functions (bounds, patch,
   serialize roundtrip incl. old-file load), async command flow.
8. Gate: Docker + Chrome, fully-dressed demo map, PerformanceObserver
   longtask before/after while painting + autosave + map switch. Zero
   console/network errors.

## Phase 2 (same branch): texture units, ambient fidelity, movement

User-reported after the perf work landed; all to be fixed here before ship.

### 1. Texture unit scale — "too many squares"

Symptom: terrain brush preview (and painted terrain / floor fill) tiles a
dense checkerboard — the drawn pattern repeats far too small.

Convention everywhere is 200 texture px = 1 grid cell (brush preview matrix,
splat shader `uTile = natural/200`, floor fill `tileScale = userScale/200`).
A texture whose file is a *sheet of variant tiles* (or whose natural size
disagrees with the 200px/cell contract) tiles the whole sheet → many squares.

Plan:
- Audit the palette/floor/wall/water-bank textures on disk: which are
  single seamless tiles, which are variant sheets, and their real px-per-cell.
- Add unit metadata to the texture manifest (`unitRect` or cols×rows) for
  sheet assets; default = whole image.
- One choke point: a `unitTexture(id)` helper in textureLoader returns the
  unit region (sub-rect texture). Every consumer goes through it:
  terrain palette extract (already extracts to an RT — switch to sub-rect),
  floor-fill TilingSprite, brush preview fill, water banks, background fill.
- WYSIWYG check: brush preview, painted result, and floor fill must show the
  identical pattern scale. Gate against docs/art-style-guide.md.

### 2. Ambient/background fidelity

The light-tool change (half-res lightmap) is approved and stays. What must
not change is the *ground under ambient light*. The terrain bake caps at
32 texels/cell, so past ~1.6× zoom the ground is visibly softer than the old
live 200px/cell shader — reads as "ambient background got worse".

Plan: keep the 32px/cell full-extent bake as the base (pan/idle path), and
re-bake just the visible viewport window at display density (up to
200px/cell, viewport-sized RT) on zoom-settle, debounced off the movement
path. While the camera moves the base bake shows; when it rests the crisp
window fades in. Verify ambient composite output is otherwise byte-identical
(flat ambient fill is resolution-independent).

### 3. Movement residuals (seamless 60fps bar)

- Grid renderer rebuilds its line Graphics whenever the visible range
  changes — i.e. every frame of a zoom. Cache by quantized range / throttle
  to zoom-settle, or draw via a shader/TilingSprite.
- `preserveDrawingBuffer: true` costs a present-copy every frame for every
  user, to serve E2E pixel sampling. Gate it behind a query flag and plumb
  the flag through the E2E suites and gate-walk docs.
- Set `powerPreference: 'high-performance'` at init so laptops with a dGPU
  stop rendering on the integrated one.
- Re-measure pan/zoom/paint on a cool machine after each change; final
  numbers into the gate report.

### Phase 2 verification

- Side-by-side screenshots vs main: terrain at 1×/2×/4× zoom, ambient scene,
  torch-lit scene — no visible regression (art style guide is the gate).
- Full Docker+Chrome gate walk on the dressed crypt: paint, pan, zoom,
  undo, save, reload, table load — 60fps target, zero console/network
  errors, then the ship routine.

## Verification bar

- No long task > 50 ms attributable to paint-persist, autosave, or map
  switch on the demo map.
- Old .mapbuilder files load; new saves load in old… (n/a — new saves are
  format-identical).
- Undo/redo of long strokes: no hitch, correct pixels.
