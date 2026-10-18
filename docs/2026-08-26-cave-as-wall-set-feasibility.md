# Cave band as a wall set — feasibility (2026-08-26)

Read-only investigation. Nothing was changed outside this file.

**Question.** The cave demo's visible wall is baked as asset children by a one-shot script. Could the
CaveRoomBuilder kit be expressed as a wall set and laid by `layoutWall` instead?

**Verdict.** Extend the wall-set *system* — the set/spec/node/edit/render plumbing is right and reusable.
Do **not** extend `layoutWall` itself. Its corner detector asks a question the cave cannot answer, its
run-fitter fails the map's own acceptance bar, and its placement model has no room for the kit's joint
geometry. The cheap, correct shape is a second layout function behind the same `WallNode` contract, hung
off a real wall set on the pack side. Keeping the band baked is the wrong long-term answer — everything
downstream of `layoutWall` (edits, door gaps, sprite pooling, node handles) is already generic and would
come for free — but the way in is not through `layoutWall`.

---

## 0. What the engine would actually see

`session/testdata/goblin-warren.mapbuilder` is being regenerated live while this was written
(218-point ring / 434.7-cell perimeter at 02:5x, **256-point ring / 381.9-cell perimeter at 03:47**).
Every number below is from the 03:47 file; the conclusions are identical on both.

The floor is one shape, one contour (`gen-goblin-warren.mjs:527-541`). `computeMergedFloor` hands a lone
ring back untouched (`packages/core/src/engine/mergedFloor.ts:71-72`), so the polygon `renderNodeWalls`
receives (`floorWallRenderer.ts:412-419`) is exactly that 256-point contour.

| measurement | value |
|---|---|
| ring vertices / perimeter | 256 / 381.9 cells |
| edge length, median / max | 1.40 / 3.97 cells |
| per-vertex turn, median / p90 / max | 18.3° / 40.2° / 71.3° |
| vertices turning ≥ 20° (`STRAIGHT_EPS`, `wallLayout.ts:113`) | **105** |
| vertices turning ≥ 45° | 16 |
| vertices within 15° of 90° (`elbowTolerance` default, `wallLayout.ts:96`) | **0** |

Current bake: 243 asset children, of which **127 band pieces** — 63 straights (`wall_short_2x2` ×35,
`2x4` ×26, `2x6` ×2) and **64 bends** (32 inside, 32 outside) — plus 20 `ledge_*`.
**Half the band is bend pieces.**

---

## 1. Spec model fit

`WallPieceSpec` (`wallLayout.ts:29-42`) is `{ id, role, lengthPx, thicknessPx, authoredTurn?, swapOnly? }`.
It encodes one idea: *the piece is a rectangle whose spine runs along its own local +x, through its centre*.
That is exactly how the forge sets are authored — every `GG_Fieldstone` straight carries
`contentRect { x:0, y:66, w:frame.w, h:68 }`, i.e. content centred on the tile's horizontal midline, full
tile width (verified across all 58 `gg-forge` entries). The renderer then anchors at 0.5 and rotates
(`wallNodeRenderer.ts:152-157`), with `resolveTexture` trimming to `contentRect` first
(`textureLoader.ts:20-34`).

The cave kit is authored to a different contract: two measured **joint** points per piece, with the void
on the left of travel (`scripts/cave/pieces.json`). Decomposing each piece's joint pair into its own chord
frame — `along` and `perp` are the offset from the **sprite centre** to the **chord midpoint**:

