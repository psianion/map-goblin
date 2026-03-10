// src/engine/assetManifest.ts
import rawManifest from '../assets/manifest.json'
import type { AssetManifest } from '@/store/types'

export const CATEGORY_IDS = [
  'furniture',
  'structures',
  'nature',
  'doors',
  'miscellaneous',
] as const

export type CategoryId = (typeof CATEGORY_IDS)[number]

/**
 * Returns the typed asset manifest.
 * Safe to call at module load time — no async required.
 */
export function getManifest(): AssetManifest {
  return rawManifest as AssetManifest
}

/**
 * Register all categories as PIXI.Assets bundles.
 * Call once during engine initialization (PixiRenderEngine.init()).
 * Each bundle is empty until real sprites are added to manifest.json.
 * Lazy-load individual categories via PIXI.Assets.loadBundle(categoryId).
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
