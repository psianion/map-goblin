// src/engine/manifestBridge.ts
//
// Converts installed pack manifests into AssetManifest categories,
// merging with the legacy hardcoded manifest from assetManifest.ts.

import type { AssetManifest, AssetCategory, AssetEntry } from '../store/types';
import type { PackManifest } from './assetPackManager';
import { getManifest as getLegacyManifest } from './assetManifest';

/** Asset types the builder currently supports rendering */
const SUPPORTED_TYPES = new Set(['object', 'floor', 'wall', 'edge', 'scatter', 'pattern', 'path', 'portal', 'light-mask']);

function parseGridSize(gs: string): { w: number; h: number } {
  const [wStr, hStr] = gs.split('x');
  return { w: parseInt(wStr, 10) || 1, h: parseInt(hStr, 10) || 1 };
}

/**
 * Convert a single pack's manifest entries into AssetCategory[].
 * Groups entries by type (floor, wall, object, etc.).
 */
export function packToCategories(packId: string, manifest: PackManifest): AssetCategory[] {
  const groups = new Map<string, AssetEntry[]>();

  for (const [localId, entry] of Object.entries(manifest.entries)) {
    if (!SUPPORTED_TYPES.has(entry.type)) continue;

    const categoryId = `${packId}:${entry.type}`;
    if (!groups.has(categoryId)) {
      groups.set(categoryId, []);
    }

    const { w, h } = parseGridSize(entry.gridSize);
    groups.get(categoryId)!.push({
      id: `${packId}:${localId}`,
      name: localId.replace(/_/g, ' '),
      url: '', // Pack textures resolve via AssetPackManager, not URL fetch
      thumbnailUrl: '', // Will be resolved from atlas frame at render time
      cellWidth: w,
      cellHeight: h,
    });
  }

  const categories: AssetCategory[] = [];
  for (const [categoryId, assets] of groups) {
    const type = categoryId.split(':')[1]!;
    const label = `${manifest.name} — ${type.charAt(0).toUpperCase() + type.slice(1)}`;
    categories.push({ id: categoryId, label, assets });
  }

  return categories;
}

/**
 * Build a merged manifest from installed packs + legacy hardcoded manifest.
 * Pack entries with the same ID override legacy entries.
 */
export function buildMergedManifest(
  packManifests: Array<{ packId: string; manifest: PackManifest }>,
): AssetManifest {
  const legacy = getLegacyManifest();

  // Collect all pack entry IDs for deduplication
  const packEntryIds = new Set<string>();
  const packCategories: AssetCategory[] = [];

  for (const { packId, manifest } of packManifests) {
    const categories = packToCategories(packId, manifest);
    for (const cat of categories) {
      for (const asset of cat.assets) {
        packEntryIds.add(asset.id);
      }
      packCategories.push(cat);
    }
  }

  // Filter legacy categories: remove any entries that packs override
  const filteredLegacy = legacy.categories.map((cat) => ({
    ...cat,
    assets: cat.assets.filter((a) => !packEntryIds.has(a.id)),
  })).filter((cat) => cat.assets.length > 0);

  return {
    categories: [...packCategories, ...filteredLegacy],
  };
}
