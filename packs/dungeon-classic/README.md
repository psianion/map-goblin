# dungeon-classic — Foundation Pack

Ships with map-builder as the zero-install experience. All textures referenced by `legacyAssetMapping.ts` must be present with exact localId matches.

## Asset Inventory

Source: `map-builder/public/textures/`

| Category | Count | Format | Notes |
|----------|-------|--------|-------|
| Floor    | 22    | JPG    | 7 subcategories: cave(2), dirt(4), grass(2), gravel(2), stone(5), water(2), wood(5) |
| Wall     | 39    | PNG    | 2 sets: stone-slate-a(18), wood-ashen-b(21). Modular pieces with variants |
| Edge     | 17    | PNG    | 6 subcategories: banks(3), burrows(2), cliff-tops(2), cliffs(6), floor-breaks(2), under-cliffs(2) |
| Scatter  | 1     | PNG    | Grass path scatter |
| Object   | 15    | PNG    | Campfires, lamps, logs, puddles, rocks, stumps, trees, leaves, grass |
| **Total**| **94**|        | |

## Legacy ID → localId Mapping

These localId values are frozen for v1.x. Changing them breaks `legacyAssetMapping.ts` in map-builder.

### Floor Textures (15 entries)

| Legacy ID | localId | Source File |
|-----------|---------|-------------|
| `grass-a-01` | `grass-a-01_1x1_floor_A` | `Grass_A_01.jpg` |
| `grass-a-09` | `grass-a-09_1x1_floor_A` | `Grass_A_09.jpg` |
| `dirt-b-04` | `dirt-b-04_1x1_floor_A` | `Dirt_B_04.jpg` |
| `dirt-c-02` | `dirt-c-02_1x1_floor_A` | `Dirt_C_02.jpg` |
| `cracked-dirt-a-01` | `cracked-dirt-a-01_1x1_floor_A` | `Cracked_Dirt_A_01.jpg` |
| `grassy-dirt-a-02` | `grassy-dirt-a-02_1x1_floor_A` | `Grassy_Dirt_A_02.jpg` |
| `cobblestone-a-01` | `cobblestone-a-01_1x1_floor_A` | `Cobblestone_A_01.jpg` |
| `large-flagstone-a-01` | `large-flagstone-a-01_1x1_floor_A` | `Large_Flagstone_A_01.jpg` |
| `rock-tiles-b-01` | `rock-tiles-b-01_1x1_floor_A` | `Rock_Tiles_B_01.jpg` |
| `rectangular-tiles-a-01` | `rectangular-tiles-a-01_1x1_floor_A` | `Rectangular_Tiles_A_01.jpg` |
| `smooth-stone-floor-a-10` | `smooth-stone-floor-a-10_1x1_floor_A` | `Smooth_Stone_Floor_Terrain_A_10.jpg` |
| `cave-floor-06-a` | `cave-floor-06-a_1x1_floor_A` | `Cave_Floor_06_A.jpg` |
| `rock-ground-c-06` | `rock-ground-c-06_1x1_floor_A` | `Rock_Ground_C_06.jpg` |
| `gravel-06-c` | `gravel-06-c_1x1_floor_A` | `Gravel_06_C.jpg` |
| `gravel-06-j` | `gravel-06-j_1x1_floor_A` | `Gravel_06_J.jpg` |

### Wall Textures (2 entries)

| Legacy ID | localId | Source Set |
|-----------|---------|------------|
| `stone-slate` | `stone-slate_1x1_floor_A` | `walls/stone-slate-a/` (18 pieces) |
| `wood-ashen` | `wood-ashen_1x1_floor_A` | `walls/wood-ashen-b/` (21 pieces) |

## Conventions

- Floor localIds: `{legacy-id}_1x1_floor_A`
- Wall localIds: `{legacy-id}_1x1_floor_A` (note: legacy mapping uses floor_A suffix for walls too)
- Edge localIds: `{legacy-id}_edge_A`
- Object localIds: `{legacy-id}_object_A`
