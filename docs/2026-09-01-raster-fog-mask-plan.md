# Raster fog mask — plan (2026-09-01)

**Status: DRAFT — awaiting approval. Nothing here is built.**

The follow-up phase named three times (token-vision plan §perf, gate report §5.3, ambient-light
plan W3): composite the vision-mode tier mask on the GPU from cheap primitive draws, instead of
computing polygon booleans on the CPU and triangulating the result. One change, three debts paid:

1. **Perf** — the per-drag Clipper pass (`visionRegion`: ~13ms day / ~20ms night median on the
   gate map, inside the pinned ≤30ms budget) retires. The P6 adjudication said the only lever
   left was "fewer vertices going in"; this removes the vertices entirely.
2. **Stair-stepped memory edges** — the `MASK_MAX_CELLS` (32k) ceiling dies. Past it the explored
   tier degrades to one-cell staircase rects today (ambient plan W3 flagged it as a visual bug,
   not just perf). The GPU path has no such ceiling: the record becomes a texture.
3. **One edge treatment** — every tier edge (live, memory, hidden) already reads its look from the
   cloud's blur; after this the *geometry* feeding it is built one way too.

## What does NOT change

- **The cloud shader** (`livingFog.ts` FRAGMENT) — untouched. The tier encoding (0 hidden /
  0x808080 memory / white live), the `maskSoft` blur + remap, the `min()` coastline, pools,
  palette: all shipped visual tuning is preserved because the mask *texture contract* is
  preserved. Only how the texture gets its pixels changes.
- **Shadowcast sweeps** (`visionSight.ts`, server `sweep.ts`) — untouched. Sweeps are the
  geometry of sight, not booleans; they stay CPU, memoized per position, and stay the honest
  bound on what a seat is shown.
- **Server, wire, region record, redaction** — untouched. Presentation only, like #101 was.
- **Rooms mode** — untouched. It rebuilds on reveal clicks, not drags; its memory tier is
  room-shaped (no staircase); its `fogRegion` Clipper cost is irrelevant. Migrating it buys
  nothing and risks the most-walked path. Explicit non-goal.
- **FogOverlay** (DM haze + `REGION_WASH` rects) — untouched. The haze mask is a handful of room
  fills, armed-only; `regionRects` stays for the DM's cell wash (it *wants* cell-exact rects).

## Architecture

### The compositor: a pure draw plan + a thin executor

`visionTiers` + the `maskPaint` half of `drawFog` are replaced by a **tier compositor** with two
layers, split deliberately so the traps stay unit-testable without a GPU:

- **`tierPlan(scene): DrawPlan`** — a pure function producing a description: which sources are
  drawn (polygons, the record's cell texture, stroke widths), into which target, with which blend.
  No Pixi. Every mutation-checked contract in `FogRenderer.test.ts` re-pins against this
  (see Testing).
- **A thin executor** in/beside `livingFog.ts` — standard Pixi objects (`Graphics`, `Sprite`,
  `RenderTexture`, `BlurFilter`) executing the plan with **native blend modes only** (`normal`,
  `multiply`, `erase`). No `pixi.js/advanced-blend-modes`, no new custom shader on the happy path.

### Sources

- **Inflate without Clipper**: a polygon filled *and* stroked with a round-joined stroke of width
  `2r` is exactly the polygon ⊕ disc(r) — the Minkowski inflate `reachOf` was paying Clipper for.
  `pad`/`sightPad`/`FOG_FEATHER` keep their meanings as stroke widths.
- **`heldRT`** (memoized on map/paint/record-structure identity, like today's `heldReach` slot):
  shipped room polys fill+stroke(pad+feather), painted-ground polys fill, and on a roomless map
  the record's cell runs — the same `heldGround` statement, as pixels. This is the clip that keeps
  a 1000-cell ray honest, and it multiplies every pass that touches live sight.
- **Memory source**: the region record uploaded as a `cols×rows` single-channel texture straight
  from its bytes — one texel per cell, zero geometry — drawn as a linearly-upscaled sprite through
  one GPU blur (~⅔ cell, `memoryMask.ts`'s own kernel math: the blurred staircase's half-level
  line IS the smooth diagonal), at the memory grey. Plus DM-revealed room polys fill+stroke.
  Marching squares (`maskRings`) and the CPU blur retire.
- **`liveRT`**: raw sweep polys fill+stroke(sightPad+feather); in darkness, gated by an
  `inverseSeeableRT` built the same way from `night.lit` + `night.darkvision` polys.
- **Mask assembly** into the existing `maskRT` (same `maskScale`, same resize-in-place
  discipline), on the erase-dual P0's `multiply` failure forced: the RT clears **transparent**,
  so alpha carries shown-ness and hidden reads 0 in `.r` either way. Memory grey first, live
  white over it (draw order = max on this vocabulary), then the clip as one `erase` of
  `inverseHeldRT` — white over the whole cover with the held sources erased out of it, so
  erasing *it* leaves exactly what is inside held. Native blends used are `normal` + `erase`
  only, both proven on 8.17. The same erase clips `liveRT` itself, because that target is also
  the token stencil (`SIGHT_MASK`) and that layer never passes through the mask's clip.
  `maskSoftRT` blur unchanged. Reveal-fade layer (`fadePaint`) stays a layer in the same scene —
  rooms-mode-only, unchanged, and dropped outright if the mode flips mid-fade (a live fade is
  what drives the per-frame vector `renderMask`, which on this path would paint over the
  composite).

### The scrim becomes a sprite

Today's scrim is vector Graphics with Clipper-cut holes — it forces the full boolean pass per
drag even if the mask went raster. It becomes: the flat black cover rect (unchanged) with its
holes erased in a **`scrimRT`** — the same clipped sources drawn with the `erase` blend, cell-
exact (the memory source unblurred, nearest-filtered, for the scrim) — rendered as a **plain
Sprite**.

Fail-dark argument, restated for the new shape: the RT initializes opaque black; any failed
compositor pass leaves it opaque; the only primitive trusted to render is the standard sprite
pipeline the map itself renders through — if that is down, there is no map to leak. If only the
*cloud* shader fails, the scrim's edges are texel-exact rather than polygon-exact: bounded by one
texel (≥6 texels/cell), and only over ground whose geometry/paint the client was already shipped
— the documented shipped-geometry leak class, not a new one. Ground never shown remains exactly
opaque on both layers.

### Sight stencil and cover

- **`sightMask`** (the stencil token chips wear, live-only): a texture mask (Pixi v8 sprite mask)
  over `liveRT`. Verified early in P1; fallback is the current vector fill from raw sweep polys
  (server `canSee` already gates which tokens ship, so the stencil's held-clip is belt, not
  braces — note in code if the fallback lands).
- **Cover bounds**: frame ∪ held-source bbox, grown by pad+feather. Never off the raw sweep
  (the county-mask trap, `drawFog`'s own comment) — this rule moves into `tierPlan` where a unit
  test can pin it.

### Probes

`__fogProbe` keeps `rebuilds` / `lastRebuildMs` / `memoryCells` (the record's own bit count, CPU,
per record delta — unchanged). Added, dev-only: `maskAt(x, y)` — a one-texel readback of the
composited mask. Every fog bug so far has been "which half is wrong, geometry or texture"; this
is the discriminating instrument.

## Invariants (carried, restated)

1. The `min()` coastline stands: the organic edge only ever covers more than the mask says.
2. Hidden = exactly opaque: cloud `dense: 1.0` + scrim opaque-by-initialization.
3. Every pass touching live sight multiplies by `heldRT`. The clip's sources are exactly today's
   statement: shipped rooms, painted ground, the record's cells.
4. Nothing sizes off the raw sweep.
5. Degradation direction: a missing texture or failed pass reads as hidden (black init;
   multiply-by-empty = 0). Same direction Clipper-not-loaded fails today.

## What retires

`visionRegion`, `memoryMask.ts` (field/rings), the four `memoOnce` slots, the vision half of
`drawFog`'s Clipper consumption, `MASK_MAX_CELLS`. `fogRegion` stays (rooms mode).
`regionRects` stays (FogOverlay wash, `heldGround` source, scrim cell-runs). `REGION_CELL_MAX`
stays — the record-size cap is wire/mechanics policy and becomes the *only* ceiling, which is the
standardization win.

## Testing

- **Unit (no GPU)**: the traps re-pin against `tierPlan`'s pure output, mutation-checked like
  their predecessors: the roomless-map `UNOCCLUDED`-sweep trap (held source = record runs only);
  painted-ground strip opens the tiers; revealed rooms land in memory, never clear; night gate
  present only under `darkness`; cover never derived from sweep vertices; record bytes →
  texture bytes exact. Executor wiring rides the existing mocked-engine rows (`renderToTexture`
  call counts = rebuild discipline). The old `visionRegion`/`maskRings` rows are deleted with
  their subjects once their contracts are re-pinned — not before.
- **Lone-cell check**: the linear-upscale + GPU-blur path must keep a single swept cell visible
  (the exact failure `MASK_SCALE = 3` was chosen against). Pinned at the gate by readback, since
  jsdom has no GL.
- **E2E**: the sprint3 fog/vision luminance rows are re-baselined honestly for the raster mask —
  folding in the 4 rows already stale on main since #101 (thresholds re-derived, not loosened).
- **Gate** (sprint-verification standard): Docker deploy, two-seat Chrome walk, zero console
  errors, dressed map. A/B GL-readback against a main build at fixed world probe points on
  (a) Fieldstone Keep day, (b) Fieldstone Keep darkness (pools + darkvision), (c) Goblin Warren
  battlemap (roomless, brush + range limit, auto-explore off). Budget re-pinned: rebuild median
  **≤8ms** on the gate map, 8 sighted tokens (honest: the shadowcast sweep is still CPU and
  still in `lastRebuildMs`; ~2ms is the compositor's share, not the rebuild's). 60fps row stands.

## Phases (one branch, per-phase commits)

- **P0 (half a day, first thing)**: a spike proving the three load-bearing Pixi behaviors on
  8.17: `multiply`/`erase` blends into a RenderTexture, sprite-as-mask, round-join stroke as
  inflate (visual + area check vs a Clipper inflate of the same square). Any failure here picks
  the escape hatch *before* the build: a tiny clip shader inside the compositor (fail-dark then
  rests on RT black-init alone — still sound, noted in code).

  **P0 RESULT (2026-09-01, headless Chromium, real GL)**: stroke-inflate PASS (0.003% area error
  vs Clipper), sprite-mask PASS, `erase` PASS, **`multiply` FAIL** — unreliable into
  RenderTextures on 8.17. Decision: no multiply anywhere. The held clip becomes its erase-dual:
  an **inverse-held RT** (white full-cover, held sources erased out) drawn with `erase` into the
  mask — every texel outside held goes transparent, which the shader already reads as hidden.
  Same for the night gate (inverse-seeable erased from live). Native blends used are now exactly
  `normal` + `erase`, both proven. Corollary: the mask RT clears to *transparent* (not opaque
  black) so alpha carries shown-ness — hidden reads 0 in `.r` either way, and the scrim's holes
  are then one erase of `Sprite(maskRT)`. P1 must re-verify the maskSoft blur remap against
  premultiplied alpha at the grey tier (a P0-noted caveat: grey texels are where premultiply
  can bite readback assumptions).
- **P1**: `tierPlan` + executor; player mask, scrim sprite, sight stencil, cover, probes, DM
  sight preview (rides the player path). Unit suites green with re-pinned contracts.
- **P2**: retire the dead code; perf pass; budget re-pin; e2e re-baseline.
- **P3**: Docker gate walk + gate report in docs/.

## Risks / gotchas (from the shipped history — each cost a round once)

- `maskRT.resize()` in place, never recreate — the shader's bind group holds the source.
- The livingFog shader is a JS template literal: a backtick in a comment kills the build with no
  useful console output.
- Vite HMR stacks Pixi mounts → fake 1fps; reload before believing FPS. Cross-package edits can
  serve a stale transform (blank page, no console) — touch the file.
- Lane perf numbers are noisy with live table tabs open; hidden tabs throttle timers — never
  trust `lastRebuildMs` from one.
- VRAM: ~4–6 RTs at mask resolution (long side ≤2048). Fine at gate-map sizes (~6MB each at
  1400×1000); if a huge map minds, intermediates can drop to half the mask scale.

## Non-goals

Rooms-mode migration; server-side anything (region deltas stay backlog); lasso tool; vision
cones; `REGION_CELL_MAX` changes; FogOverlay changes; the torn sight-terminator look debt — the
cloud's warped coastline (#101) likely already paid it; verified at the gate, and if anything
remains it is its own small pass on the cloud, not this plan's.
