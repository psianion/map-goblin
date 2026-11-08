// src/engine/boot.ts
//
// One asset boot per page: the stored packs' metadata, then the bundled index and
// manifests (tier 1). Reads no pack file and decodes nothing. Both apps and every remount
// share the one run.

import type { AssetPackManager } from './assetPackManager';
import { installBundledIndex } from './firstBootInstall';

let booting: Promise<void> | null = null;

/** Rehydrate pack metadata, then register the bundled index. Never rejects. */
export function bootAssets(packManager: AssetPackManager): Promise<void> {
  booting ??= (async () => {
    try {
      await packManager.rehydrate();
    } catch (err) {
      console.warn('[bootAssets] Rehydrating stored packs failed:', err);
    }
    try {
      await installBundledIndex(packManager);
    } catch (err) {
      console.warn('[bootAssets] Bundled pack index failed:', err);
    }
  })();
  return booting;
}

/** Forget the boot run — only for testing. */
export function resetBootAssets(): void {
  booting = null;
}
