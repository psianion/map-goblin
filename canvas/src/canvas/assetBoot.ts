/**
 * The one place the canvas reaches the asset tiers in @dnd/core: boot, the open map's sets,
 * the background library, and which sets a pack holds. Everything else imports from here.
 */
import type { AssetPackManager } from '@dnd/core/src/engine/assetPackManager';
import { getAssetPackManager } from '@/engine/assetPackInstance';

export type { AssetPackManager, AssetProgress } from '@dnd/core/src/engine/assetPackManager';
export type { MapTextureSource } from '@dnd/core/src/engine/mapTextureRefs';
export { bootAssets } from '@dnd/core/src/engine/boot';
export { ensureMapAssets, installLibrary } from '@dnd/core/src/engine/firstBootInstall';
export { collectMapTextureIds } from '@dnd/core/src/engine/mapTextureRefs';
export { getAssetPackManager };

/** A pack's sets: all its manifest names, and the ones whose files are stored. */
export async function packSets(pm: AssetPackManager, packId: string): Promise<{ all: string[]; installed: string[] }> {
  const status = pm.getAssetSetStatus(packId);
  const all = status.map((s) => s.set).sort();
  return { all, installed: all.filter((set) => status.find((s) => s.set === set)?.installed) };
}
