# Cave shadow-box tiling — diagnosis (2026-08-26)

Scope: worklist rank 2 in `docs/2026-08-26-cave-design-bar.md` — *"the void is quilted with
per-sprite shadow rectangles"* — against criteria **A6** (one continuous soft band, 0.25–0.35
cell, no rectangular patch, no shadow edge on a piece boundary) and **A14** (the void reads as
one flat field with only that band in it).

Nothing in the map, the pack or the asset pipeline was changed. Every rendered image and every
analysis script quoted below is in **`D:/Labs/cave-shadow-evidence/`** (outside the repo,
untracked; index at the end).

---

## Summary

| Question | Answer |
| --- | --- |
| Baked or engine-side? | **100% baked.** The soft dark shape is painted into every source PNG's own sub-200 alpha. The engine draws **zero** shadows on this map. |
| Does the kit's own demo quilt? | **Yes — the same rectangular stamps are in it.** But its stamps all fall on *one side*: 69% of its void-shadow weight sits in three adjacent compass octants, against our 41% (uniform = 38%). |
| Root cause of *our* look | Not overlap, not spacing, not scale (placement matches the art to within 1%). Our shadow has **no direction**: 51% of it lands in the void and 49% on the floor, pointing every way equally. |
| Top pick | Give the ring one light — place every band piece so its baked shadow faces the same way, then draw one silhouette-wide shadow off the closed wall polyline the map already carries. |

---

## 1. Where the shadow comes from

**It is baked into the source art's pixels.** Four proofs.

**a. Every wall piece carries a translucent skirt outside its opaque rock, 0.27–0.34 cells deep.**
Chamfer distance from the `alpha > 200` core (`a2-skirt.mjs`):

| piece (trimmed, 200 px/cell) | max skirt reach | skirt mean alpha (0–255) |
| --- | --- | --- |
| `Wall, short (2x2)` 299×400 | **0.267 cells** | 78–120 |
| `Wall, short (2x4)` 344×800 | **0.318 cells** | 81–114 |
| `Wall, short (2x6)` 329×1200 | **0.317 cells** | 53–121 |
| `Inside bend (3x3)` 550×546 | **0.335 cells** | 84–112 |
| `Outside bend (3x3)` 525×557 | **0.335 cells** | 68–107 |

That is the A6 width almost exactly — the kit's shadow is the right *size*. Only its
*continuity* and its *direction* are wrong.

**b. The skirt is one flat colour under an alpha ramp — a painted drop shadow, not stone.**
`a3-side.mjs`, band 0.06–0.30 cells out: mean RGB **130–133 / 132–135 / 124–128** on all five
pieces, and **50–62% of each piece's skirt pixels fall in a single 8-level RGB bin** (≈132/140/132).
Painted rock does not do that; one shadow colour at varying opacity does.

**c. It sits on one flank of the band.** Per-scanline skirt width, `Wall, short` pieces:

| | −X side (p90) | **+X side (p90)** |
| --- | --- | --- |
| 2x2 | 0.065 c | **0.310 c** |
| 2x4 | 0.035 c | **0.320 c** |
| 2x6 | 0.055 c | **0.330 c** |

The shadow lives on the piece's local **+X** flank and rotates with the sprite.

**d. It is a scatter of rectangles, not a strip.** `e1-coverage.mjs` walks each `Wall, short`
row by row on its shadow flank and asks how much of the 0.05–0.30-cell band is actually painted:

| piece | band painted | rows with **no** shadow at all | longest bare stretch along its own edge |
| --- | --- | --- | --- |
| 2x2 | **37%** | 37% | 0.20 cells |
| 2x4 | **37%** | 36% | 0.33 cells |
| 2x6 | **40%** | 34% | 0.35 cells |

**A single piece's own baked shadow is already discontinuous.** This is the number that kills
every "re-arrange the pieces" fix (§4).

See `montage-src-white.png` — four pieces over white, then the same four with the opaque core
flooded magenta so only the skirt shows. The skirt is visibly a stack of hard-edged rectangular
brush stamps.

**Isolated on the real map.** `d1-layers.mjs` re-renders the map three ways through one
compositor — full art (`L-full.png`), floor polygon only (`L-floor.png`), and *skirt only*
(`L-skirt.png`: every band sprite with its `alpha > 200` core deleted, so what remains is exactly
the baked shadow). `d2-measure.mjs` over that layer (whole 72×54 map at 70 px/cell, 99 band
sprites):

