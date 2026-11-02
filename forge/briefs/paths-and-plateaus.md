# Art brief: paths and plateaus

What the forge makes for roads, rivers, lakes, bridges, cliffs, slopes and the ways up them,
and exactly how the map engine uses each piece. Everything follows the style bible
(`forge/STYLE.md`): hand-painted, top-down, soft ambient occlusion only, 200 px per cell.

Every piece in this brief ships today as a placeholder (flat noise, tagged `placeholder`).
Final art replaces a placeholder by being integrated under the same set name and entry key,
so saved maps keep working with no changes.

## 1. The spec (from the plan, section 9)

Path material set `<pack>:<material>` (every entry 200 px per cell, webp, variant families
A/B/C where listed):

| Piece | Grid | Required | Notes |
|---|---|---|---|
| `strip` | 4x1 | yes | loops left→right, full height opaque, no padding; A/B/C variants cycle by `offset` |
| `edge` | 2x1 | optional | inner half opaque and matching the strip, fades to transparent outward (format of `bank-grassy-01-a1`) |
| `end` | 1x1 | optional | cap drawn at `cut` ends, pointing +U |
| `fill` | 4x4 | for pools | seamless tile for the interior of a closed `fill` path (lake, lava pool) |
| `fall` | 2x2 | for liquids | waterfall/lavafall sprite family, drawn where the liquid meets a drop |

First sets: `road-dirt`, `road-cobble`, `trail-grass` (worn grass), `planks` (bridge), `water`
(strip + `bank` edge + `fill` + `fall`). Later sets follow the same table: `lava`, `poison`,
`ice`, `mud`. A material without `fill` cannot be a pool; without `fall` it ends at a cliff
with a cut.

Floor material edge strips: any floor texture may ship `<material>_edge_2x1` in the same fade
format; the border renderer uses it when present.

Cliff set (band kit, measured like cave ink) `<pack>:<kit>`: `ledge_1x2/1x4/1x6`,
`ledge_bend_*` (inside/outside), optional `ledge_end`, plus `slope_2x1` (the slope strip,
§4.3) and `contour` colour. First kit = cave ink ledge pieces already shipped with a
placeholder slope strip; a hand-painted `GG_Cliff_Rock` kit follows.

Openings: `stairs_2x2/2x4/3x2` (gg-demo `stairs_stone_*`, `stairs_wood_*` today), `ramp_2x2`
and `ramp_2x4`, `ladder_1x2` (forge later; placeholder ramps are a shaded wedge, ladders two
rails).

Placeholders (`scripts/gen-path-placeholders.mjs`, like the water one): flat noise strips per
material in muted colours with a 1-cell loop, bank/verge fades, a white-blue waterfall
gradient. Entries carry `placeholder: true` in the pack README so the ship gate is checkable.

## 2. Path materials: keys and how each piece is used

A path material is a pack set named after the material, holding entries of type `path`. Each
entry's key is `<material>-<piece>`, and each is a loose file (never packed into an atlas,
because the engine repeats it). The pack id plus the set name is the material id a map
stores: `gg-forge:road-dirt`.

| Material id | Entry keys |
|---|---|
| `gg-forge:road-dirt` | `road-dirt-strip`, `road-dirt-edge`, `road-dirt-end` |
| `gg-forge:road-cobble` | `road-cobble-strip`, `road-cobble-edge`, `road-cobble-end` |
| `gg-forge:trail-grass` | `trail-grass-strip`, `trail-grass-edge`, `trail-grass-end` |
| `gg-forge:planks` | `planks-strip`, `planks-edge`, `planks-end` |
| `gg-forge:water` | `water-strip`, `water-edge` (the bank), `water-end`, `water-fill`, `water-fall` |
| later: `lava`, `poison`, `ice`, `mud` | the same five keys; `fill` and `fall` only for the liquids (`lava`, `poison`; `ice` gets `fill`, no `fall`) |

### `strip` — 4x1, 800 × 200 px, required

- **How it is drawn.** The strip is laid along the path's centre line. Its horizontal axis
  runs along the path and is measured in cells of distance travelled, so the art repeats every
  4 cells and is never stretched along the path, however the path bends. Its vertical axis
  runs across the path: the top row runs along one edge and the bottom row along the other
  (which is which depends on the direction the path was drawn). A path wider or narrower than
  one cell squeezes or stretches the art across, never along.
- **Must loop** left to right with no seam: the right edge continues into the left edge.
  Every path starts the loop at a random point, so the seam must never show.
- **Must be fully opaque** edge to edge, top to bottom. Do not paint a soft edge: the engine
  feathers the path's edge itself (0.15 cells, or a shared feather where paths of the same
  material cross), and an edge painted into the art would fade twice.
