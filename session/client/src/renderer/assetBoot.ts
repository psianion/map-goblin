/**
 * The one place the table reaches the asset tiers in @dnd/core: boot, the open map's sets
 * and the DM's full library. Everything else at the table imports from here.
 */
export type { AssetPackManager, AssetProgress } from '@dnd/core/src/engine/assetPackManager';
export { getAssetPackManager } from '@dnd/core/src/engine/assetPackInstance';
export { bootAssets } from '@dnd/core/src/engine/boot';
export { ensureMapAssets, installLibrary } from '@dnd/core/src/engine/firstBootInstall';
export { collectMapTextureIds } from '@dnd/core/src/engine/mapTextureRefs';
