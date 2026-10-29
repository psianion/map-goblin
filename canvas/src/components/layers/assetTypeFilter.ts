import type { AssetCategory, AssetEntry, ToolType } from '@/store/types';

export type AssetTypeFilter = 'all' | 'floor' | 'wall' | 'object' | 'scatter' | 'edge' | 'path';

const FILTER_TYPES: readonly AssetTypeFilter[] = ['all', 'floor', 'wall', 'object', 'scatter', 'edge', 'path'];

/**
 * The type tab the browser opens on for the tool in hand. The props brush opens on
 * Object: no pack ships a `scatter` type, so a Scatter tab would always be empty.
 */
export function toolToTypeFilter(tool: ToolType): AssetTypeFilter {
  switch (tool) {
    case 'rectangle':
    case 'polygon':
    case 'regularPolygon':
      return 'floor';
    case 'path':
      return 'path';
    case 'wall':
    case 'door':
      return 'wall';
    case 'scatterBrush':
      return 'object';
    default:
      return 'all';
  }
}

/** Map category IDs to asset type for filtering */
export function categoryToType(categoryId: string): AssetTypeFilter | null {
  // Pack categories use "packId:type" format
  if (categoryId.includes(':')) {
    const type = categoryId.split(':')[1] as AssetTypeFilter;
    if (FILTER_TYPES.includes(type)) return type;
    return null;
  }
  // Legacy categories
  if (categoryId === 'floors') return 'floor';
  if (categoryId === 'walls') return 'wall';
  if (categoryId === 'edges') return 'edge';
  if (categoryId === 'nature' || categoryId === 'miscellaneous') return 'object';
  if (categoryId === 'scatter') return 'scatter';
  return null;
}

/**
 * The recently used assets the Recent tab lists, most recent first: on a type tab only
 * those whose category is that type, on "all" every one. Ids no category holds are skipped.
 */
export function recentAssetsOfType(
  recentlyUsed: readonly string[],
  categories: readonly AssetCategory[],
  typeFilter: AssetTypeFilter,
): AssetEntry[] {
  const byId = new Map<string, AssetEntry>();
  for (const c of categories) {
    if (typeFilter !== 'all' && categoryToType(c.id) !== typeFilter) continue;
    for (const a of c.assets) if (!byId.has(a.id)) byId.set(a.id, a);
  }
  return recentlyUsed.map((id) => byId.get(id)).filter((a): a is AssetEntry => a !== undefined);
}