- baked shadow footprint: **70.1 cell²**
- **35.4 cell² (51%) lands in the void**, mean depth 72.6 (white 255 → 182)
- 34.7 cell² (49%) lands on the cave floor, mean depth 47.3
- the void-side shadow breaks into **4,659 separate blobs**; **71.9% of its area sits in blobs
  spanning under 1 cell**, 90.1% under 2 cells, **nothing spans 5 cells or more**. The largest
  connected shadow anywhere on the map spans **2.7 cells** — against a 435-cell floor perimeter.
- the depth histogram has a hard mode at depth 48–60 (32.8% of shadow pixels — one stamp) with a
  tail out to 168 (three and four stamps piled up). Density does double at overlaps, as graded.

Pictures: `baked-shadow-closeup.png` (10×8 cells of the pure shadow layer — a chain of separate
grey rectangles strung along the wall) and `baked-shadow-layer.png` (whole map).

**A6 asks for one band following the silhouette all the way round. The longest continuous piece
of shadow this map owns is 2.7 cells.**

---

## 2. Does the kit's own demo show the same quilting?

**Yes.** Same art, same stamps — visible at the reference's native 140 px/cell in
`cmp-edge.png` (top row = `D:/DownLs/CaveRoomBuilder/CaveRoomBuilderDemo(22x16).jpg` at 1:1,
bottom row = ours at the same 140 px/cell). Square-cornered grey patches sit outside the ink in
both.

Measured identically on both (`b8.mjs`: flood-fill the void from the image border, blocked by
rock `L<150` and by painted floor `chroma>20`; distances from the rock in cells, so scale
cancels):

| shell out from the rock | reference % shadowed | ours % shadowed |
| --- | --- | --- |
| 0.0–0.1 c | **21.1%** (mean depth 50.5) | **21.5%** (mean depth 41.9) |
| 0.1–0.2 c | 4.6% | 0.2% |
| 0.2–0.9 c | 3.3–4.8% throughout | ~0% |

Neither is a continuous band; at the first shell they are within half a point of each other.
**The reference does not meet A6 as written either** — and per §1d, no arrangement of these
pieces can.

Blob structure at matched 70 px/cell (`c2-blobs.mjs`): the reference keeps 63.6% of its
void-shadow area in blobs spanning ≥1.5 cells; ours keeps **100% under 1.5 cells**, largest blob
span 0.49 cells.

**What actually differs is direction.** `e2-direction.mjs` takes every shadowed void pixel, reads
the direction away from the nearest rock (gradient of the distance field), and histograms it
weighted by depth:

| | E | SE | S | SW | W | NW | N | NE | best 3 adjacent octants |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **reference** | 28% | 26% | 15% | 5% | 6% | 4% | 3% | 12% | **69%** |
| **ours** | 12% | 10% | 14% | 11% | 14% | 12% | 15% | 12% | **41%** |

Uniform — no direction at all — is 12.5% per octant and 38% across three adjacent ones. **Ours
is statistically indistinguishable from uniform.** The reference is strongly ESE; its NW/N/W
flanks carry almost nothing (4% / 3% / 6%).

A closed ring's outward normal points every way, so a purely per-piece baked skirt *cannot*
produce a directional histogram however the pieces are laid. The reference's 69% therefore comes
from **one silhouette-wide drop shadow offset down-right**, composited under the whole map — the
exact thing the worklist proposed. Its per-piece stamps are still there; they are swamped by, and
aligned with, one real shadow.

Ruled out as causes, with numbers (`c1-orient.mjs`):

- **Scale / stretch.** Every band piece is placed at its art's own size — `wall_short_2x2` 1.49
  vs 1.50 cells, `2x4` 1.72 vs 1.72, `2x6` 1.65 vs 1.65, `inside_bend_5x3` 4.64 vs 4.64,
  `outside_bend_3x3` 2.63 vs 2.63. Worst stretch on the map is `inside_bend_3x2` at 1.04×.