| piece | turn | chord (cells) | chord angle in tile | along | perp | arc sagitta |
|---|---|---|---|---|---|---|
| wall_short_2x2 | 0 | 1.971 | −89.9° | 0.002 | −0.014 | 0 |
| wall_short_2x4 | 0 | 3.969 | −90.0° | 0.002 | 0.049 | 0 |
| wall_short_2x6 | 0 | 5.969 | −90.0° | 0.002 | −0.029 | 0 |
| inside_bend_2x2 | +90 | 1.470 | −45.0° | 0.021 | **0.478** | 0.304 |
| inside_bend_3x2 | +90 | 2.286 | −27.0° | 0.182 | **0.428** | 0.473 |
| inside_bend_3x3 | +90 | 2.883 | −45.0° | 0.007 | **0.471** | 0.597 |
| inside_bend_4x4 | +90 | 4.303 | −45.0° | 0.021 | **0.440** | 0.891 |
| inside_bend_5x3 | +90 | 4.526 | −26.8° | 0.055 | **0.523** | 0.937 |
| outside_bend_2x2 | −90 | 1.284 | −136.8° | 0.066 | **−0.438** | 0.266 |
| outside_bend_3x2 | −90 | 2.132 | −154.1° | 0.097 | **−0.374** | 0.442 |
| outside_bend_3x3 | −90 | 2.736 | −135.0° | −0.054 | **−0.524** | 0.567 |
| outside_bend_4x4 | −90 | 4.151 | −135.0° | −0.023 | **−0.398** | 0.860 |
| outside_bend_5x3 | −90 | 4.384 | −153.8° | 0.160 | **−0.385** | 0.908 |
| outside_bend_5x5 | −90 | 5.567 | −135.0° | −0.010 | **−0.459** | 1.153 |

(Joint order normalised the way the generator does it, `gen-goblin-warren.mjs:72-78`.)

Mapping each datum onto the spec:

| datum | home in `WallPieceSpec` | verdict |
|---|---|---|
| chord length | `lengthPx` | fits — **but only after the art is re-exported.** Straights run along the tile's +y (chord angle −90°); the spec assumes +x. |
| band thickness | `thicknessPx` | partial. The three straights are authored 1.495 / 1.720 / 1.645 cells thick. One `wallWidth` forces them equal — factors 1.00 / 0.87 / 0.91 — so their chords come out 1.98 / 3.46 / 5.44 instead of 1.97 / 3.97 / 5.97. |
| turn magnitude | `authoredTurn` | value fits (90° → π/2). |
| turn **sign** | none | **no home.** `elbowFor` compares `Math.abs(turn)` against `Math.abs(authoredTurn)` (`wallLayout.ts:201-203`) — inside and outside bends are indistinguishable to it. Handedness is the whole point of the kit. |
| chord angle inside the tile (−27°…−154°) | none | **no home.** |
| joint offset perpendicular to the chord (0.37–0.52 cells on every bend) | none | **no home**, and **not derivable**. It is not the arc sagitta: the perp/sagitta ratio runs 1.57 (2x2) down to 0.40 (5x5). |
| void-side handedness | none | expressible as two roles, or as a signed `authoredTurn`. |
| band offset 0.18 cells into the void (`gen-goblin-warren.mjs:675`) | none | **bakeable into `contentRect`** — padding the floor side of the rect moves the trimmed content's centre toward the void, and it scales with `wallWidth`, which is what you want. |
| mirrored variants | none | `placeNodes` never emits a negative scale (`wallNodeRenderer.ts:155-156`). The generator turns 3 straights into 6 with `flipY` (`gen-goblin-warren.mjs:83-88`); a wall set gets 3. |

**Can the missing data be baked into the art instead of added to the spec?** For straights, yes — one 90°
re-export and they are ordinary forge-convention pieces. For bends, **no**. You would have to rotate each
bend by 27°–45° so its chord lies on +x (raster resample, tile grows by up to √2) *and* pad it
asymmetrically so the bbox centre lands on the chord midpoint. `contentRect` is an axis-aligned rect of
non-negative integers (`packages/vault-engine/src/schemas/pack-manifest.ts:13-18`), so after that rotation
you cannot get *both* `lengthPx = chord` and `thicknessPx = band` out of one rect — the rotated blob's
bbox is neither. `toSpec` only falls back to the set's band when `contentRect` is absent
(`wallNodeRenderer.ts:60-61`), and then `lengthPx` becomes the whole padded tile width. The two
requirements are mutually exclusive. **A bend needs its joints carried as data, or it needs its own
layout function.**

---

## 2. Layout algorithm fit

### How `layoutWall` works

1. **Simplify** — drop vertices closer than `wallWidth × 0.5` (`wallLayout.ts:788-802, 844`).
2. **Junction pass** (`:882-961`) — for every vertex, `turn = norm(curr.ang - prev.ang)`, a strictly
   **per-vertex** quantity. Below `STRAIGHT_EPS` (20°) the vertex is ignored and the run bends through it.
   Above it the vertex gets either:
   - an **elbow**: an authored `corner` piece, chosen only when `||turn| − authoredTurn| ≤ 15°` (`:194-207`); or
   - a **fan** (`:899-945`): a *cover stone* taken from `rocks` — or from `straights` if the set has no
     `connector` pieces (`:854`) — laid on the vertex, plus one angled arm along each side when the turn
     is ≥ `ARM_TURN_MIN` (65°, `:134`). Below 65° it is cap-only.