- **No directional features** that read wrong when a path is drawn the other way round; the
  DM can mirror a path across its centre line (top row and bottom row swap).
- **Liquids** (any material with a `fill`: `water`, `lava`, `poison`, `ice`): paint the
  surface in a mid tone. The engine darkens the middle of the band (to about 70%) and leaves
  the banks bright, so a river reads shallow at its sides and deep in its channel.

### `edge` — 2x1, 400 × 200 px, optional (the verge, or the bank for water)

- **How it is drawn.** One strip runs along each side of the path, outward. Its horizontal
  axis runs along the path and repeats every 2 cells; its vertical axis runs outward: the
  **top row lies against the path**, the bottom row is furthest out. The same art is used on
  both sides, mirrored, so the top row always touches the path. It is drawn 0.5 cells wide,
  so the 1-cell art is squeezed to half its height.
- **Must loop** left to right with no seam.
- **Must fade outward.** The top half is opaque and matches the strip's colour at its edge;
  the bottom half fades to fully transparent, raggedly, into whatever ground is beside the
  path. The bottom row must be fully transparent.
- **The top row must be solid.** Where a path has a soft edge, the engine tucks half a cell of
  the verge in under the path and fills that tucked part with the top row of the art, so what
  shows through the path's feather is always verge, never ground. A top row that is not solid
  shows a line along the path.
- Verges sit under paths: where two roads of the same material cross, neither road's verge
  shows across the other road.

### `end` — 1x1, 200 × 200 px, optional