- **Rotation / polarity — this is the one.** Probing the render 0.15–0.6 cells along each piece's
  own +X (the shadow flank): the shadow points **into the void on 47 pieces and onto the floor on
  36** (of 122 band pieces; 27 probes landed outside the rendered window and were dropped). That
  matches the 51/49 area split in §1. Half the ring is reversed relative to the other half.
- **Overlap / spacing.** Cannot be the cause: §1d shows each piece's shadow is only 37–40%
  continuous *within itself*.

*Could not determine:* the reference demo's per-piece orientations. Recovering them would need
template matching against the kit sheet, which I did not do. What is measured is the aggregate
direction of its void shadow, above.

---

## 3. Does the engine also cast a shadow per sprite?

**Not on this map — it casts nothing at all.** But the mechanism the brief worried about is real
and one map setting away.

**The gate.** `packages/core/src/engine/shadowPass.ts:updateShadows` only acts when
`casting = frame.sun.kind !== null && frame.sun.intensity > 0`. `sunAt`
(`packages/core/src/shared/world.ts:435`) sets

```ts
const casts = environment === 'outdoor' && map.naturalLight === true;
```

`session/testdata/goblin-warren.mapbuilder` carries
`mapSettings = {name, gridType, cellScale, ambientLight}` — no `environment`, no `naturalLight`.
`environmentOf` reads an absent environment as `'indoor'`, so `casts` is false, `kind` is null,
`shadowLook()` returns null, no shadow container is ever minted, and `drawPropShadows` returns
early on `byLayer.has(layerId)`. **Zero engine shadow pixels today.**

**What decides whether an asset child casts: nothing — there is no filter.**
`packages/core/src/engine/subscribeToAssets.ts:173` hands the shadow pass *every* asset child:

```ts
syncPropShadows(layer.id, layer.assets.map((obj) => ({ sprite: spriteMap.get(obj.id)!, obj })));
```

`drawPropShadows` mints one multiply-blended `Sprite` per entry, sharing the child's texture,
anchored at its foot, skewed flat along the light, at `look.alpha * 0.6`. With 194 asset children
on this map — including all 99 wall/bend band pieces and 56 rubble clumps — flipping it to
`environment: 'outdoor'` + `naturalLight: true` would lay a skewed copy of every wall sprite's
art (baked shadow included) on top of its own baked shadow. `propShadow()` also deliberately
drops the child's rotation ("a shadow is a smear at 0.2 alpha"), which is right for a barrel and
wrong for a wall piece that only exists rotated.

**Reported separately, as asked:** *the prop-shadow pass has no opt-out, so architectural pieces
that already carry a baked shadow would double the moment a cave map is set outdoor.* The cheap
guard is one predicate at the `syncPropShadows` call site — skip the wall/bend families, or
honour a `castsShadow === false` on the asset entry. Not urgent: it cannot fire on an indoor or
underground map.

**Also worth recording:** the dungeon layer style in this map sets
`shadowEnabled: true, shadowOffset: {x:0.5,y:0.4}, shadowIntensity: 0.6`. **Those three fields
are not read by any renderer.** A grep across `packages/` and `canvas/src` finds only
`toolPreview.ts:131` (thickens the stroke on the *preset swatch*) and `shared/mapBounds.ts:76-78`
(export padding). They are vestigial for the canvas; the real wall shadow is `drawWallShadows`,
driven by the world clock, not by layer style. So the brief's premise that those settings cast a
shadow here does not hold.

**And the existing engine pass cannot satisfy A6.** `drawWallShadows` clips its bands to
`groundOf(layer)` = the floor union plus the terrain rectangle — deliberately, so "a wall standing
in the void has no ground under its shadow". A6 wants the shadow *in the void*. The pass as
written would paint it inside the cave and nowhere else.

The flat preview draws no engine shadows, so everything measured in §1–2 is baked — confirmed
independently by §1's skirt-only render, which is built purely from the source PNGs' sub-200
alpha.

**The shipped pack carries the same baked art.** `canvas/public/packs/gg-demo` v0.1.1:
`wall_short_2x4_A-6cf0ae8d.webp` is 344×800 with 18.6% partial-alpha pixels at mean luma 102 —
the same numbers as the trimmed source. Any art-side fix is a pack rebuild.

---

## 4. The cheapest fix that works

Ranked by look gained per unit of work and risk.

### Rejected outright, each with the number that rejects it

