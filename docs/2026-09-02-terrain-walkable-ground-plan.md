# Painted terrain is ground — plan

**Date:** 2026-09-02 · **Status:** awaiting approval · **Branch target:** stacked on `vision-containment` (worktree `D:\Labs\map-goblin-vc`)

## The problem, from the root

The editor has two kinds of ground that render identically and mean opposite things:

- **Floor shapes** (`ShapeChild` polygons) → merged floor → rooms → grid, movement, fog, reveal. Real ground.
- **Terrain paint** (the toolbar's Terrain brush) → splatmap raster, composited as decoration. Fake ground: no grid, no standing, no reveal, no fog participation.

This was never a regression — the terrain brush has been a pure splat painter since it was born (PR #31), and PR #53/#112 only changed how the decoration composites. But the design is wrong per the product ruling of 2026-09-02: *ground the author painted is ground.* The Goblin Warren's trunk was the live demonstration: painted paths the engine treated as void.

## Decision: raster walkability, baked in the editor (not vectorization)

Two candidate roots were considered. **Vectorizing paint into floor polygons is rejected** on the evidence:

- No production raster→polygon tracer exists (the only marching-squares lives in the retired fog oracle, harness-only by decree — `vectorFog.ts:1-19`).
- Room re-detection on every stroke would re-mint room ids continuously, and room-id churn is an *known live bug class* (republish already orphans fog state keyed by room ids — found 2026-09-02).
- Decorative paint deliberately overlaps real floors (PR #53's whole point), so traced polygons would double-author ground and churn room boundaries everywhere paint sprawls.

**Chosen root: the walk mask.** The editor derives a cell-resolution walkability bitset from the weight splats and persists it in the document. The raster stays the author's truth; the bitset is its cell-grid shadow. Nothing about rooms, room ids, or room detection changes.

### Why this shape wins

- **The server never decodes a pixel.** Today the server has no image decoder and shouldn't grow one (`session/server/package.json` — no raster dep). The editor already holds the splat bytes; it bakes, the server reads bits.
- **The wire format already exists.** `RegionMask` (1 bit/cell, base64, `region.ts:32-53`) is exactly this shape, capped at 512×512 cells.
- **The cell-ground model already exists.** #114's roomless battlemaps made frame=floor work through the entire vision/fog/containment stack. Terrain cells are the same species: authored, wall-less, cell-granular ground.
- **Tint stays decoration.** The paint test counts weight channels only (map0.RGB + map1.RGB); the tint layer (alpha-as-coverage, no weight — `terrainShared.ts:14-18`) never becomes ground. Painting mud makes ground; tinting moss does not.

## The bake (editor)

- **Where:** beside `syncRooms` — on geometry-affecting terrain edits (debounced, same 250ms rhythm) and always before serialize/export.
- **Rule:** a cell is terrain-ground iff ≥ 50% of its 16×16 texel block (16 texels/cell — `terrainShared.ts:8-33`) is painted, "painted" = the existing CPU cutoff (`r+g+b ≥ 1` per byte texel, `splatWorkerOps.ts:79-84`). Majority-of-block, not center-sample, so feathered stroke edges neither leak nor pinhole. Constant, no UX in v1.
- **Persist:** `mapSettings.terrain.walkMask: RegionMask` (anchored like the region record, `minX/minY/cols/rows/bits`). Absent field = no terrain ground (all old maps unchanged).
- **Perf:** the bake is a single pass over the painted AABB only (`terrain.bounds`), in the existing splat worker.

## Consumption (mechanics + server + client)

One new floor source, threaded through the three predicates that define ground:

```
terrainGround(x,y) = walkMask bit at cell (⌊x⌋,⌊y⌋)
onAuthoredFloor    = (rooms hit) ∨ terrainGround          — standable
nearAuthoredFloor  = (floor ∪ 1-ring) ∨ terrainGround ∪ 1-ring — recordable
openGroundOf       = record ∩ onAuthoredFloor (unchanged rule, wider floor)
```

- **Movement:** `occupyRefusal`'s `room === null` branch consults `openGround` as today — terrain cells the party has been shown are standable. The "two islands no player can cross" trap dies wherever the author painted a path.
- **Vision fog (the mode this matters in):** terrain ground joins `shippedGround` on walled maps (client `tierPlan`), so the near-pass may open it and the mask clip doesn't cloud it; the record clamp accepts it; auto-explore writes it; the DM brush reveals it. Containment semantics unchanged — the fence composition never asked *why* a cell is floor.
- **Rooms mode (v1 boundary):** terrain ground becomes standable via the same `openGround` extension **only where the record holds it** — and rooms mode has no record tooling, so v1 explicitly does *not* make terrain paths revealable in rooms mode. That is a declared limit, not an accident. P2 sketch (separate approval): connected walk-mask blobs surface as pseudo-rooms in the fog panel ("Path 1"), revealable/hideable like rooms. Not in this build.
- **Wire hygiene:** the walkMask ships to players **cut to shown ground** exactly like `lockMask` (same stamping point, `redactMap`), so an unexplored painted path's shape never leaks. DM doc carries it whole.
- **Server frame:** already honors `terrain.bounds` (`sceneMap.ts:154`) — no change.
- **Grid (the user's tell):** the grid mask becomes `mergedFloor ∪ walkMask cells` (`floorWallRenderer.ts:324-370` gains a second mask source). Painted ground gets grid lines — the visible contract that the engine considers it real.

## Not in scope, tracked separately

1. **Republish orphans fog state** (new room ids → explored rooms silently revert). Real bug, hits any mid-campaign republish; needs an id-migration or geometry-keyed remap. Own fix, own review.
2. Rooms-mode pseudo-rooms for terrain blobs (P2 above).
3. LOS/walls on terrain ground — painted ground has no occluders by design (open country). Authors who want walls draw walls.

## Test plan

- Mechanics: predicate rows for terrainGround (stand/record/refuse × painted/unpainted/feathered-edge), R-row additions mirroring the containment contract on a walk-mask map; mutation-checked.
- Server: cut-doc rows (mask cut to shown ground; absent field = absent), move refusal flips on painted cells.
- Client: tierPlan rows (terrain ground in shippedGround; mask clip), grid-mask row.
- Editor: bake rows (threshold at 50% block, tint excluded, bounds-anchored), serialize round-trip.
- Live gate: Warren-style map with a painted-only path — walk it seated, grid visible, cloud peels by sight, refusal toast on unpainted void.

## Estimate

Editor bake + core types ~1 agent-day; mechanics/server/client threading ~1–2; tests and live gate ~1. Orchestrated as 3–4 scoped agents (Opus build, Sonnet gates), contract-first like vision-containment.
