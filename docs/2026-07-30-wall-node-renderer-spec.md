# Node-based wall/path renderer — spec (GitHub #19)

Supersedes the S4 §1.8 deferral of #19. Decided 2026-07-30 in the canvas-finish
discussion after a live repro on `dungeon-classic` / `stone-slate`.

## §1 Why — measured, not asserted

Repro: square, hexagon and octagon rooms plus a 3-segment standalone wall chain
and a lone diagonal, all on `stone-slate`. Read from the live scene graph:

`sublayer-walls` held **34 objects — 22 strips + 12 overlays**.

- 22 `TilingSprite` strips = 4 (square) + 6 (hex) + 8 (oct) + 4 (standalone),
  one per edge.
- 12 overlay `Sprite`s = **4 corner pieces (square only)** + 8 end-caps.
- **Hexagon: 0 corner pieces. Octagon: 0 corner pieces.**

### 1.1 Root cause — the near-square gate

`packages/core/src/engine/wallTextureRenderer.ts:310-312`

```ts
const NEAR_SQUARE_MIN = 60 * (Math.PI / 180);
const NEAR_SQUARE_MAX = 100 * (Math.PI / 180);
if (angle > NEAR_SQUARE_MIN && angle < NEAR_SQUARE_MAX) { /* place corner */ }
```

Hexagon interior angle is 120°, octagon 135° — both outside. Oblique vertices
fall through to the strip end-extension (`ext = wallWidth / 2`, `:151`), which
just overlaps two rotated strips. That is the diagonal butt-join and the outer
notch visible at every hex/octagon vertex.

`selectCornerTexture` already carries angle buckets (≤100° → 1x1, ≤140° → 2x2,
>140° → 3x3). All of it is unreachable dead code behind that gate. The comment
at `:306-309` states the real reason: the rounded pieces need edge-aligned
placement the renderer does not do.

### 1.2 The deeper reason the gate exists

The `Corner_*` pieces are **fixed 90° elbows**. No amount of rotation makes a 90°
elbow span a 120° or 135° vertex — the geometry cannot fit. Angle-bucketing
authored elbows was never going to solve hex/octagon. This is why the renderer
must compose turns from small pieces instead.

### 1.3 Standalone walls

- `renderCornerOverlays` takes `polygons` only. Wall chains get no junction
  treatment at all.
- `renderEndingOverlays` caps *every* endpoint of *every* `WallSegment`.
  `WallTool.ts` commits **one 2-point segment per drag** — no chaining — so a
  3-click chain is 3 segments = 6 end-caps, 4 of them stacked in pairs at the
  two interior joints. That is the clumping at every bend.
- `canvas/src/canvas/wallEndpointSnap.ts` is a stub returning its input
  unchanged; consecutive segments do not snap to each other.

`PathTool` and `PolygonTool`, in the same directory, already do click-to-add-point
plus Enter-to-commit. `WallTool` is the outlier.

## §2 Decisions

1. **Full #19 this sprint** — auto-placement *and* node editing, not a split.
2. **Turns compose from small pieces.** Walk the spine; place pieces rotated to
   the local tangent. Large pieces eat straight runs, small pieces carry
   curvature. Every placed piece is an editable node.
   **Revised 2026-07-30 after the first build:** a turn is carried by exactly
   **three** stones — one cover stone sitting on the vertex, plus one stone
   angled along each arm — all at natural size. The first implementation fitted
   a variable number of pieces to a fillet arc and scaled them to fit; that
   works at 120°/135° but collapses at acute and irregular angles, where the
   arc shortens, the scale drops well below 1 and the stones visibly squash.
   The cover-stone construction compresses nothing and is angle-independent.
3. **Elbows first, fan as fallback.** Try to fit an authored piece at a vertex;
   fall back to a small-piece fan only when no authored piece fits the angle.
   Maximum reuse of the drawn art.
4. **The fan draws from the active wall set's small pieces** — `Connector_A–D`
   (single rocks), plus `Straight_C` (1x1) and `Straight_D` (half-length).
   All live in the wall atlas at the same band thickness, so the run stays
   continuous. No object-atlas rock props in auto-placement.
5. **No global overlap slider.** Overlap is an outcome of layout, not a knob.
   The investment goes into direct manipulation instead: the DM edits, resizes
   and adjusts **each node and each span between two nodes** by hand, the way
   Dungeondraft and Foundry do it. Auto-layout produces a good starting state;
   hand adjustment is the finishing tool.
6. **Ruler and text/label tools ship alongside** — see §6.

## §3 The asset vocabulary already exists

`atlas-wall-ffcc1679.json` ships **39 frames** in exactly the taxonomy #19 asks
for, across two sets (`Fence_Stone_Slate_A`, `Wall_Wood_Ashen_B`):

Straight 3x1 / 2x1 / 1x1 ×2 · Corner A–H (1x1, 2x2, 3x3) · Joint A–D ·
Connector A–D + `Connector_DIAG` · Ending A