**Change overlap, or the piece-length mix, so the baked shadows abut instead of stacking.**
Does not work. Each piece's own shadow is only **37–40% continuous along its own edge**, with
bare stretches up to 0.35 cells *inside one sprite* (§1d). Butting sprites more tightly cannot
fill gaps that exist within a sprite. It trades "blobs with gaps between pieces" for "blobs with
gaps inside pieces", and costs a generator rewrite. **Zero look gained.**

**Strip the baked shadow in the trim pipeline and let the engine cast one.**
Does not work as stated, for two reasons both visible in the code:
1. The engine casts nothing on a cave — `casts = environment === 'outdoor' && naturalLight === true`
   (`world.ts:435`). Stripping the baked shadow would leave the cave with **no shadow at all**.
2. Even with natural light on, `drawWallShadows` clips to `groundOf()` = the floor union, so the
   shadow lands *inside* the cave. A6 asks for it *outside*.

Cost, for the record: edit `D:/Labs/test-asset-sets/process.mjs` to matte out the flat
132/138/130 shadow colour (feasible — it *is* one colour, §1b — but it is welded to the stones'
own anti-aliased edges, which share that value range, so it would eat rock too), then
`make-sets.mjs`, then a full pack rebuild off v0.1.1, then re-verify 58 wall entries. **High
cost, negative look.**

**Do nothing.** An honest option. The defect is legible at 26 px/cell and ranks 2 of 12, but it
is not a correctness bug and the kit's own demo carries the same stamps. If the cave demo is not
shipping this week this is defensible. **Zero cost, zero gain; A6 and A14 stay FAIL.**

### 1 — take this one: give the ring one light

Two changes that reinforce each other, in this order.

