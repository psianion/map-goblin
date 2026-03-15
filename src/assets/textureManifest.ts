// ─── Asset Type System ─────────────────────────────────────────────
// Every asset has a `type` that tells the engine HOW to use it:
//   floor    → seamless tileable fill inside drawn shapes (TilingSprite)
//   edge     → horizontal strip placed along terrain boundaries (path-tiled)
//   object   → standalone prop placed individually or via scatter brush
//   wall     → modular wall piece (straight, corner, joint, connector, ending)
//   scatter  → decoration strip tiled along paths for ground scatter
//
// Grid unit: 200px = 1 grid cell (FA standard at 200ppi)
// NxM naming: "6x3" means 6 cells wide × 3 cells tall = 1200×600px

// ─── Types ─────────────────────────────────────────────────────────

export type AssetType = 'floor' | 'edge' | 'object' | 'wall' | 'scatter';

export type FloorCategory = 'grass' | 'dirt' | 'stone' | 'cave' | 'gravel' | 'wood' | 'water';

export type EdgeCategory = 'bank' | 'cliff' | 'cliff-top' | 'under-cliff' | 'burrow' | 'floor-break';

export type ObjectCategory = 'tree' | 'foliage' | 'campfire' | 'lamp' | 'rock' | 'puddle' | 'log';

export type WallCategory = 'stone-slate' | 'wood-ashen';

export type WallPiece = 'straight' | 'corner' | 'joint' | 'connector' | 'ending' | 'path';

export type AssetCategory = FloorCategory | EdgeCategory | ObjectCategory | WallCategory | 'scatter';

export interface TextureEntry {
  /** Unique ID — lowercase-kebab, matches the folder+file convention */
  id: string;
  /** URL path relative to public root */
  path: string;
  /** How the engine uses this asset */
  type: AssetType;
  /** Sub-category within the type */
  category: AssetCategory;
  /** Pixel width of source image */
  naturalWidth: number;
  /** Pixel height of source image */
  naturalHeight: number;
  /** Grid size NxM (e.g. "6x6" for a tree that covers 6×6 cells) */
  gridSize?: string;
  /** For wall pieces: which modular piece type */
  wallPiece?: WallPiece;
  /** Human-readable display name */
  label: string;
  /** Optional search tags */
  tags?: string[];
  /** Opaque content bounds within the PNG (for textures with transparent padding).
   *  When set, textureLoader creates a Texture with this frame so only visible
   *  content is used — transparent padding is excluded from tiling/rendering. */
  contentRect?: { x: number; y: number; w: number; h: number };
}

// ─── Floor Textures ────────────────────────────────────────────────
// Seamless square JPGs, used by Phase 2 polygon-fill TilingSprite system.

