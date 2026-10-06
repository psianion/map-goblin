# Cave demo — asset + design baseline (2026-08-26)

Target look: the CaveRoomBuilder kit's OWN reference map (the art was drawn to assemble this way).
  - full: D:/DownLs/CaveRoomBuilder/CaveRoomBuilderDemo(22x16).jpg  (3080x2240, 22x16 cells = 140 px/cell)
  - cell-gridded crop: C:/Users/excer/AppData/Local/Temp/claude/D--Labs-map-goblin/4ccbbbdd-d304-466b-9532-7b63fb4292ef/scratchpad/cave/demo-grid.png (magenta = the kit's own 140px grid)
Release gate for all visual output: docs/art-style-guide.md

Current render of our map (flat, no engine lighting/fog):
  - overview: C:/Users/excer/AppData/Local/Temp/claude/D--Labs-map-goblin/4ccbbbdd-d304-466b-9532-7b63fb4292ef/scratchpad/cave/preview3.png (26 px/cell)
  - renderer: C:/Users/excer/AppData/Local/Temp/claude/D--Labs-map-goblin/4ccbbbdd-d304-466b-9532-7b63fb4292ef/scratchpad/preview.mjs   node preview.mjs <out.png> <pxPerCell> [x0 y0 x1 y1]
  - WALLS=1 overlays the floor polygon in magenta

## Measured art facts (verified, do not re-derive)
- wall_short runs along +y; VOID (dark drop shadow) on art -x, FLOOR (pale pebbles) on art +x.
- inside_bend = CONVEX floor corner, void toward art NW. outside_bend = CONCAVE floor corner, void toward art SW.
- rock/pebble split sits ~0.18-0.32 cells off the art midline on the floor side; the kit puts the floor edge there.
- kit band: ~0.8-1.0 cell of solid rock + ~0.5 cell of pebbles spilling onto the floor.

## KNOWN BLOCKER (fix in flight)
20/825 gg-demo object entries ship one image reused across every grid size in the family, so the
renderer stretches it into the wrong box -> non-uniform squash on EVERY wall piece.
Affected: wall_short 2x2/2x4, inside_bend 2x2/3x2/3x3/4x4, outside_bend 2x2/3x2/3x3/4x4/5x3,
ledge 1x2/1x4, ledge_bend 1x1/2x1/2x2/3x3, crate_1/2/3. Only each family's largest member is correct.
Check: node C:/Users/excer/AppData/Local/Temp/claude/D--Labs-map-goblin/4ccbbbdd-d304-466b-9532-7b63fb4292ef/scratchpad/dims.mjs  -> must print 'mismatched 0/N'

## Assets this map uses
| entry | uses | scale range | frame px | cells |
|---|---|---|---|---|
| rubble_small_3x3_object_A | 37 | 0.59–0.95 | 430x413 | 2.15x2.06 |
| wall_short_2x2_object_A | 24 | 1.08–1.30 | 299x400 | 1.50x2.00 |
| rubble_medium_4x2_object_A | 13 | 0.60–0.95 | 750x394 | 3.75x1.97 |
| inside_bend_5x3_object_A | 9 | 1.04–1.04 | 929x592 | 4.64x2.96 |
| outside_bend_5x5_object_A | 9 | 1.03–1.03 | 919x927 | 4.59x4.63 |
| ledge_1x4_object_A | 6 | 1.00–1.00 | 129x798 | 0.65x3.99 |
| wall_short_2x4_object_A | 5 | 1.04–1.04 | 344x800 | 1.72x4.00 |
| outside_bend_5x3_object_A | 4 | 1.04–1.04 | 917x504 | 4.58x2.52 |
| acid_mushroom_1x1_object_A | 4 | 0.80–1.15 | 150x106 | 0.75x0.53 |
| ledge_1x2_object_A | 3 | 1.00–1.00 | 74x400 | 0.37x2.00 |
| outside_bend_3x3_object_A | 3 | 1.06–1.06 | 525x557 | 2.63x2.79 |
| wall_short_2x6_object_A | 3 | 1.03–1.03 | 329x1200 | 1.65x6.00 |
| outside_bend_4x4_object_A | 3 | 1.04–1.04 | 698x713 | 3.49x3.56 |
| ledge_1x6_object_A | 2 | 1.00–1.00 | 149x1200 | 0.74x6.00 |
| rock_outcrop_3x3_object_A | 2 | 1.00–1.00 | 476x493 | 2.38x2.46 |
| clutter_skull_human_1x1_object_A | 2 | 0.90–1.00 | 54x63 | 0.27x0.32 |
| outside_bend_2x2_object_A | 1 | 1.12–1.12 | 331x292 | 1.66x1.46 |
| inside_bend_4x4_object_A | 1 | 1.04–1.04 | 746x734 | 3.73x3.67 |
| inside_bend_3x3_object_A | 1 | 1.06–1.06 | 550x546 | 2.75x2.73 |
| cave_dungeon_adaptor_4x5_object_A | 1 | 1.00–1.00 | 752x829 | 3.76x4.14 |
| stairs_stone_long_2x4_object_A | 1 | 1.00–1.00 | 257x690 | 1.28x3.45 |
| rock_2_2x1_object_A | 1 | 1.00–1.00 | 253x190 | 1.26x0.95 |
| rock_1_2x1_object_A | 1 | 1.00–1.00 | 221x141 | 1.10x0.70 |
| clutter_webs_1_full_2x1_object_A | 1 | 1.00–1.00 | 354x180 | 1.77x0.90 |
| storage_barrel_1_dark_1x1_object_A | 1 | 1.00–1.00 | 94x91 | 0.47x0.46 |
| storage_crates_1_dark_1x1_object_A | 1 | 1.00–1.00 | 177x169 | 0.89x0.84 |
| sack_stack_1_2x1_object_A | 1 | 1.00–1.00 | 221x177 | 1.10x0.89 |
| storage_keg_barrels_and_sacks_2x1_object_A | 1 | 1.00–1.00 | 380x157 | 1.90x0.79 |
| produce_barrel_cabbages_2x2_object_A | 1 | 1.00–1.00 | 233x226 | 1.17x1.13 |
| storage_crate_broken_1_dark_1x1_object_A | 1 | 1.00–1.00 | 163x134 | 0.81x0.67 |
| bed_pattern_1_a_2x3_object_A | 1 | 1.00–1.00 | 331x420 | 1.66x2.10 |
| decoration_bear_skin_rug_2x2_object_A | 1 | 1.00–1.00 | 287x339 | 1.44x1.70 |
| clutter_skull_giant_1x1_object_A | 1 | 1.00–1.00 | 91x106 | 0.46x0.53 |
| chest_1_steel_1x1_object_A | 1 | 1.00–1.00 | 137x103 | 0.69x0.52 |
| weapon_rack_1_dark_1x1_object_A | 1 | 1.00–1.00 | 126x160 | 0.63x0.80 |
| light_brazier_1_a_1x1_object_A | 1 | 1.00–1.00 | 151x160 | 0.76x0.80 |
| campfire_1x1_object_A | 1 | 1.00–1.00 | 168x170 | 0.84x0.85 |
| campfire_pot_cooking_1x1_object_A | 1 | 1.00–1.00 | 89x84 | 0.45x0.42 |
| firewood_pile_2x1_object_A | 1 | 1.00–1.00 | 346x197 | 1.73x0.98 |
| log_seat_1_1x1_object_A | 1 | 1.00–1.00 | 104x96 | 0.52x0.48 |
| log_seat_2_1x1_object_A | 1 | 1.00–1.00 | 104x96 | 0.52x0.48 |
| boulder_2x2_object_A | 1 | 1.00–1.00 | 384x391 | 1.92x1.96 |
| tunic_stack_1_2x2_object_A | 1 | 1.00–1.00 | 221x217 | 1.10x1.08 |
| spider_web_3x2_object_A | 1 | 1.00–1.00 | 509x249 | 2.54x1.25 |
| clutter_webs_2_full_2x1_object_A | 1 | 1.00–1.00 | 220x163 | 1.10x0.81 |
| clutter_webs_3_full_2x1_object_A | 1 | 1.00–1.00 | 217x126 | 1.08x0.63 |
| clutter_webs_4_full_1x1_object_A | 1 | 1.00–1.00 | 134x106 | 0.67x0.53 |
| storage_crate_broken_2_dark_1x1_object_A | 1 | 1.00–1.00 | 120x166 | 0.60x0.83 |
| campfire_ring_2x2_object_A | 1 | 1.00–1.00 | 326x334 | 1.63x1.67 |
| bear_trap_1x1_object_A | 1 | 1.00–1.00 | 158x146 | 0.79x0.73 |
| rock_small_1_1x1_object_A | 1 | 1.00–1.00 | 114x107 | 0.57x0.54 |
| clutter_broken_boards_1_dark_1x2_object_A | 1 | 1.00–1.00 | 200x203 | 1.00x1.01 |
| stairs_stone_short_2x2_object_A | 1 | 1.00–1.00 | 237x401 | 1.19x2.00 |
| chest_2_gold_1x1_object_A | 1 | 1.00–1.00 | 149x106 | 0.74x0.53 |
| mystery_sack_1x1_object_A | 1 | 1.00–1.00 | 64x80 | 0.32x0.40 |
| clutter_scales_gold_1x1_object_A | 1 | 1.00–1.00 | 143x69 | 0.71x0.34 |
TOTAL entries used: 56  instances: 169

## Traps found while building this (2026-08-26)

- **"No wall set" is expressed by ABSENCE.** A cave layer must have no `style.wallTextureSetId` — the
  visible wall is the painted band, and a wall set would lay masonry stones over it. But `DungeonStyle`
  types the field optional (`packages/core/src/store/types.ts:85`) and `DEFAULT_DUNGEON_STYLE`
  (`store/factories.ts:23`) is `GG_Fieldstone`. Load preserves absence today because the default is only
  spread when CREATING a layer (`factories.ts:46`), not on load — so the intent survives by luck, not by
  design. Anything that starts merging defaults on load, or a preset applied to the layer, silently
  fieldstones the cave. If cave walls must stay textureless, the doc needs a way to SAY so.
- **The cave outline gets no standalone wall** — `resolveWalls` (`shared/wallResolve.ts:82`) already emits
  one occluding wall per merged-floor-ring edge. Authoring a second ring gave two unlinked 250-point
  objects that drift apart under node editing. Only the door chords are standalone now.
  Consequence to watch: floor-ring walls are keyed `floor:<index>`, which is POSITIONAL — if this map
  ever grows a second floor shape or an island, the indices renumber and any saved ring edits land on
  the wrong ring. Single ring today, so it cannot bite yet.
- **gg-demo cannot be rebuilt from inside the repo.** Its manifest is a committed artifact; the build
  inputs live in `D:/Labs/test-asset-sets` (outside the repo). A machine without that directory can read
  the pack but never regenerate it.
