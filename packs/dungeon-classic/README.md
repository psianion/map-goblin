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

## Installable Pack (`canvas/public/packs/dungeon-classic/pack-4a9bdbee.json`)

The table above describes the legacy static manifest (`textureManifest.ts`), which still
drives floor/wall/object rendering directly and is untouched by this update. Separately,
`AssetPackManager` loads an installable pack manifest — currently the only consumer is
`doorRenderer.ts`, which resolves door sprites as `dungeon-classic:door-{style}-{state}`.
This pack was extended with the slate/ashen asset kit: **109 entries** (was 94) — floor 22,
wall 42, edge 17, scatter 1, object 21, door 6 (new type).

### Door sprite contract

| Entry ID | Source file |
|----------|-------------|
| `door-single-closed` | `Doors/Door_Wood_Ashen_D_1x1.png` |
| `door-single-open` | `Doors/Door_Frames/Door_Frame_Stone_Slate_A_2x1.png` |
| `door-double-closed` | `Doors/Large_Doors/Door_Large_Wood_Ashen_A_2x1.png` |
| `door-double-open` | `Doors/Door_Frames/Door_Frame_Double_Stone_Slate_A_3x1.png` |
| `door-portcullis-closed` | `Doors/Large_Doors/Portcullis_Metal_Gray_A_2x1.png` |
| `door-archway-open` | `Arches/Arch_Small_Stone_Slate_A1_1x2.png` |
| `door-portcullis-open` | **absent** — no such art exists in the source kit; `doorRenderer.ts`'s per-key glyph fallback covers this state |

Single and double closed doors are both Ashen wood on purpose: the kit has no stone
double, so a slate single next to an ashen double split the palette inside one map.
`Door_Wood_Ashen_D` was picked over the other ashen singles because its 5-panel slab
and hinge barrel keep the silhouette the slate door had.

### Wall set: `stone-slate` (superset, 21 pieces)

Replaced the 18-piece `Fence_Stone_Slate_A_*` set with the 21-piece
`Wall_Stone_Slate_A_*` superset (`Walls_and_Curbs/Wall_Stone_A/`): straight ×5 (adds a
seamless `Straight_Path` tiling strip), corner ×8, joint ×4, connector ×3, ending ×1. The
`wood-ashen` set (21 pieces) is unchanged. Set id stays `stone-slate` so existing map
fixtures keep resolving.

### Structural props added (one variant per role, Slate/stone first, Ashen wood otherwise)

| Entry ID | Source file | Note |
|----------|-------------|------|
| `prop-fireplace-slate-ashen` | `Fireplaces/Fireplaces_Corner/Fireplace_Corner_Chimney_Stone_Slate_A_Wood_Ashen_2x2.png` | |
| `prop-pillar-stone-slate` | `Pillars/Stone/Pillar_Stone_Slate_A1_1x1.png` | |
| `prop-stairs-stone-slate` | `Stairs_and_Ladders/Stairs_Stone/Stairs_Stone_Slate_A_1x3.png` | |
| `prop-rubble-stone-earthy` | `Rubble/Rubble_Piles/Stone/Rubble_Pile_Stone_Earthy_A11_2x2.png` | no Slate rubble in the kit — nearest stone substitute |
| `prop-railing-wood-ashen` | `Railings_and_Fences/Railings/Wood/Railing_Rough_Wood_Ashen_B1_2x1.png` | no stone railing in the kit — Ashen wood substitute |
| `prop-arch-stone-slate` | `Arches/Arch_Cross_Stone_Slate_A1_3x3.png` | |

Floors are untouched.