- A cap for a path end the DM has set to *Cut*, its rounded side pointing along the path's
  direction of travel (toward the right of the image). Today the engine rounds a cut end with
  the strip itself; this piece is reserved for a cap with its own character (a road's worn
  end, a bridge's last plank).
- Left edge opaque, matching the strip; it ends inside the cell with transparency around it.

### `fill` — 4x4, 800 × 800 px, for pools

- **How it is drawn.** The interior of a closed path with *Fill* on (a lake, a lava pool) is
  tiled with this art at 200 px per cell, anchored to the map's origin, so neighbouring pools
  line up. It is drawn darker (75%) as the deep middle, under the strip, which forms the
  shoreline band around it.
- **Must tile seamlessly in both directions.** It may be any shape of shoreline; the engine
  cuts it to the outline, concave shores included.
- Fully opaque, no edges, no features that repeat visibly every 4 cells.

### `fall` — 2x2, 400 × 400 px, for liquids

- **How it is drawn.** Where a liquid path crosses a cliff, or where a pool's shore runs along
  a cliff edge, the engine hangs fall sprites over the edge. The **top edge of the image is
  the lip** (where the liquid leaves the high ground), the bottom edge the foot. A river gets
  one sprite as wide as the river at that point; a shore is laid with sprites about 2 cells
  wide side by side. Each sprite is stretched down to the height of the drop (at least one
  cell), so paint it to hold up under vertical stretch.
- Top edge fully opaque and continuous with the strip's surface; the bottom fades into foam
  and spray, transparent at the very bottom. Left and right edges fade a little so
  neighbouring sprites along a shore blend.

## 3. Floor edge strips

A floor texture may ship an edge strip beside it, keyed `<material>_edge_2x1` in the same pack
as the floor (for the floor entry `cave_floor_8x8_floor_A`, material `cave_floor`, the strip
is `cave_floor_edge_2x1`), of type `edge`, as a loose file.

- **How it is drawn.** Where two floors of different textures meet, the floor drawn on top
  lays its edge strip along the part of its outline that lies over the floor beneath, out
  over that floor. The top row lies against the floor's outline, the bottom row furthest out.
  It is drawn as wide as the layer's transition width (0.5 cells by default) and fades out
  over half a cell at each end of a run.
- Same format as a path's `edge`: loops left to right every 2 cells, top half opaque and
  matching the floor, bottom half fading raggedly to fully transparent.
- Where a floor has no edge strip, the engine falls back to a soft colour blend.

One per shipped floor texture:

| Floor | Edge strip key |
|---|---|
| `gg-forge:cave_floor_8x8_floor_A` | `gg-forge:cave_floor_edge_2x1` (placeholder exists) |
| `gg-demo:floor_small_8x8_floor_A` | `gg-demo:floor_small_edge_2x1` |
| `gg-demo:floor_large_24x24_floor_A` | `gg-demo:floor_large_edge_2x1` |

## 4. The cliff kit

A cliff is a band of rock laid along a raised floor's outline where its edge is set to *Cliff*,
by the same walk that lays the cave walls: it chains pieces end to end along the outline,
choosing straights and bends to follow the turns. The high ground is the floor side; the drop
is the void side.

Pieces (`<pack>:<kit>`): straights `ledge_1x2`, `ledge_1x4`, `ledge_1x6`; inside and outside
90° bends `ledge_bend_*`; optional `ledge_end`. The first kit is the cave ink ledge already
shipped; a hand-painted `GG_Cliff_Rock` kit follows.

**What the walk needs that the kit does not have yet:** thick 90° ledge bends, inside and
outside, that turn the corner in **1 cell and in 2 cells**, as thick as the straight ledge
pieces. Without them the walk cannot follow a raised floor's corners and falls back to the
rock band.

### How each piece is measured

Every piece is measured from the drawn art into `packages/core/src/assets/caveWallKit.json`
(the measuring script is `forge/cave-measure.mjs`). One record per piece:

| Field | Meaning |
|---|---|
| `key` | `<family>_<w>x<h>`, e.g. `ledge_1x4`, `inside_bend_2x2` |
| `file`, `wPx`, `hPx`, `wCells`, `hCells` | the image and its size |
| `joints` (px), `jointsCells` (cells, from the image centre) | the two points where the band enters and leaves the piece; the walk puts the next piece's entry joint on this piece's exit joint |
| `chordCells` | the straight distance between the two joints, cells |
| `turnDeg` | how far the band turns across the piece: `0` straight, `90` inside bend, `-90` outside bend |
| `voidCentroidCells`, `floorCentroidCells`, `voidSide` | which side is the drop and which the high ground (`left` of the direction of travel is the void) |

For the art this means: **the joints must sit where the band's edge meets the image edge**,
the same distance from the void side on every piece of the kit, so pieces meet without a step;
a straight's two joints face each other across its length; a bend's two joints are at 90° to
each other. The band's thickness (rock on the high side, the face dropping to the void) must be
the same on every piece.

Measured today:

| Piece | Grid | Chord (cells) | Turn |
|---|---|---|---|
| `ledge_1x2` | 1x2 | 1.97 | 0 |
| `ledge_1x4` | 1x4 | 3.97 | 0 |
| `ledge_1x6` | 1x6 | 5.97 | 0 |
| `inside_bend_2x2` (rock band) | 2x2 | 2.105 | 90 |
| `outside_bend_2x2` (rock band) | 2x2 | 1.361 | -90 |

### `slope_2x1` — the slope strip

- **How it is drawn.** Where a raised floor's edge is set to *Slope*, a band runs outside the
  outline, as wide as the slope (one cell per cell of drop by default), drawn like a path's
  strip along the outline: the horizontal axis runs along the edge and repeats every 2 cells;
  the **top row lies against the high ground**, the bottom row is the foot of the slope.
- Loops left to right. Top row opaque scree or grass running downhill; the bottom fades into
  the ground at the foot. The engine shades it (darker downhill, lit from the sun's side) and
  draws contour lines over it, so paint it without baked shading or lines.
- `contour`: one ink colour per kit for the contour lines (dashed, thin, 35% opacity).

## 5. Openings: stairs, ramps, ladders

An opening is to a cliff what a door is to a wall: it cuts a gap in the cliff band and draws
its art across the gap, oriented down the slope, **the top of the image at the high side, the
bottom at the low side**. The art's width runs along the cliff edge.

| Piece | Grid | Use |
|---|---|---|
| `stairs_2x2`, `stairs_2x4`, `stairs_3x2` | as named | steps through a cliff; today the gg-demo `stairs_stone_*` and `stairs_wood_*` stand in |
| `ramp_2x2`, `ramp_2x4` | as named | a smooth incline; the placeholder is a shaded wedge |
| `ladder_1x2` | 1x2 | rungs up a cliff face; the placeholder is two rails |

- The top and bottom edges meet the high and low ground: let them fade or end cleanly so the
  piece sits on either floor. The left and right edges meet the cliff band where it was cut:
  end them with a clean side (a stair's stringer, a ramp's lip), since the band stops there.
- No baked cast shadow: the engine shades cliffs and casts their shadows from the sun and moon.

## 6. Order of work

1. `road-dirt`, `road-cobble`, `trail-grass`, `planks`: `strip` and `edge` first, `end` last.
2. `water`: `strip`, `edge` (bank), `fill`, `fall`.
3. The cliff kit's missing bends (1 and 2 cells, inside and outside), then `slope_2x1`.
4. Floor edge strips for the three shipped floors.
5. Openings.
6. `lava`, `poison`, `ice`, `mud`.

Prod waits for approved sets of at least `road-dirt`, `water`, `planks` and a cliff kit.