**#19's stated dependency on the map-assets repo is stale.** The whole system
can be built and validated against `dungeon-classic` today.

### 3.0 What the pieces actually are

Read off the rendered atlas, not off the names. `PIECE_TYPE_PATTERNS` in
`textureManifest.ts:41` mislabels two of these and must be corrected.

| Piece | What it actually is | Role in layout |
|---|---|---|
| `Straight_A/B/C` 3x1, 2x1, 1x1 | horizontal stone runs | straight fill, largest-first |
| `Straight_D` 1x1 | half-length run (contentRect.w = 100) | fill remainder, tight turns |
| `Connector_A/B/C/D` 1x1 | **single rocks** | **fan material at oblique vertices** |
| `Connector_DIAG_A` 1x1 | short diagonal stone run | diagonal fill |
| `Corner_A/B/C` 1x1 | sharp **90°** elbows | ~90° vertices |
| `Corner_D/E` 2x2, `Corner_F` 3x3 | rounded **90°** arcs, increasing radius | soft ~90° vertices |
| `Joint_A` 1x1 | **4-way cross** | wall intersections |
| `Joint_B` 1x1 | **T-junction** | wall tees |
| `Ending_A` 1x1 | stub cap | free ends |

Every `Corner_*` is a 90° turn. None can span a 120° hex or 135° octagon vertex
at any rotation — which is the geometric fact behind §1.2.

### 3.2 Junction resolution

- ~90° vertex → `Corner_A/B/C` sharp, or `D/E/F` rounded
- wall tee → `Joint_B` · wall crossing → `Joint_A`
- **any other angle (hex 120°, octagon 135°, curves) → fan of `Connector_A–D`
  rocks and `Straight_C/D`, each rotated to the local tangent**
- free end → `Ending_A`

### 3.3 Measured pivots — why the rounded corners stay out of auto-placement

Alpha bounds measured off `atlas-wall-ffcc1679` at alpha > 12, not eyeballed:

| Piece | tile | content x,y | content w×h |
|---|---|---|---|
| `Connector_A` | 200² | 73, 84 | 61×34 |
| `Connector_B` | 200² | 80, 79 | 40×42 |
| `Connector_C` | 200² | 79, 83 | 39×38 |
| `Connector_D` | 200² | 76, 86 | 57×36 |
| `Connector_DIAG_A` | 200² | 25, 71 | 141×101 |
| `Corner_A/B/C` | 200² | ~76, 72 | ~124×128 |
| `Corner_D_2x2` | 400² | **176, 179** | 224×221 |
| `Corner_E_2x2` | 400² | **75, 76** | 325×324 |
| `Corner_F_3x3` | 600² | **177, 176** | 423×424 |
| `Joint_A` | 200² | 0, 0 | 200×200 |
| `Joint_B` | 200² | 0, 73 | 200×127 |
| `Ending_A` | 200² | **100**, 76 | 47×51 |

Three things fall out of this:

1. **Rocks are 34-42px tall; the straight band is 57-61px.** Each piece must
   therefore scale by its *own* content height to fill the band, not by a shared
   strip height. `pieceWorldLength` already does this.
2. **`Ending_A` content begins exactly at x = 100**, the tile centre. The tile
   centre *is* the attachment point — anchor 0.5 with outward rotation is right,
   and trimming it to contentRect would move the pivot, so it keeps its rect.
3. **The rounded corners have inconsistent authoring origins.** `Corner_D` sits
   in the bottom-right quadrant of its tile, `Corner_E` nearly fills its tile.
   Placing either by tile centre is simply wrong. This is a *second*, independent
   reason they were gated off, on top of §1.2. They need per-piece pivot metadata
   before they can auto-place, so **`Corner_D/E/F` are excluded from
   auto-placement** and offered only as manual swaps in node edit mode, where the
   DM positions them. `Corner_A/B/C` are near-centred and auto-place fine at 90°.

### 3.1 contentRect is the source of truth for spine length

`gridSize` is unreliable — `wall-stone-a-straight-d-1x1` is `gridSize: '1x1'`
(200px natural) but `contentRect.w` is **100**. It is a half-length stone.

Layout must use `contentRect.w` for spine length and `contentRect.h` for arm
thickness, falling back to natural dimensions.

**Gap:** only `straight` and `path` entries carry a `contentRect`. Corner, joint,
connector and ending entries do not, so they cannot be aligned to the straights.
Resolving this is a prerequisite task (§5.0).

## §4 Data model

Auto-layout is deterministic and position-seeded, so nodes are **derived, not
stored**. Only deviations persist — untouched walls add zero bytes to the save.

```ts
// shared/types.ts
interface WallNodeEdit {
  t: number;          // 0..1 along the spine — stable anchor across geometry edits
  pieceId?: string;   // swap
  rotate?: number;    // delta radians
  scale?: number;     // length multiplier along the spine
  removed?: boolean;
}
interface WallSpanEdit {
  t: number;          // anchor of the span's leading node
  gap: number;        // signed spine-units; negative overlaps, positive separates
}
interface WallSegment {
  // ...existing
  nodeEdits?: WallNodeEdit[];
  spanEdits?: WallSpanEdit[];
  inserts?: { t: number; pieceId: string; rotate?: number; scale?: number }[];
}
```