3. **Runs** (`:1085-1104`) — the spine between two reserved junction regions, crossing as many edges as it
   likes; `pieceLimit` (`:1069-1083`) caps piece length by the run's curvature (sagitta ≤ `wallWidth × 0.25`).
4. **`fillRun`** (`:241-297`) — take the longest piece that fits, repeat, then absorb the remainder by
   scaling every chosen piece uniformly **along the spine only** (`nodeSpriteScale`, `:170-177`), floored at
   `MIN_PIECE_SCALE` 0.45.
5. **Placement** (`:1121-1139`) — each piece is centred on the **chord** between the two spine points it
   spans. No lateral offset of any kind.
6. **`ending`** caps only on open chains (`:973-976, 1143-1146`); a closed ring gets none.

### What it would do to this ring

I ported the junction pass, `pieceLimit`, run construction and `fillRun` verbatim and ran them on the real
256-point contour with the cave pieces as `straight` + `corner` (charitable case: chords and thicknesses
authored correctly, art already rotated).

| `wallWidth` | junctions | bends placed | fan cover stones | runs | run stones | total nodes |
|---|---|---|---|---|---|---|
| 0.5 (the map's current value) | 104 | **0** | 104 | 104 | 285 | ~399 |
| 1.0 | 98 | 1 | 97 | 98 | 146 | ~254 |
| 1.5 (`WALL_SET_DEFAULTS.maxWidth`) | 97 | **3** | 94 | 97 | 105 | ~214 |

At the only plausible band width the layout places **3 of the 64 bends the map needs** and drops
**94 cover stones** — one `wall_short_2x6` laid flat across the wall every 4 cells — onto a smooth curve
that today gets none. Run mix at 1.5: `2x2` ×64, `2x4` ×40, `2x6` ×1.

### Why, precisely

**The mechanisms that work:**

- Runs span edges rather than sitting one-per-edge (`:1032-1039`), so a tessellated curve is one row of
  stones. This is the same insight the generator's chord walk has.
- `pieceLimit` (`:1069-1083`) is a real curvature limiter: it computes exactly the "does this rigid piece
  bow off the spine" question, by arc and by sharpest kink. Measured limits on this ring at `wallWidth` 1.5:
  min 3.36, median 4.72 cells — sensible.
- Chord placement (`:1126-1136`) is the same construction as `placePiece`: a piece spans P→Q on the curve.
- `fillRun`'s remainder-spreading (`:290-296`) is better than the generator's closure search — no
  stretch-to-close pass needed on a ring.
- `withoutDoorGaps`, `applyWallEdits`, `fillNodeGaps`, `applyCornerPieces`, the sprite pool and the node
  overlay are all generic over `WallNode`. None of them care how the nodes were produced.

**The mechanisms that do not:**

1. **Corner detection is per-vertex; the cave's corners are distributed.** `turn` at `:887` is the angle
   between two adjacent edges. A cave corner is not one vertex — it is 3–4 vertices each turning ~20°.
   Measured on the ring, turn accumulated across a span the size of a piece's own footprint:

   | span (a real piece chord) | median turn | p75 | fraction ≥ 45° |
   |---|---|---|---|
   | 1.97 cells (`wall_short_2x2`) | 31.0° | 42.5° | 19% |
   | 2.88 cells (`inside_bend_3x3`) | 39.7° | 51.6° | **38%** |
   | 4.30 cells (`inside_bend_4x4`) | 54.3° | 71.6° | **60%** |
   | 5.57 cells (`outside_bend_5x5`) | 58.4° | 83.9° | **60%** |

   Per-vertex, **0 of 256** vertices are within `elbowTolerance` of 90°. Across a bend's own footprint,
   38–60% of the ring qualifies. The generator asks the second question
   (`turnDeg(tangentAt(curve, i), tangentAt(curve, hit.i))`, `gen-goblin-warren.mjs:749`); `layoutWall`
   structurally cannot. **This is not a constant to tune** — widening `elbowTolerance` to 45° would let a
   90° bend land on a 45° single-vertex kink (failure B5, "hinge bend", in the design bar) while still
   missing every distributed corner.

2. **It can decline to place a 90° piece on a gentle curve — by never placing one at all.** The family
   gate the brief asks about exists only as a side effect: bends are tried only at junctions, and only
   within `elbowTolerance`. There is no positive path from "this stretch turns 50°" to "use a bend", and
   no path from "this stretch turns 5°" to "must not". The design bar's A7 criterion (bend only where the
   edge turns ≥45° within the piece's footprint, straight under 25°) is unrepresentable.

3. **No arc fit, no sideways nudge.** `layoutWall` places a piece on the chord, full stop
   (`:1133-1137`). On a convex ring that puts the whole piece inside the curve by the full sagitta at
   mid-span and flush at the ends — up to 0.375 cells at `wallWidth` 1.5. `fitArc`
   (`gen-goblin-warren.mjs:631-649`) instead takes the residual's **half-range** as the error and its
   **midpoint** as a lateral nudge, halving the drift and splitting it either side. Its own comment says
   this is what lets 4-cell pieces onto a lobe at all. `LayoutOptions` (`wallLayout.ts:72-86`) has
   `wallWidth`, `seed`, `elbowTolerance`, `overlap` — no lateral term anywhere.

4. **Run fitting is non-uniform, which is the map's own top failure mode.** `node.scale` acts on the spine
   axis only, by design (`wallLayout.ts:54-62`; `nodeSpriteScale:176`), down to 0.45. That is precisely
   failure **B1 "Squash / stretch"** in `docs/2026-08-26-cave-design-bar.md` — "stone grain goes
   elliptical". The generator refuses to go past ±12% *uniform* for exactly this reason
   (`gen-goblin-warren.mjs:710-711, 726`). Forcing one band thickness across pieces authored 1.495–1.720
   cells thick is a further 13% non-uniform squash on every `wall_short_2x4`.

5. **No anti-repeat.** `fillRun` is largest-first (`:263-273`); variety exists only among pieces of
   *identical* length. With one variant per length and no mirrors, a 16-cell run becomes three
   `wall_short_2x6` in a row. The generator caps runs at 3 of the same id (`:742`) and adds a share
   penalty (`:756`); the design bar's A8 asks for ≤35% from one id and ≤3 consecutive.

6. **The fan branch would fire ~100 times.** With no `connector`-typed pieces in the cave set,
   `fanPieces` falls back to the straights (`:854`) and the cap is the longest of them (`:906-908`) —
   a 5.4-cell straight laid across the band at every 20° kink.

---

## 3. `buildPieceSpecs` and the pack

The 17 cave entries ship as objects, not walls:

```
inside_bend_3x3_object_A  {"type":"object","material":"inside_bend","gridSize":"3x3",
                           "pieceType":"object","frame":{...,"w":550,"h":546},
                           "set":"demo-structures","tags":["structure"]}
```

Four things stop them reaching `layoutWall` today:

1. **`type` must be `wall`.** `packCatalog.build` only files an entry into `wallSets` when
   `entry.type === 'wall' && entry.set` (`packCatalog.ts:79-83`). `demo-structures` is therefore not a wall
   set, `getWallSet` returns `[]`, `buildPieceSpecs` returns `[]`, and `specsFor` returns `null`
   (`wallNodeRenderer.ts:473-478`). `wall` is already in the manifest enum
   (`schemas/pack-manifest.ts:8-11`) and `pieceType` is a free-form string (`:24`), so this is a manifest
   edit, not a schema change.
2. **`pieceType` must be `straight` / `corner` / `connector` / `ending`** — `getWallPieces` filters on it
   exactly (`packCatalog.ts:115-117`).
3. **Every bend would still be dropped.** `buildPieceSpecs` skips any corner that is not 1×1:
   `if (e.gridSize !== '1x1') continue;` (`wallNodeRenderer.ts:92-93`). The cave bends are 2x2…5x5.
4. **No `contentRect`.** Every cave entry ships without one, so `toSpec` reads `lengthPx = naturalWidth`
   and `thicknessPx = bandPx` (`:60-61`). Concretely, retyped as-is: `referenceBandPx` picks the longest
   straight by `naturalWidth` — `wall_short_2x4` at 344px — and takes its `naturalHeight`, **800px**, as
   the band. `wall_short_2x2` then has `lengthPx` 299 (its *narrow* axis) and `thicknessPx` 800, so at
   `wallWidth` 1.5 it draws 0.56 × 0.75 cells against art that is 1.50 × 2.00 — 37% size, rotated onto its
   short axis. The model reads the bounding box as length × thickness with the spine on +x; the cave art
   does not obey that.

What `gg-forge` carries that the cave pieces do not: `type: "wall"`, a real `set`, a wall `pieceType`,
and — on every straight, connector and path — a `contentRect` that declares the band
(`{x:0, y:66, w:frame.w, h:68}` on Fieldstone; `y:78, h:44` on Palisade), always centred on the tile
midline. Corners, endings and joints carry **no** `contentRect` on purpose: they arrive as full padded
tiles whose centre *is* the authored attachment point (`wallNodeRenderer.ts:145-151`).

Carrying the joints in the pack would need one new optional field — `joints?: [[x,y],[x,y]]` — in three
places: `schemas/pack-manifest.ts`, the runtime mirror `assetPackManager.ts:43-55`, and `CatalogEntry` +
`build()` in `packCatalog.ts:18-33, 60-74`. Nothing validates the manifest at install time (plain
`JSON.parse`, `assetPackManager.ts:484/836/883`) and the sha256 checksums cover *files*, not entry
records, so a manifest edit is safe as long as the atlas/file hashes are untouched.

**I could not determine from the code how `gg-demo`'s manifest is produced.** Nothing in `scripts/`,
`forge/` or `packages/vault-engine/src` builds it — the pack ships as a committed artifact under
`canvas/public/packs/gg-demo/pack-1d7a64b0.json` and is only ever read. Whether a retype is a re-run or a
hand edit is an open question and belongs in Phase 0.

---

## 4. What it would buy, and what it would cost

**Falls out for free** (all of it already generic over `WallNode`, none of it specific to `layoutWall`):

- **Band follows the floor ring by construction.** `renderNodeWalls` lays along `layer.mergedFloor`
  (`floorWallRenderer.ts:412-419`), which is recomputed from the shape children
  (`mergedFloor.ts:33-72`, healed on rebuild at `floorWallRenderer.ts:372-381`).
- **Live re-lay on a drag.** `ringStoneDrag` turns a stone drag into a floor-outline edit with live
  preview and one undo entry (`packages/core/src/engine/ringStoneDrag.ts:1-12`).
- **Door gaps.** `withoutDoorGaps` cuts, slides, squeezes or refills the stones an opening passes through,
  collected per ring (`wallNodeRenderer.ts:242-444, 508`).
- **Hand edits that survive a relay.** `applyWallEdits` + `floorWallEdits` keyed by parametric `t`
  (`wallLayout.ts:485-605`), cosmetic-only on rings via `withoutNodeOffsets` (`:617-635`); plus the node
  overlay's handles, Tab-swap, rotate, resize, delete and seam keys.
- **The wall surviving a room-shape change** — same construction as the first item.
- **One fewer authoring artefact.** 127 baked children disappear from the map file.

**Not a gain:** occlusion. The floor ring already emits one occluding wall per edge via `resolveWalls`, so
LOS works today with the band baked — the generator says so explicitly and deliberately authors no
standalone ring wall (`gen-goblin-warren.mjs:543-559`).

**What is lost, versus the current bake** (all of these are live entries on the acceptance bar in
`docs/2026-08-26-cave-design-bar.md`):

| lost | criterion it breaks |
|---|---|
| uniform-scale discipline (±12% cap) → spine-only stretch to 0.45 | **B1** squash |
| the ±0.18-cell arc-fit nudge | **A2** pebble lip, **B4** band drift |
| the family gate (bend ≥45°, straight ≤35° across the footprint) | **A7**, **B5** hinge, **B6** chamfered polygon |
| the 3-consecutive / share cap | **A8** repetition, **A4** picket fence |
| `flipY` mirrors (6 straights → 3) | **A8** |
| bends at all — 3 of 64 placed | **A7**, **B6** |
| gains ~94 cover stones on a smooth curve | **A5** joints, **A6/A14** shadow quilt |

---

## 5. Sizing

Costs are rough working days for one person who already knows this code.

**Phase 0 — make the cave a wall set on the pack side. ~0.5 day.**
Retype the 17 entries: `type: "wall"`, `set: "GG_CaveRock"`, `pieceType: "straight" | "corner"`. Rename the
manifest to its new hash. Confirm the pack still installs and `getWallSetIds()` lists the set. Resolve the
open question above about how `gg-demo` is regenerated. *Proves:* the plumbing accepts the art.

**Phase 1 — `layoutCaveBand`, and the demo map laid live. ~1–1.5 days. This is the phase that settles it.**
A new pure function in `packages/core/src/engine` with the same signature shape as `layoutWall`, returning
`WallNode[]`. It is a port of `walkClosed` / `chordPoint` / `fitArc` / `placePiece`
(`gen-goblin-warren.mjs:585-783`) against `mergedFloor`, with the joints read from a table keyed by entry
id (ship `scripts/cave/pieces.json` as an engine constant for now — no manifest field yet). One branch in
`renderNodeWalls` at `wallNodeRenderer.ts:499` selects it by set id. Set the layer's `wallTextureSetId`
and delete the 127 baked children.

Two details make this cheap rather than a rewrite:
- **The joint offset needs no spec field here.** `placePiece` already solves for the *sprite centre*, and
  `WallNode` carries absolute `x`/`y`. The offset is consumed at layout time and never leaves the function.
- **Uniform scale is expressible today.** `nodeSpriteScale` returns `[k·scale·sizeScale, k·sizeScale]`
  with `k = wallWidth / thicknessPx`; emit `scale: 1` and `sizeScale = s·thicknessPx / wallWidth` and the
  sprite comes out uniformly scaled by `s`. No renderer change.

*Proves:* the band follows the ring; dragging a ring node re-lays it; and — the real test — re-running
`band2.mjs` / `silh.mjs` / `inward.mjs` from the design-bar doc gives numbers at least as good as the
current bake on A1/A2/A4/A7/A8. If it does not, stop here; the answer is to keep baking.

**Phase 2 — the edit surface. ~1–2 days.**
Door gaps (`withoutDoorGaps` assumes `node.angle` is the piece's long axis and `pieceWorldLength × scale`
its length — both need to be honest for cave nodes, and the refill path must not reach for straights the
cave walk would have rejected). Stable `t` across a relay so `floorWallEdits` re-attach. Overlay handle
positions. Ledges/rubble/cracks stay baked in this phase.

**Phase 3 — move the joints into the pack. ~0.5–1 day.**
Add the optional `joints` manifest field through the three places listed in §3, plus the vault-engine
schema; drop the engine-side table. Only worth doing once Phase 1 has passed.

**Phase 4 — optional.** Retire the band walk from `scripts/gen-goblin-warren.mjs`; it keeps the chamber
graph, floors, doors and dressing.

**The alternative — extending `layoutWall` — for contrast.** Signed `authoredTurn` plus handedness plus a
chord-angle field plus a joint-offset field on `WallPieceSpec`; a footprint-turn corner detector replacing
the per-vertex junction pass; a lateral nudge term in the run placer; a uniform-scale mode alongside the
spine-only one. That is a rewrite of the three load-bearing passes of an 1151-line file that six shipped
wall sets and their hand edits depend on, for a piece vocabulary that shares none of its structure. Higher
risk, more regression surface, and no reuse won — the cave path and the junction/run path would agree on
nothing but the `WallNode` type they both emit. Which is exactly why that type, and not the function
above it, is the right seam.

---

## Appendix — reproducing the numbers

- Ring geometry, turn distribution, band-piece census: read `contours[0]` of the single `shape` child of
  layer `Warren` in `session/testdata/goblin-warren.mapbuilder`; the file regenerates, so re-measure.
- Joint decomposition (§1 table): for each entry of `scripts/cave/pieces.json`, normalise joint order the
  way `gen-goblin-warren.mjs:72-78` does, then project the joint midpoint onto the chord frame
  (`along` = chord direction, `perp` = right of travel).
- `layoutWall` simulation (§2 table): the junction pass (`wallLayout.ts:882-961`), `pieceLimit`
  (`:1069-1083`), run construction (`:1085-1104`) and `fillRun` (`:241-297`) ported verbatim and run on
  the real contour, with `role: 'straight'` for the three `wall_short` and `role: 'corner'`,
  `authoredTurn: π/2` for the eleven bends.
