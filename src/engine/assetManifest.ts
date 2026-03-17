// src/engine/assetManifest.ts
import { getTexturesByType } from '@/assets/textureManifest'
import type { AssetManifest, AssetCategory as ManifestCategory, AssetEntry } from '@/store/types'

/** Map texture manifest object categories → asset browser categories */
const CATEGORY_MAP: Record<string, { id: string; label: string }> = {
  tree: { id: 'nature', label: 'Nature' },
  foliage: { id: 'nature', label: 'Nature' },
  rock: { id: 'nature', label: 'Nature' },
  puddle: { id: 'nature', label: 'Nature' },
  log: { id: 'nature', label: 'Nature' },
  campfire: { id: 'miscellaneous', label: 'Miscellaneous' },
  lamp: { id: 'miscellaneous', label: 'Miscellaneous' },
}

export const CATEGORY_IDS = [
  'nature',
  'miscellaneous',
] as const

export type CategoryId = (typeof CATEGORY_IDS)[number]

function parseGridSize(gs?: string): { w: number; h: number } {
  if (!gs) return { w: 1, h: 1 }
  const [wStr, hStr] = gs.split('x')
  return { w: parseInt(wStr, 10) || 1, h: parseInt(hStr, 10) || 1 }
}

/**
 * Returns the typed asset manifest, auto-generated from textureManifest
 * object-type entries. No manifest.json needed.
 */
export function getManifest(): AssetManifest {
  const objects = getTexturesByType('object')

  // Group by browser category
  const groups = new Map<string, AssetEntry[]>()
  for (const catId of CATEGORY_IDS) {
    groups.set(catId, [])
  }

  for (const entry of objects) {
    const mapped = CATEGORY_MAP[entry.category] ?? { id: 'miscellaneous', label: 'Miscellaneous' }
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

  const categories: ManifestCategory[] = CATEGORY_IDS.map((id) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
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