**1a. Make the shadow polarity consistent — `scripts/gen-goblin-warren.mjs`.**
Today 47 pieces throw their shadow into the void and 36 onto the floor (§2), and the direction
histogram is flat (41% vs uniform's 38%). Every band piece is already placed with a free rotation
and a `flipX`; the shadow flank is the piece's local **+X**, which is a fact the generator can
hard-code. After choosing rotation, set `flipX` so +X points to the **outside** of the floor
polygon on every piece, always — one sign test per piece (the piece's +X dotted against the
outward normal of the floor contour at the nearest point) and one boolean.

*Cost:* a few lines in the generator, plus a regenerate of
`session/testdata/goblin-warren.mapbuilder`. No engine change, no pack change, no art change.
*What it breaks:* the bends' shadow flanks are L-shaped, so the sign test should use the
**shadow centroid relative to the core centroid** rather than assuming +X, and the whole ring
needs an eyeball pass afterwards. More importantly, forcing `flipX` also swaps which face of the
art faces the room, so the pale pebble fringe moves with the shadow. That is the correct
direction — B8 in the bar names the reversed piece as its own failure — but it visibly changes
the ring, so it needs the canvas approval walk before publishing.
*Gain on its own:* A14 goes from "quilted all over" to "quilted on one side", and the 34.7 cell²
of shadow currently dumped onto the cave floor disappears. It does **not** close A6 — the band is
still 4,659 blobs.

**1b. Draw one silhouette-wide shadow — what the reference actually does (§2).**
The geometry is already in the map file: `layer.standaloneWalls[0]` is a **closed 219-point
polyline tracing the cave outline**, and the floor contour is a single 218-point ring with a
435-cell perimeter. So this needs no raster union of sprite alphas — it is an offset of a polygon
that already exists.

Cheapest shape, in `packages/core/src/engine/shadowPass.ts`:
- add a geometry source alongside `drawWallShadows` that takes the floor union's outer ring,
  offsets it outward by the band thickness plus 0.3 cells, and subtracts the ring offset by the
  band thickness — one Clipper2 offset pair, the same engine already used for the floor union;
- fill it through the existing `SHADOW_STEPS` / `bandAlpha` feather so it matches the house
  shadow look, tinted `#4d5460`;
- **do not** clip it to `groundOf()` — this one is meant to land in the void, and that is the one
  line of `drawWallShadows` that must not be copied;
- gate it on something a cave can satisfy. `casts` is `outdoor && naturalLight`, so either widen
  that for this pass, or hang it off the layer style's already-present but currently dead
  `shadowEnabled` / `shadowOffset` / `shadowIntensity` (§3) — the tidier answer, since it revives
  three fields the UI already exposes in `ToolPopover` and this map already sets.

*Cost:* real engine work, roughly a day with tests, plus a decision on the gate.
*What it breaks:* an offset of the *floor* ring is smooth while the rock silhouette on top of it
is lumpy, so the shadow would sit behind lobes rather than trace them. Mitigation: offset from
the wall polyline instead of the floor ring, and accept ~0.1 cell of mismatch, which is under
A5's 0.3-cell straight-edge limit. If that still reads wrong, the fallback is the raster route —
render the band sprites' alpha to a texture, blur, offset, multiply: more code, a per-resize
cost, exact silhouette.
*Gain:* closes A6 and A14 together, for every cave map, permanently, and gives the whole map one
light direction. It is the only option here that actually produces "one continuous soft band of
roughly constant width following the silhouette".

**Sequencing:** 1a is cheap, is a prerequisite for 1b reading right (a directional pass under a
directionless quilt still reads as a quilt), and can ship alone. Do 1a, re-grade A14, then decide
whether A6 is worth 1b.

### 2 — narrow the bar instead

If 1b is not affordable, the honest alternative is to amend A6. The kit cannot produce a
continuous band from baked art (§1d, §2), so A6 as written fails the *reference* too. A bar this
art can meet: *"the shadow reads as one direction — at least 60% of its weight in three adjacent
compass octants — and no shadow blob may sit more than 0.4 cells clear of the rock."* That is
exactly what 1a delivers, and `e2-direction.mjs` already measures it as written.

*Cost:* a doc edit and a re-grade. *Gain:* the worklist stops carrying an item that cannot be
closed without engine work.

### 3 — stop the engine casting per-sprite shadows on band pieces

Not a fix for this defect (the engine draws nothing here today, §3), but a one-line guard worth
taking the next time `subscribeToAssets.ts:173` is touched, so a future outdoor cave cannot
double the baked shadow. *Cost:* minutes. *Gain:* prevents a regression; changes nothing now.

---

## Evidence index — `D:/Labs/cave-shadow-evidence/`

**Images**

| file | what it shows |
| --- | --- |
| `montage-src-white.png` | four source pieces over white, then the same four with the opaque core in magenta — the baked skirt is a stack of hard rectangles |
| `baked-shadow-closeup.png` | 10×8 cells of the map's *isolated* baked shadow layer at 70 px/cell — a chain of separate grey rectangles |
| `baked-shadow-layer.png` | the same layer, whole map |
| `cmp-edge.png` | kit reference (top, two crops) vs ours (bottom, two crops), each 5×4 cells at 140 px/cell |
| `cmp-blobs.png` | our two worst stretches (cells 28–35 × 7–13 and 17–24 × 17–23) at 140 px/cell |
| `L-full.png` / `L-skirt.png` / `L-floor.png` | the three-way render the §1 numbers come from |
| `ours-140.png`, `ours-full-70.png`, `ref-70.png` | measurement inputs |

**Scripts** (run from `D:/Labs/map-goblin`; they write beside themselves)

| file | produces |
| --- | --- |
| `a2-skirt.mjs` | skirt reach + alpha/luma by distance from the opaque core |
| `a3-side.mjs` | skirt colour histogram and per-side widths |
| `e1-coverage.mjs` | how continuous one piece's own shadow is along its own edge |
| `d1-layers.mjs` / `d2-measure.mjs` | isolate the baked shadow layer on the real map; void/floor split, blob statistics |
| `b8.mjs` | void shadow by distance from the rock, one rule applied to both maps |
| `c2-blobs.mjs` | connected-component sizes of the void shadow |
| `c1-orient.mjs` | per-piece shadow direction and placed-size-vs-art stretch |
| `e2-direction.mjs` | the direction histogram in §2 |

**Source read for §3:** `packages/core/src/engine/shadowPass.ts`,
`packages/core/src/engine/subscribeToAssets.ts:148-176`,
`packages/core/src/shared/shadows.ts`, `packages/core/src/shared/world.ts:429-443`,
`packages/core/src/engine/toolPreview.ts:131`, `packages/core/src/shared/mapBounds.ts:76-78`.
