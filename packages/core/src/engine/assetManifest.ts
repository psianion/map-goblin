// src/engine/assetManifest.ts
import { getTexturesByType, type AssetType } from '../assets/textureManifest'
import type { AssetManifest, AssetCategory as ManifestCategory, AssetEntry } from '../store/types'

/** Map texture manifest object categories → asset browser categories */
const OBJECT_CATEGORY_MAP: Record<string, { id: string; label: string }> = {
  tree: { id: 'nature', label: 'Nature' },
  foliage: { id: 'nature', label: 'Nature' },
  rock: { id: 'nature', label: 'Nature' },
  puddle: { id: 'nature', label: 'Nature' },
  log: { id: 'nature', label: 'Nature' },
  campfire: { id: 'miscellaneous', label: 'Miscellaneous' },
  lamp: { id: 'miscellaneous', label: 'Miscellaneous' },
}

/** All supported asset type IDs for the manifest system */
export const ASSET_TYPE_IDS = [
  'floor',
  'wall',
  'edge',
  'object',
  'scatter',
  'pattern',
  // TODO: consumer not yet implemented (Phase 7)
  'portal',
  'light-mask',
  'path',
] as const

export type AssetTypeId = (typeof ASSET_TYPE_IDS)[number]

export const CATEGORY_IDS = [
  'floors',
  'walls',
  'edges',
  'nature',
  'miscellaneous',
  'scatter',
] as const

export type CategoryId = (typeof CATEGORY_IDS)[number]

/** Map texture manifest floor categories → browser categories */
const FLOOR_CATEGORY_MAP: Record<string, { id: string; label: string }> = {
  grass: { id: 'floors', label: 'Floors' },
  dirt: { id: 'floors', label: 'Floors' },
  stone: { id: 'floors', label: 'Floors' },
  cave: { id: 'floors', label: 'Floors' },
  gravel: { id: 'floors', label: 'Floors' },
  wood: { id: 'floors', label: 'Floors' },
  water: { id: 'floors', label: 'Floors' },
}

/** Map texture manifest edge categories → browser categories */
const EDGE_CATEGORY_MAP: Record<string, { id: string; label: string }> = {
  bank: { id: 'edges', label: 'Edges' },
  cliff: { id: 'edges', label: 'Edges' },
  'cliff-top': { id: 'edges', label: 'Edges' },
  'under-cliff': { id: 'edges', label: 'Edges' },
  burrow: { id: 'edges', label: 'Edges' },
  'floor-break': { id: 'edges', label: 'Edges' },
}

function parseGridSize(gs?: string): { w: number; h: number } {
  if (!gs) return { w: 1, h: 1 }
  const [wStr, hStr] = gs.split('x')
  return { w: parseInt(wStr, 10) || 1, h: parseInt(hStr, 10) || 1 }
}

/**
 * Returns the typed asset manifest, auto-generated from textureManifest
 * entries across all supported asset types.
 */
export function getManifest(): AssetManifest {
  // Group by browser category
  const groups = new Map<string, AssetEntry[]>()
  for (const catId of CATEGORY_IDS) {
    groups.set(catId, [])
  }

  // Helper to add entries from a type with a category map
  function addEntries(
    type: AssetType,
    categoryMap: Record<string, { id: string; label: string }>,
    fallbackId: string,
  ) {
    const entries = getTexturesByType(type)
    for (const entry of entries) {
      const mapped = categoryMap[entry.category] ?? { id: fallbackId, label: fallbackId }
      const { w, h } = parseGridSize(entry.gridSize)
      const asset: AssetEntry = {
        id: entry.id,
        name: entry.label,
        url: entry.path,
        thumbnailUrl: entry.path,
        cellWidth: w,
        cellHeight: h,
      }
      groups.get(mapped.id)?.push(asset)
    }
  }

  // Floors
  addEntries('floor', FLOOR_CATEGORY_MAP, 'floors')

  // Walls
  const wallEntries = getTexturesByType('wall')
  for (const entry of wallEntries) {
    const { w, h } = parseGridSize(entry.gridSize)
    groups.get('walls')?.push({
      id: entry.id,
      name: entry.label,
      url: entry.path,
      thumbnailUrl: entry.path,
      cellWidth: w,
      cellHeight: h,
    })
  }

  // Edges
  addEntries('edge', EDGE_CATEGORY_MAP, 'edges')

  // Objects
  addEntries('object', OBJECT_CATEGORY_MAP, 'miscellaneous')

  // Scatter
  const scatterEntries = getTexturesByType('scatter')
  for (const entry of scatterEntries) {
    const { w, h } = parseGridSize(entry.gridSize)
    groups.get('scatter')?.push({
      id: entry.id,
      name: entry.label,
      url: entry.path,
      thumbnailUrl: entry.path,
      cellWidth: w,
      cellHeight: h,
    })
  }

  const CATEGORY_LABELS: Record<string, string> = {
    floors: 'Floors',
    walls: 'Walls',
    edges: 'Edges',
    nature: 'Nature',
    miscellaneous: 'Miscellaneous',
    scatter: 'Scatter',
  }

  const categories: ManifestCategory[] = CATEGORY_IDS.map((id) => ({
    id,
    label: CATEGORY_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1),
    assets: groups.get(id) ?? [],
  }))

  return { categories }
}

/**
 * Register all categories as PIXI.Assets bundles.
 * Call once during engine initialization (PixiRenderEngine.init()).
 */
export async function registerManifestBundles(): Promise<void> {
  const { Assets } = await import('pixi.js')
  const manifest = getManifest()

  for (const category of manifest.categories) {
    const bundleAssets = category.assets.map((asset) => ({
      alias: asset.id,
      src: asset.url,
    }))

    if (bundleAssets.length > 0) {
      Assets.addBundle(category.id, bundleAssets)
    }
  }
}