const FLOORS: TextureEntry[] = [
  // Grass
  { id: 'grass-a-01', path: '/textures/floors/grass/Grass_A_01.jpg', type: 'floor', category: 'grass', naturalWidth: 1200, naturalHeight: 1200, label: 'Grass A 01', tags: ['outdoor', 'terrain'] },
  { id: 'grass-a-09', path: '/textures/floors/grass/Grass_A_09.jpg', type: 'floor', category: 'grass', naturalWidth: 1200, naturalHeight: 1200, label: 'Grass A 09', tags: ['outdoor', 'terrain'] },

  // Dirt
  { id: 'dirt-b-04', path: '/textures/floors/dirt/Dirt_B_04.jpg', type: 'floor', category: 'dirt', naturalWidth: 1000, naturalHeight: 1000, label: 'Dirt B 04', tags: ['outdoor', 'terrain'] },
  { id: 'dirt-c-02', path: '/textures/floors/dirt/Dirt_C_02.jpg', type: 'floor', category: 'dirt', naturalWidth: 1000, naturalHeight: 1000, label: 'Dirt C 02', tags: ['outdoor', 'terrain'] },
  { id: 'cracked-dirt-a-01', path: '/textures/floors/dirt/Cracked_Dirt_A_01.jpg', type: 'floor', category: 'dirt', naturalWidth: 1000, naturalHeight: 1000, label: 'Cracked Dirt A 01', tags: ['outdoor', 'terrain', 'cracked'] },
  { id: 'grassy-dirt-a-02', path: '/textures/floors/dirt/Grassy_Dirt_A_02.jpg', type: 'floor', category: 'dirt', naturalWidth: 1000, naturalHeight: 1000, label: 'Grassy Dirt A 02', tags: ['outdoor', 'terrain', 'mixed'] },

  // Stone
  { id: 'cobblestone-a-01', path: '/textures/floors/stone/Cobblestone_A_01.jpg', type: 'floor', category: 'stone', naturalWidth: 600, naturalHeight: 600, label: 'Cobblestone A 01', tags: ['indoor', 'dungeon', 'town'] },
  { id: 'large-flagstone-a-01', path: '/textures/floors/stone/Large_Flagstone_A_01.jpg', type: 'floor', category: 'stone', naturalWidth: 800, naturalHeight: 800, label: 'Large Flagstone A 01', tags: ['indoor', 'dungeon', 'castle'] },
  { id: 'rock-tiles-b-01', path: '/textures/floors/stone/Rock_Tiles_B_01.jpg', type: 'floor', category: 'stone', naturalWidth: 600, naturalHeight: 600, label: 'Rock Tiles B 01', tags: ['indoor', 'dungeon'] },
  { id: 'rectangular-tiles-a-01', path: '/textures/floors/stone/Rectangular_Tiles_A_01.jpg', type: 'floor', category: 'stone', naturalWidth: 600, naturalHeight: 600, label: 'Rectangular Tiles A 01', tags: ['indoor', 'dungeon', 'temple'] },
  { id: 'smooth-stone-floor-a-10', path: '/textures/floors/stone/Smooth_Stone_Floor_Terrain_A_10.jpg', type: 'floor', category: 'stone', naturalWidth: 1600, naturalHeight: 1600, label: 'Smooth Stone Floor A 10', tags: ['indoor', 'dungeon', 'terrain'] },

  // Cave
  { id: 'cave-floor-06-a', path: '/textures/floors/cave/Cave_Floor_06_A.jpg', type: 'floor', category: 'cave', naturalWidth: 1000, naturalHeight: 1000, label: 'Cave Floor 06 A', tags: ['underground', 'dungeon'] },
  { id: 'rock-ground-c-06', path: '/textures/floors/cave/Rock_Ground_C_06.jpg', type: 'floor', category: 'cave', naturalWidth: 1000, naturalHeight: 1000, label: 'Rock Ground C 06', tags: ['underground', 'outdoor'] },

  // Gravel
  { id: 'gravel-06-c', path: '/textures/floors/gravel/Gravel_06_C.jpg', type: 'floor', category: 'gravel', naturalWidth: 1000, naturalHeight: 1000, label: 'Gravel 06 C', tags: ['outdoor', 'path'] },
  { id: 'gravel-06-j', path: '/textures/floors/gravel/Gravel_06_J.jpg', type: 'floor', category: 'gravel', naturalWidth: 1000, naturalHeight: 1000, label: 'Gravel 06 J', tags: ['outdoor', 'path'] },

  // Wood
  { id: 'wood-flooring-ashen', path: '/textures/floors/wood/Wooden_Flooring_A_Ashen.jpg', type: 'floor', category: 'wood', naturalWidth: 1000, naturalHeight: 1000, label: 'Wood Flooring Ashen', tags: ['indoor', 'building'] },
  { id: 'wood-flooring-dark', path: '/textures/floors/wood/Wooden_Flooring_B_Dark.jpg', type: 'floor', category: 'wood', naturalWidth: 1000, naturalHeight: 1000, label: 'Wood Flooring Dark', tags: ['indoor', 'building'] },
  { id: 'wood-flooring-light', path: '/textures/floors/wood/Wooden_Flooring_C_Light.jpg', type: 'floor', category: 'wood', naturalWidth: 1000, naturalHeight: 1000, label: 'Wood Flooring Light', tags: ['indoor', 'building'] },
  { id: 'wood-flooring-red', path: '/textures/floors/wood/Wooden_Flooring_D_Red.jpg', type: 'floor', category: 'wood', naturalWidth: 1000, naturalHeight: 1000, label: 'Wood Flooring Red', tags: ['indoor', 'building', 'tavern'] },
  { id: 'wood-flooring-walnut', path: '/textures/floors/wood/Wooden_Flooring_E_Walnut.jpg', type: 'floor', category: 'wood', naturalWidth: 1000, naturalHeight: 1000, label: 'Wood Flooring Walnut', tags: ['indoor', 'building'] },

  // Water
  { id: 'water-opaque-a-03', path: '/textures/floors/water/Water_Opaque_A_03.jpg', type: 'floor', category: 'water', naturalWidth: 1000, naturalHeight: 1000, label: 'Water Opaque A 03', tags: ['water', 'outdoor'] },
  { id: 'water-still-a-01', path: '/textures/floors/water/Water_Still_A_01.jpg', type: 'floor', category: 'water', naturalWidth: 1400, naturalHeight: 1400, label: 'Water Still A 01', tags: ['water', 'outdoor'] },
];

