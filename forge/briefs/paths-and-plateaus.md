# Art brief: paths and plateaus

What the forge makes for roads, rivers, lakes, bridges, cliffs, slopes and the ways up them,
and exactly how the map engine uses each piece. Everything follows the style bible
(`forge/STYLE.md`): hand-painted, top-down, soft ambient occlusion only, 200 px per cell.

**Units and fill tiles only.** The map is defined with paths and plots, and its look comes
from pieces the engine places along them as they are: never a strip tiled along a path, never
a gradient or an alpha fade painted as an edge, never a sprite stretched to fit. The only art
that tiles is a seamless fill (a road's surface, a lake's water, a floor).

Rules for every unit:

- **One subject per piece**, flat-lay top-down, on a keyed ground: a rock chunk, a slab, a
  plank, a pebble cluster, a grass tuft, a bank stone. No visible side faces, no 3/4 view, no
  cast shadow (the engine shades and casts from the sun).
- **Shipped pieces as references** on every run (GG_Fieldstone wall, cave ink, cave floor,
  door kits), so new units sit with the rest of the map.
- **Trimmed content.** The pack records each piece's content rect; the engine lays and spaces
  units by it, so leave no stray marks in the padding.
- Pieces are laid at random turns and mirrored: nothing that reads wrong upside down or
  facing the other way.

## 1. Kits

A path material is a **kit**: one `kit` entry per material set in the pack, carrying a
manifest that names the pieces (packages/vault-engine/src/types.ts `KitManifest`). The pack id
plus the set name is the material id a map stores (`gg-forge:road-dirt`), so saved maps keep
working when the art is replaced under the same keys.

| Field | What it is | How the engine uses it |
|---|---|---|
| `fill` | 4x4 seamless tile | the path's outline (both roads at a junction unioned into one) filled like a floor |
| `edge[]` | 1x1 units, each with weight, spacing, jitter, optional scale | walked along the outline: picked by weight, turned to the edge plus up to the jitter, spaced, never overlapping another unit by more than 20 % |
| `scale` | number, 0.5 when absent | what edge units are laid at against their painted size: a 1-cell unit lies half a cell across |
| `cross[]` | 2x1 planks, by weight | laid across a bridge's centreline at the bridge's width, each lapping the last |
| `railPost`, `rope` | 1x1 post, rope colour and width | posts every 2 cells on both edges of a bridge, rope drawn between them |
| `end` | 1x1 | laid side by side across a cut end |
| `band` | `straight[]` (2x1, 4x1), `bendDrawn: true`, optional scale | the cave walk along the outline (a water bank); the walk's bends are drawn in code from the straight's colours, so no bend pieces are needed |
| `fall` | 2x2 square piece | tiled down a cliff where water leaves it, one size, never stretched |
| `objects[]` | any prop, with weight, spacing, jitter, `side` (1 out, -1 in, 0 on the edge) | real props placed along the path as attached objects: trees on a road's verge, reeds on a shore, lily pads on the water |

Edge units and objects are spaced to cover about a third of their band, so the ground shows
between them: paint a unit as a single cluster, not a carpet.

### Sets today

| Kit | Pieces |
|---|---|
| `road-dirt` | fill `road-dirt-fill`; edge grass tufts, pebbles, puddles (`GG_Paths_Props`); objects gg-demo small trees |
| `road-cobble` | fill `road-cobble-fill`; edge loose cobbles, flagstones |
| `trail-grass` | fill `trail-grass-fill`; edge grass tufts, pebbles |
| `planks` | cross planks and broken planks (2x1); rail post; rope; end short plank |
| `water` | fill `water-fill`; band bank stones (2x1, 4x1); edge ripples; objects reeds (on the shore), lily pads (on the water); fall `water-fall` |

## 2. What to paint next

1. **Fill tiles** for `road-dirt`, `road-cobble`, `trail-grass` and `water`: 4x4, 800 × 800 px,
   seamless both ways, fully opaque, no feature that repeats visibly every 4 cells. Today
   the roads fill with their old strip art; each needs a proper surface (worn dirt with
   ruts that do not read as rails, set cobbles, worn grass, a water surface with depth).
2. **Edge units**, 1x1, 3 to 5 variants per kit: lighter and less saturated than round 4's
   pebbles, puddles and ripples, which read too dark at half a cell.
3. **Bank straights** for water, 2x1 and 4x1: a narrow band (under one cell) of stones and
   gravel whose two short ends cut cleanly so straights chain end to end.
4. **Objects**: bushes and small trees in the forge's own style for the road verge (gg-demo's
   stand in), reeds and lily pads (round 4 stand in).
5. Later kits follow the same table: `lava`, `poison`, `ice`, `mud`. A material without
   `fill` cannot be a pool; without `fall` it ends at a cliff with a cut.

## 3. Floors

A floor painted with a kit's fill tile borders a different floor beneath it with that kit's
edge units, walked along the shared edge. A floor texture no kit claims falls back to a soft
colour blend. To give a shipped floor a border, ship a kit whose `fill` is that floor and
whose `edge[]` are its border units; no edge strips.

## 4. The cliff kit

A cliff is a band of rock laid along a raised floor's outline where its edge is set to *Cliff*,
by the same walk that lays the cave walls: it chains pieces end to end along the outline. The
high ground is the floor side; the drop is the void side. Every straight is walked at its own
size; nothing is stretched to fit an edge.

Pieces (`<pack>:<kit>`): straights `ledge_1x2`, `ledge_1x4`, `ledge_1x6`; inside and outside
90° bends `ledge_bend_*`. The first kit is the cave ink ledge; a hand-painted `GG_Cliff_Rock`
kit follows. Bends that the model cannot paint (it never draws an L) are composed in code from
the straights, as the water bank's are.

Every piece is measured from the drawn art into `packages/core/src/assets/caveWallKit.json`
(`forge/cave-measure.mjs`): its two joints (where the band enters and leaves the piece), the
chord between them and the turn. **The joints must sit where the band's edge meets the image
edge**, the same distance from the void side on every piece, so pieces meet without a step,
and the band's thickness must be the same on every piece.

Past the ledge the engine casts a soft lee shadow as long as the drop, and shades each rock
face from the sun. A slope is drawn, not painted: an ink
contour ring per cell of drop and a shade that deepens ring by ring away from the sun.

## 5. Openings: stairs, ramps, ladders

An opening is to a cliff what a door is to a wall: it cuts a gap in the cliff band and draws
its art across the gap, oriented down the slope, **the top of the image at the high side, the
bottom at the low side**. The art's width runs along the cliff edge.

| Piece | Grid | Use |
|---|---|---|
| `stairs_2x2`, `stairs_2x4`, `stairs_3x2` | as named | steps through a cliff; today the gg-demo `stairs_stone_*` and `stairs_wood_*` stand in |
| `ramp_2x2`, `ramp_2x4` | as named | a smooth incline; the placeholder is a shaded wedge |
| `ladder_1x2` | 1x2 | rungs up a cliff face; the placeholder is two rails |

- The top and bottom edges meet the high and low ground: end them cleanly so the piece sits on
  either floor. The left and right edges meet the cliff band where it was cut: end them with a
  clean side (a stair's stringer, a ramp's lip), since the band stops there.
- No baked cast shadow.

## 6. Order of work

1. Fill tiles for `road-dirt`, `road-cobble`, `trail-grass`, `water`.
2. Edge units for the three roads, water bank straights.
3. Verge and shore objects.
4. Openings.
5. `lava`, `poison`, `ice`, `mud`.

Prod waits for approved fill tiles and units for at least `road-dirt`, `water` and `planks`.
