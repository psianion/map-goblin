// src/engine/legacyAssetMapping.ts
// Maps legacy texture IDs from existing save files to new {packId}:{localId} format.
// Legacy IDs are the flat string IDs from textureManifest.ts (e.g. 'stone-slate', 'grass-a-01').
// New IDs use the pack-scoped format 'dungeon-classic:stone-slate_1x1_floor_A'.

/**
 * Built-in mapping table from legacy texture IDs to new pack entry IDs.
 * Generated from the existing textureManifest categories.
 *
 * Convention: legacy floor textures map to `dungeon-classic:{id}_1x1_floor_A`
 * Convention: legacy wall textures map to `dungeon-classic:{id}_wall_A`
 * Convention: legacy object textures map to `dungeon-classic:{id}_object_A`
 * Convention: legacy edge textures map to `dungeon-classic:{id}_edge_A`
 */
const LEGACY_MAP: Record<string, string> = {
  // Floor textures
  'grass-a-01': 'dungeon-classic:grass-a-01_1x1_floor_A',
  'grass-a-09': 'dungeon-classic:grass-a-09_1x1_floor_A',
  'dirt-b-04': 'dungeon-classic:dirt-b-04_1x1_floor_A',
  'dirt-c-02': 'dungeon-classic:dirt-c-02_1x1_floor_A',
  'cracked-dirt-a-01': 'dungeon-classic:cracked-dirt-a-01_1x1_floor_A',
  'grassy-dirt-a-02': 'dungeon-classic:grassy-dirt-a-02_1x1_floor_A',
  'cobblestone-a-01': 'dungeon-classic:cobblestone-a-01_1x1_floor_A',
  'large-flagstone-a-01': 'dungeon-classic:large-flagstone-a-01_1x1_floor_A',
  'rock-tiles-b-01': 'dungeon-classic:rock-tiles-b-01_1x1_floor_A',
  'rectangular-tiles-a-01': 'dungeon-classic:rectangular-tiles-a-01_1x1_floor_A',
  'smooth-stone-floor-a-10': 'dungeon-classic:smooth-stone-floor-a-10_1x1_floor_A',
  'cave-floor-06-a': 'dungeon-classic:cave-floor-06-a_1x1_floor_A',
  'rock-ground-c-06': 'dungeon-classic:rock-ground-c-06_1x1_floor_A',
  'gravel-06-c': 'dungeon-classic:gravel-06-c_1x1_floor_A',
  'gravel-06-j': 'dungeon-classic:gravel-06-j_1x1_floor_A',

  // Wall textures
  'stone-slate': 'dungeon-classic:stone-slate_1x1_floor_A',
  'wood-ashen': 'dungeon-classic:wood-ashen_1x1_floor_A',
}

/**
 * Resolve a texture ID that may be in legacy or new format.
 *
 * - New-format IDs (containing ':') pass through unchanged.
 * - Legacy IDs are looked up in the built-in mapping table.
 * - Unknown legacy IDs return null.
 */
export function resolveLegacyId(textureId: string): string | null {
  // New-format IDs pass through unchanged
  if (textureId.includes(':')) {
    return textureId
  }

  // Look up in built-in mapping table
  return LEGACY_MAP[textureId] ?? null
}

/**
 * Build a mapping table from an existing textureManifest's entries.
 * Useful for dynamically extending the built-in table when the manifest
 * is available at runtime.
 */
export function buildMappingFromManifest(
  entries: Array<{ id: string; type: string }>,
  packId: string = 'dungeon-classic',
): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const entry of entries) {
    const suffix =
      entry.type === 'floor'
        ? '_1x1_floor_A'
        : entry.type === 'wall'
          ? '_wall_A'
          : entry.type === 'edge'
            ? '_edge_A'
            : '_object_A'
    mapping[entry.id] = `${packId}:${entry.id}${suffix}`
  }
  return mapping
}