// ─── Edge Strips ───────────────────────────────────────────────────
// Horizontal PNG strips with alpha transparency.
// Placed along terrain boundaries via the edge/path tiling system.
// Tiled horizontally along the boundary; height faces inward.

const EDGES: TextureEntry[] = [
  // Banks — soft terrain edges (grass-to-water, dirt-to-water)
  { id: 'bank-dirt-01-a1', path: '/textures/edges/banks/Bank_Dirt_01_Path_A1.png', type: 'edge', category: 'bank', naturalWidth: 800, naturalHeight: 200, label: 'Bank Dirt 01', tags: ['transition', 'water'] },
  { id: 'bank-grassy-01-a1', path: '/textures/edges/banks/Bank_Grassy_01_Path_A1.png', type: 'edge', category: 'bank', naturalWidth: 800, naturalHeight: 200, label: 'Bank Grassy 01', tags: ['transition', 'water'] },
  { id: 'bank-stone-mossy-a1', path: '/textures/edges/banks/Bank_Stone_Mossy_Path_A1.png', type: 'edge', category: 'bank', naturalWidth: 800, naturalHeight: 200, label: 'Bank Stone Mossy', tags: ['transition', 'water'] },

  // Cliffs — steep terrain drops (800×400, content occupies top half)
  { id: 'cliff-dirt-01-d1', path: '/textures/edges/cliffs/Cliff_Dirt_01_Path_D1.png', type: 'edge', category: 'cliff', naturalWidth: 800, naturalHeight: 400, label: 'Cliff Dirt 01 D1', tags: ['elevation', 'outdoor'] },
  { id: 'cliff-dirt-01-e3', path: '/textures/edges/cliffs/Cliff_Dirt_01_Path_E3.png', type: 'edge', category: 'cliff', naturalWidth: 800, naturalHeight: 400, label: 'Cliff Dirt 01 E3', tags: ['elevation', 'outdoor'] },
  { id: 'cliff-dirt-02-h2', path: '/textures/edges/cliffs/Cliff_Dirt_02_Path_H2.png', type: 'edge', category: 'cliff', naturalWidth: 800, naturalHeight: 400, label: 'Cliff Dirt 02 H2', tags: ['elevation', 'outdoor'] },
  { id: 'cliff-grassy-01-f1', path: '/textures/edges/cliffs/Cliff_Grassy_01_Path_F1.png', type: 'edge', category: 'cliff', naturalWidth: 800, naturalHeight: 400, label: 'Cliff Grassy 01 F1', tags: ['elevation', 'outdoor'] },
  { id: 'cliff-stone-mossy-d1', path: '/textures/edges/cliffs/Cliff_Stone_Mossy_Path_D1.png', type: 'edge', category: 'cliff', naturalWidth: 800, naturalHeight: 400, label: 'Cliff Stone Mossy D1', tags: ['elevation', 'outdoor'] },
  { id: 'cliff-stone-mossy-g1', path: '/textures/edges/cliffs/Cliff_Stone_Mossy_Path_G1.png', type: 'edge', category: 'cliff', naturalWidth: 800, naturalHeight: 400, label: 'Cliff Stone Mossy G1', tags: ['elevation', 'outdoor'] },

  // Cliff tops — upper lip of cliffs (800×200, content occupies bottom)
  { id: 'cliff-top-stone-mossy-a1', path: '/textures/edges/cliff-tops/Cliff_Top_Stone_Mossy_A1_Path_A1.png', type: 'edge', category: 'cliff-top', naturalWidth: 800, naturalHeight: 200, label: 'Cliff Top Stone Mossy A1', tags: ['elevation', 'outdoor'] },
  { id: 'cliff-top-stone-mossy-a2', path: '/textures/edges/cliff-tops/Cliff_Top_Stone_Mossy_A2_Path_A1.png', type: 'edge', category: 'cliff-top', naturalWidth: 800, naturalHeight: 200, label: 'Cliff Top Stone Mossy A2', tags: ['elevation', 'outdoor'] },

  // Under-cliffs — debris/rubble at cliff base
  { id: 'under-cliff-01-a1', path: '/textures/edges/under-cliffs/Under_Cliff_01_Path_A1.png', type: 'edge', category: 'under-cliff', naturalWidth: 800, naturalHeight: 400, label: 'Under Cliff 01', tags: ['elevation', 'rubble'] },
  { id: 'under-cliff-02-a2', path: '/textures/edges/under-cliffs/Under_Cliff_02_Path_A2.png', type: 'edge', category: 'under-cliff', naturalWidth: 800, naturalHeight: 400, label: 'Under Cliff 02', tags: ['elevation', 'rubble'] },

  // Burrows — cave entrance edges
  { id: 'burrow-cave-dirt-01-a1', path: '/textures/edges/burrows/Burrows_Cave_Dirt_01_Path_A1.png', type: 'edge', category: 'burrow', naturalWidth: 800, naturalHeight: 400, label: 'Burrow Cave Dirt 01', tags: ['cave', 'transition'] },
  { id: 'burrow-cave-stone-mossy-a1', path: '/textures/edges/burrows/Burrows_Cave_Stone_Mossy_Path_A1.png', type: 'edge', category: 'burrow', naturalWidth: 800, naturalHeight: 400, label: 'Burrow Cave Stone Mossy', tags: ['cave', 'transition'] },

  // Floor breaks — thin decorative lines between floor types
  { id: 'floor-break-stone-slate-a', path: '/textures/edges/floor-breaks/Floor_Break_Stone_Slate_A_Path.png', type: 'edge', category: 'floor-break', naturalWidth: 3600, naturalHeight: 200, label: 'Floor Break Stone Slate A', tags: ['indoor', 'border'] },
  { id: 'floor-break-wood-ashen-a', path: '/textures/edges/floor-breaks/Floor_Break_Wood_Ashen_A_Path.png', type: 'edge', category: 'floor-break', naturalWidth: 1800, naturalHeight: 200, label: 'Floor Break Wood Ashen A', tags: ['indoor', 'border'] },
];