Edits key on parametric `t`, not array index, so moving a wall vertex re-attaches
edits to the nearest node instead of corrupting them. Index keys would break on
every geometry change.

## §5 Work breakdown

- **5.0 contentRects for junction pieces** (prerequisite). Compute alpha bounding
  boxes for corner/joint/connector/ending frames and add them to the manifest.
  No image dependency is installed at root; compute in-browser from the loaded
  atlas via a canvas readback and emit manifest-ready values once.
- **5.1 `engine/wallLayout.ts`** — pure, no Pixi. `layoutWall(points, closed,
  pieces, opts) -> WallNode[]`. Junction pass (authored elbow if one fits the
  angle, else the three-stone cover construction), ending pass, then greedy
  straight fill largest-first with deterministic position-seeded variant choice.
  Ships with its own test — this is where hex, octagon and acute-angle
  correctness is actually proven. **Done, 29 tests.**
- **5.1a `applyWallEdits`** — pure overlay of the DM's manual adjustments on an
  auto-generated run. Kept separate from `layoutWall` so auto-layout is the same
  function whether or not a wall has been hand-edited, and a wall resets by
  dropping its edits. **Done.**
- **5.2 `engine/wallNodeRenderer.ts`** — one Sprite per node, anchored on the
  content rect, rotated to node angle, scaled to `wallWidth / contentH`.
  Replaces the TilingSprite path in `renderTexturedWalls`.
- **5.3 `WallTool` chaining** — adopt `PathTool`'s pattern so one chain is one
  `WallSegment` with N points. This alone removes the stacked end-caps, because
  endings only cap `points[0]` and `points[last]`.
- **5.4 `wallEndpointSnap`** — implement the stub.
- **5.5 Node edit mode** — toggle, node handles, per-node rotate/resize/swap/
  insert/delete, per-span adjust. Undo rides the existing `UpdateWallCommand`,
  since every edit is a wall property patch.
- **5.6 Pack-driven wall sets** — `WallCategory` is a hardcoded union of
  `'stone-slate' | 'wood-ashen'` in `textureManifest.ts`. A forge pack cannot add
  a wall set without editing core. Collides with the D5 forge lane.

## §6 Missing tools, also in scope

- **Ruler / measure.** `'ruler'` was declared in the `ToolType` union and in
  `DrawingTool.ts` but had no implementation, was not registered, and was not in
  the toolbar — declared and never built. **Now built:** `RulerTool`, toolbar
  entry, `M` shortcut (`R` is the rectangle), and a live reading in the status
  bar showing both map units and squares, using `mapSettings.cellScale`.
  The reading is published through a module ref polled by the status bar's
  frame loop — the same pattern as `fpsMetrics` and `cursorPosition` — because a
  measurement is throwaway and belongs in neither the store nor the undo stack.
  **ponytail:** the reading sits in the status bar rather than floating at the
  cursor. No Pixi `Text` exists anywhere in this codebase, so a canvas-drawn
  label means new font machinery and a decision about the no-webfont rule. If
  measuring at a distance from the status bar proves annoying, the upgrade is an
  HTML label positioned via `worldToScreen`, not Pixi text.
- **Text / labels.** Absent entirely. Rooms already carry `name` in the data
  model with no way to show it on the map. Needs a child type, renderer, tool,
  properties panel and save/load coverage.

## §7 Acceptance

Per #19's own list, plus what the repro exposed:

- [ ] Hexagon room — all 6 sides clean at 120°
- [ ] Octagon room — all 8 sides clean at 135°
- [ ] Curved wall — nodes follow the curve without gaps
- [ ] Mixed sizes — auto-fit distributes varied widths along a run
- [ ] Node edit — toggle, swap one piece, verify persistence
- [ ] Span edit — adjust the gap between two nodes, verify persistence
- [ ] Wall chain — one drag-chain is one segment, no doubled end-caps at bends
- [ ] Endpoint snap — consecutive walls join
- [ ] Ruler measures; text labels place, render, save and reload
- [ ] Zoom-to-fit accounts for `standaloneWalls` (it currently ignores them)
- [x] A layer holding only standalone walls renders them — `rebuildDungeonLayer`
      bailed out on an empty `mergedFloor` 160 lines before it reached the wall
      and door render, so drawing a wall on a floorless layer showed nothing.
      Pre-existing, unrelated to #19, found while testing acute angles.

## §8 Known risks

- Node counts scale with wall length. A dressed map could hold thousands of
  sprites where it held tens of tiling strips. Interacts directly with the #17
  layer cache and the Sprint 3 fps miss — measure before the gate, not after.
- Fog, occlusion and the Table's player renderer all consume wall geometry.
  Node composition must not change the *collision* spine, only its dressing.