// ─── Objects / Props ───────────────────────────────────────────────
// RGBA PNGs, placed individually or via scatter brush.
// gridSize encodes footprint in grid cells (200px per cell).

const OBJECTS: TextureEntry[] = [
  // Trees
  { id: 'tree-green-a1', path: '/textures/objects/Tree_Green_A1_6x6.png', type: 'object', category: 'tree', naturalWidth: 1200, naturalHeight: 1200, gridSize: '6x6', label: 'Tree Green A1', tags: ['outdoor', 'forest'] },

  // Foliage
  { id: 'fallen-leaves-green1-a1', path: '/textures/objects/Fallen_Leaves_Piles_Green1_A1_1x1.png', type: 'object', category: 'foliage', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Fallen Leaves Green A1', tags: ['outdoor', 'scatter', 'forest'] },
  { id: 'grass-patch-green1-a1', path: '/textures/objects/Grass_Patch_Green1_A1_1x1.png', type: 'object', category: 'foliage', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Grass Patch Green A1', tags: ['outdoor', 'scatter'] },
  { id: 'stump-ashen-a1', path: '/textures/objects/Stump_Ashen_A1_4x4.png', type: 'object', category: 'foliage', naturalWidth: 800, naturalHeight: 800, gridSize: '4x4', label: 'Stump Ashen A1', tags: ['outdoor', 'forest'] },

  // Campfires
  { id: 'campfire-embers-b1', path: '/textures/objects/Campfire_Embers_B1_1x1.png', type: 'object', category: 'campfire', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Campfire Embers B1', tags: ['light', 'camp'] },
  { id: 'campfire-wood-sandstone-a1', path: '/textures/objects/Campfire_Wood_Dark_Stone_Sandstone_Lit_A1_1x1.png', type: 'object', category: 'campfire', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Campfire Sandstone Lit A1', tags: ['light', 'camp'] },

  // Lamps
  { id: 'lamp-metal-brass-a', path: '/textures/objects/Lamp_Metal_Brass_A_1x1.png', type: 'object', category: 'lamp', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Lamp Metal Brass A', tags: ['light', 'indoor'] },
  { id: 'lamp-street-brass-a', path: '/textures/objects/Lamp_Street_Metal_Brass_A_1x1.png', type: 'object', category: 'lamp', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Lamp Street Brass A', tags: ['light', 'outdoor', 'town'] },

  // Rocks
  { id: 'rock-stone-mossy-c11', path: '/textures/objects/Rock_Stone_Mossy_C11_2x1.png', type: 'object', category: 'rock', naturalWidth: 400, naturalHeight: 200, gridSize: '2x1', label: 'Rock Stone Mossy C11', tags: ['outdoor', 'scatter'] },

  // Puddles
  { id: 'puddle-water-blue-a1', path: '/textures/objects/Puddle_Water_Blue_A1_2x2.png', type: 'object', category: 'puddle', naturalWidth: 400, naturalHeight: 400, gridSize: '2x2', label: 'Puddle Water Blue A1', tags: ['water', 'scatter'] },
  { id: 'puddle-water-blue-a11', path: '/textures/objects/Puddle_Water_Blue_A11_1x1.png', type: 'object', category: 'puddle', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Puddle Water Blue A11', tags: ['water', 'scatter'] },
  { id: 'puddle-water-muddy-a5', path: '/textures/objects/Puddle_Water_Muddy_A5_2x2.png', type: 'object', category: 'puddle', naturalWidth: 400, naturalHeight: 400, gridSize: '2x2', label: 'Puddle Water Muddy A5', tags: ['water', 'scatter'] },
  { id: 'puddle-water-muddy-a12', path: '/textures/objects/Puddle_Water_Muddy_A12_2x2.png', type: 'object', category: 'puddle', naturalWidth: 400, naturalHeight: 400, gridSize: '2x2', label: 'Puddle Water Muddy A12', tags: ['water', 'scatter'] },

  // Logs
  { id: 'log-ashen-a1', path: '/textures/objects/Log_Ashen_A1_6x3.png', type: 'object', category: 'log', naturalWidth: 1200, naturalHeight: 600, gridSize: '6x3', label: 'Log Ashen A1', tags: ['outdoor', 'forest'] },
  { id: 'log-bridge-walnut-a1', path: '/textures/objects/Log_Bridge_Wood_Walnut_A1_11x4.png', type: 'object', category: 'log', naturalWidth: 2200, naturalHeight: 800, gridSize: '11x4', label: 'Log Bridge Walnut A1', tags: ['outdoor', 'bridge'] },
];

// ─── Wall Sets ─────────────────────────────────────────────────────
// Modular wall pieces with wallPiece type for auto-assembly.
// Pieces: straight (segments), corner (turns), joint (T/X intersections),
//         connector (decorative joins), ending (wall terminations), path (ribbon).

const WALLS_STONE_SLATE_A: TextureEntry[] = [
  // Straight segments — contentRect from alpha scan (stone band centered vertically)
  { id: 'wall-stone-a-straight-a-3x1', path: '/textures/walls/stone-slate-a/Fence_Stone_Slate_A_Straight_A_3x1.png', type: 'wall', category: 'stone-slate', wallPiece: 'straight', naturalWidth: 600, naturalHeight: 200, gridSize: '3x1', label: 'Stone Wall Straight A 3x1', contentRect: { x: 0, y: 68, w: 600, h: 61 } },
  { id: 'wall-stone-a-straight-b-2x1', path: '/textures/walls/stone-slate-a/Fence_Stone_Slate_A_Straight_B_2x1.png', type: 'wall', category: 'stone-slate', wallPiece: 'straight', naturalWidth: 400, naturalHeight: 200, gridSize: '2x1', label: 'Stone Wall Straight B 2x1', contentRect: { x: 0, y: 68, w: 400, h: 61 } },
  { id: 'wall-stone-a-straight-c-1x1', path: '/textures/walls/stone-slate-a/Fence_Stone_Slate_A_Straight_C_1x1.png', type: 'wall', category: 'stone-slate', wallPiece: 'straight', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Stone Wall Straight C 1x1', contentRect: { x: 0, y: 73, w: 200, h: 57 } },
  { id: 'wall-stone-a-straight-d-1x1', path: '/textures/walls/stone-slate-a/Fence_Stone_Slate_A_Straight_D_1x1.png', type: 'wall', category: 'stone-slate', wallPiece: 'straight', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Stone Wall Straight D 1x1', contentRect: { x: 0, y: 73, w: 100, h: 53 } },

  // Corners — no contentRect (transparent padding provides alignment)
  { id: 'wall-stone-a-corner-a-1x1', path: '/textures/walls/stone-slate-a/Fence_Stone_Slate_A_Corner_A_1x1.png', type: 'wall', category: 'stone-slate', wallPiece: 'corner', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Stone Wall Corner A 1x1' },
  { id: 'wall-stone-a-corner-b-1x1', path: '/textures/walls/stone-slate-a/Fence_Stone_Slate_A_Corner_B_1x1.png', type: 'wall', category: 'stone-slate', wallPiece: 'corner', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Stone Wall Corner B 1x1' },
  { id: 'wall-stone-a-corner-c-1x1', path: '/textures/walls/stone-slate-a/Fence_Stone_Slate_A_Corner_C_1x1.png', type: 'wall', category: 'stone-slate', wallPiece: 'corner', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Stone Wall Corner C 1x1' },
  { id: 'wall-stone-a-corner-d-2x2', path: '/textures/walls/stone-slate-a/Fence_Stone_Slate_A_Corner_D_2x2.png', type: 'wall', category: 'stone-slate', wallPiece: 'corner', naturalWidth: 400, naturalHeight: 400, gridSize: '2x2', label: 'Stone Wall Corner D 2x2' },
  { id: 'wall-stone-a-corner-e-2x2', path: '/textures/walls/stone-slate-a/Fence_Stone_Slate_A_Corner_E_2x2.png', type: 'wall', category: 'stone-slate', wallPiece: 'corner', naturalWidth: 400, naturalHeight: 400, gridSize: '2x2', label: 'Stone Wall Corner E 2x2' },
  { id: 'wall-stone-a-corner-f-3x3', path: '/textures/walls/stone-slate-a/Fence_Stone_Slate_A_Corner_F_3x3.png', type: 'wall', category: 'stone-slate', wallPiece: 'corner', naturalWidth: 600, naturalHeight: 600, gridSize: '3x3', label: 'Stone Wall Corner F 3x3' },

  // Joints (T/X intersections)
  { id: 'wall-stone-a-joint-a-1x1', path: '/textures/walls/stone-slate-a/Fence_Stone_Slate_A_Joint_A_1x1.png', type: 'wall', category: 'stone-slate', wallPiece: 'joint', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Stone Wall Joint A 1x1' },
  { id: 'wall-stone-a-joint-b-1x1', path: '/textures/walls/stone-slate-a/Fence_Stone_Slate_A_Joint_B_1x1.png', type: 'wall', category: 'stone-slate', wallPiece: 'joint', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Stone Wall Joint B 1x1' },

  // Connectors (decorative join pieces)
  { id: 'wall-stone-a-connector-a-1x1', path: '/textures/walls/stone-slate-a/Fence_Stone_Slate_A_Connector_A_1x1.png', type: 'wall', category: 'stone-slate', wallPiece: 'connector', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Stone Wall Connector A 1x1' },
  { id: 'wall-stone-a-connector-b-1x1', path: '/textures/walls/stone-slate-a/Fence_Stone_Slate_A_Connector_B_1x1.png', type: 'wall', category: 'stone-slate', wallPiece: 'connector', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Stone Wall Connector B 1x1' },
  { id: 'wall-stone-a-connector-c-1x1', path: '/textures/walls/stone-slate-a/Fence_Stone_Slate_A_Connector_C_1x1.png', type: 'wall', category: 'stone-slate', wallPiece: 'connector', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Stone Wall Connector C 1x1' },
  { id: 'wall-stone-a-connector-d-1x1', path: '/textures/walls/stone-slate-a/Fence_Stone_Slate_A_Connector_D_1x1.png', type: 'wall', category: 'stone-slate', wallPiece: 'connector', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Stone Wall Connector D 1x1' },
  { id: 'wall-stone-a-connector-diag-a-1x1', path: '/textures/walls/stone-slate-a/Fence_Stone_Slate_A_Connector_DIAG_A_1x1.png', type: 'wall', category: 'stone-slate', wallPiece: 'connector', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Stone Wall Connector Diag A 1x1' },

  // Ending
  { id: 'wall-stone-a-ending-a-1x1', path: '/textures/walls/stone-slate-a/Fence_Stone_Slate_A_Ending_A_1x1.png', type: 'wall', category: 'stone-slate', wallPiece: 'ending', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Stone Wall Ending A 1x1' },
];

const WALLS_WOOD_ASHEN_B: TextureEntry[] = [
  // Straight segments — contentRect: thin wood plank band at y=84
  { id: 'wall-wood-b-straight-a-3x1', path: '/textures/walls/wood-ashen-b/Wall_Wood_Ashen_B_Straight_A_3x1.png', type: 'wall', category: 'wood-ashen', wallPiece: 'straight', naturalWidth: 600, naturalHeight: 200, gridSize: '3x1', label: 'Wood Wall Straight A 3x1', contentRect: { x: 0, y: 84, w: 600, h: 32 } },
  { id: 'wall-wood-b-straight-b-2x1', path: '/textures/walls/wood-ashen-b/Wall_Wood_Ashen_B_Straight_B_2x1.png', type: 'wall', category: 'wood-ashen', wallPiece: 'straight', naturalWidth: 400, naturalHeight: 200, gridSize: '2x1', label: 'Wood Wall Straight B 2x1', contentRect: { x: 0, y: 84, w: 400, h: 32 } },
  { id: 'wall-wood-b-straight-c-1x1', path: '/textures/walls/wood-ashen-b/Wall_Wood_Ashen_B_Straight_C_1x1.png', type: 'wall', category: 'wood-ashen', wallPiece: 'straight', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Wood Wall Straight C 1x1', contentRect: { x: 0, y: 84, w: 200, h: 32 } },
  { id: 'wall-wood-b-straight-d-1x1', path: '/textures/walls/wood-ashen-b/Wall_Wood_Ashen_B_Straight_D_1x1.png', type: 'wall', category: 'wood-ashen', wallPiece: 'straight', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Wood Wall Straight D 1x1', contentRect: { x: 0, y: 84, w: 100, h: 32 } },
  { id: 'wall-wood-b-straight-path', path: '/textures/walls/wood-ashen-b/Wall_Wood_Ashen_B_Straight_Path.png', type: 'wall', category: 'wood-ashen', wallPiece: 'path', naturalWidth: 1650, naturalHeight: 200, gridSize: '8x1', label: 'Wood Wall Path Strip', contentRect: { x: 0, y: 84, w: 1650, h: 32 } },

  // Corners — no contentRect (transparent padding provides alignment)
  { id: 'wall-wood-b-corner-a-1x1', path: '/textures/walls/wood-ashen-b/Wall_Wood_Ashen_B_Corner_A_1x1.png', type: 'wall', category: 'wood-ashen', wallPiece: 'corner', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Wood Wall Corner A 1x1' },
  { id: 'wall-wood-b-corner-b-1x1', path: '/textures/walls/wood-ashen-b/Wall_Wood_Ashen_B_Corner_B_1x1.png', type: 'wall', category: 'wood-ashen', wallPiece: 'corner', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Wood Wall Corner B 1x1' },
  { id: 'wall-wood-b-corner-c-1x1', path: '/textures/walls/wood-ashen-b/Wall_Wood_Ashen_B_Corner_C_1x1.png', type: 'wall', category: 'wood-ashen', wallPiece: 'corner', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Wood Wall Corner C 1x1' },
  { id: 'wall-wood-b-corner-d-2x2', path: '/textures/walls/wood-ashen-b/Wall_Wood_Ashen_B_Corner_D_2x2.png', type: 'wall', category: 'wood-ashen', wallPiece: 'corner', naturalWidth: 400, naturalHeight: 400, gridSize: '2x2', label: 'Wood Wall Corner D 2x2' },
  { id: 'wall-wood-b-corner-e-2x2', path: '/textures/walls/wood-ashen-b/Wall_Wood_Ashen_B_Corner_E_2x2.png', type: 'wall', category: 'wood-ashen', wallPiece: 'corner', naturalWidth: 400, naturalHeight: 400, gridSize: '2x2', label: 'Wood Wall Corner E 2x2' },
  { id: 'wall-wood-b-corner-f-2x2', path: '/textures/walls/wood-ashen-b/Wall_Wood_Ashen_B_Corner_F_2x2.png', type: 'wall', category: 'wood-ashen', wallPiece: 'corner', naturalWidth: 400, naturalHeight: 400, gridSize: '2x2', label: 'Wood Wall Corner F 2x2' },
  { id: 'wall-wood-b-corner-g-2x2', path: '/textures/walls/wood-ashen-b/Wall_Wood_Ashen_B_Corner_G_2x2.png', type: 'wall', category: 'wood-ashen', wallPiece: 'corner', naturalWidth: 400, naturalHeight: 400, gridSize: '2x2', label: 'Wood Wall Corner G 2x2' },
  { id: 'wall-wood-b-corner-h-3x3', path: '/textures/walls/wood-ashen-b/Wall_Wood_Ashen_B_Corner_H_3x3.png', type: 'wall', category: 'wood-ashen', wallPiece: 'corner', naturalWidth: 600, naturalHeight: 600, gridSize: '3x3', label: 'Wood Wall Corner H 3x3' },

  // Joints
  { id: 'wall-wood-b-joint-a-1x1', path: '/textures/walls/wood-ashen-b/Wall_Wood_Ashen_B_Joint_A_1x1.png', type: 'wall', category: 'wood-ashen', wallPiece: 'joint', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Wood Wall Joint A 1x1' },
  { id: 'wall-wood-b-joint-b-1x1', path: '/textures/walls/wood-ashen-b/Wall_Wood_Ashen_B_Joint_B_1x1.png', type: 'wall', category: 'wood-ashen', wallPiece: 'joint', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Wood Wall Joint B 1x1' },
  { id: 'wall-wood-b-joint-c-1x1', path: '/textures/walls/wood-ashen-b/Wall_Wood_Ashen_B_Joint_C_1x1.png', type: 'wall', category: 'wood-ashen', wallPiece: 'joint', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Wood Wall Joint C 1x1' },
  { id: 'wall-wood-b-joint-d-1x1', path: '/textures/walls/wood-ashen-b/Wall_Wood_Ashen_B_Joint_D_1x1.png', type: 'wall', category: 'wood-ashen', wallPiece: 'joint', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Wood Wall Joint D 1x1' },

  // Connectors
  { id: 'wall-wood-b-connector-a-1x1', path: '/textures/walls/wood-ashen-b/Wall_Wood_Ashen_B_Connector_A_1x1.png', type: 'wall', category: 'wood-ashen', wallPiece: 'connector', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Wood Wall Connector A 1x1' },
  { id: 'wall-wood-b-connector-b-1x1', path: '/textures/walls/wood-ashen-b/Wall_Wood_Ashen_B_Connector_B_1x1.png', type: 'wall', category: 'wood-ashen', wallPiece: 'connector', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Wood Wall Connector B 1x1' },

  // Ending
  { id: 'wall-wood-b-ending-a-1x1', path: '/textures/walls/wood-ashen-b/Wall_Wood_Ashen_B_Ending_A_1x1.png', type: 'wall', category: 'wood-ashen', wallPiece: 'ending', naturalWidth: 200, naturalHeight: 200, gridSize: '1x1', label: 'Wood Wall Ending A 1x1' },
];

// ─── Scatter ───────────────────────────────────────────────────────
// Decorative strips scattered along paths / terrain boundaries.

const SCATTER: TextureEntry[] = [
  { id: 'grass-path-scatter-01-a', path: '/textures/scatter/Grass_Path_Scatter_01_A.png', type: 'scatter', category: 'scatter', naturalWidth: 800, naturalHeight: 400, label: 'Grass Path Scatter 01 A', tags: ['outdoor', 'grass', 'path'] },
];

// ─── Combined Manifest ────────────────────────────────────────────

export const TEXTURE_MANIFEST: TextureEntry[] = [
  ...FLOORS,
  ...EDGES,
  ...OBJECTS,
  ...WALLS_STONE_SLATE_A,
  ...WALLS_WOOD_ASHEN_B,
  ...SCATTER,
];

// ─── Lookup Helpers ────────────────────────────────────────────────

const _byId = new Map<string, TextureEntry>();
for (const entry of TEXTURE_MANIFEST) {
  _byId.set(entry.id, entry);
}

export function getTextureEntry(id: string): TextureEntry | undefined {
  return _byId.get(id);
}

export function getTexturesByType(type: AssetType): TextureEntry[] {
  return TEXTURE_MANIFEST.filter((t) => t.type === type);
}

export function getTexturesByCategory(category: AssetCategory): TextureEntry[] {
  return TEXTURE_MANIFEST.filter((t) => t.category === category);
}

export function getWallSet(category: WallCategory): TextureEntry[] {
  return TEXTURE_MANIFEST.filter((t) => t.type === 'wall' && t.category === category);
}

export function getWallPieces(category: WallCategory, piece: WallPiece): TextureEntry[] {
  return TEXTURE_MANIFEST.filter((t) => t.type === 'wall' && t.category === category && t.wallPiece === piece);
}

/** Get the seamless tiling strip texture for a wall set (for continuous FillPattern stroke). */
export function getWallStripTexture(category: WallCategory): TextureEntry | undefined {
  const pieces = getWallSet(category);
  // Prefer 'path' piece (designed for seamless tiling), fallback to longest 'straight'
  return pieces.find(p => p.wallPiece === 'path')
    ?? pieces.filter(p => p.wallPiece === 'straight')
             .sort((a, b) => b.naturalWidth - a.naturalWidth)[0];
}

// ─── Wall Set Defaults ────────────────────────────────────────────
// Per-set wallWidth presets tuned so the visible stone/wood content
// (after transparent padding) looks ~0.5 grid cells at default.
// Stone textures have ~50% content → need wallWidth≈1.0 for 0.5 visible.
// Wood textures have ~25% content → need wallWidth≈2.0 for 0.5 visible.

export interface WallSetDefaults {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
}

export const WALL_SET_DEFAULTS: Record<WallCategory, WallSetDefaults> = {
  'stone-slate': { defaultWidth: 0.5, minWidth: 0.15, maxWidth: 1.5 },
  'wood-ashen':  { defaultWidth: 0.5, minWidth: 0.15, maxWidth: 1.5 },
};

export function getWallSetDefaults(category: WallCategory): WallSetDefaults {
  return WALL_SET_DEFAULTS[category];
}

/** Grid cell size in pixels (FA standard: 200px per cell at 200ppi) */
export const GRID_CELL_PX = 200;
