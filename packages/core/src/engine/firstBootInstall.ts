// src/engine/firstBootInstall.ts
//
// On first visit (no packs in IndexedDB), auto-installs the bundled
// dungeon-classic pack from public/packs/. This ensures a zero-config
// first experience with no CDN dependency.

import type { AssetPackManager } from './assetPackManager';
import type { PackManifest } from './assetPackManager';

const BUNDLED_PACK_ID = 'dungeon-classic';
const BUNDLED_PACK_PATH = '/packs/dungeon-classic/pack-4a9bdbee.json';

/**
 * Check if the bundled pack needs to be installed and install it if so.
 * Called after rehydrate() during boot.
 *
 * @returns true if the bundled pack was installed, false if already present
 */
export async function ensureBundledPack(packManager: AssetPackManager): Promise<boolean> {
  // Skip if dungeon-classic is already installed
  const installed = packManager.getInstalledPacks();
  if (installed.some((p) => p.packId === BUNDLED_PACK_ID)) {
    return false;
  }

  // Fetch the bundled manifest from public/
  const res = await fetch(BUNDLED_PACK_PATH);
  if (!res.ok) {
    console.warn(`[firstBootInstall] Bundled pack manifest not found at ${BUNDLED_PACK_PATH}`);
    return false;
  }

  const manifest = (await res.json()) as PackManifest & { bundled?: boolean };

  // If the manifest has no entries yet (placeholder), skip install
  if (Object.keys(manifest.entries).length === 0) {
    console.info('[firstBootInstall] Bundled pack manifest has no entries — skipping (placeholder)');
    return false;
  }

  // Download all atlas + file assets from the bundled path
  const allFiles = [...Object.keys(manifest.atlases), ...Object.keys(manifest.files)];
  const blobs = new Map<string, Uint8Array>();

  for (const file of allFiles) {
    const fileRes = await fetch(`/packs/${BUNDLED_PACK_ID}/${file}`);
    if (!fileRes.ok) {
      console.warn(`[firstBootInstall] Failed to fetch bundled file: ${file}`);
      return false;
    }
    blobs.set(file, new Uint8Array(await fileRes.arrayBuffer()));
  }

  // Register the bundled pack directly using the already-downloaded data.
  // We skip checksum verification for bundled — trusted local files.
  const entryCount = Object.keys(manifest.entries).length;
  const packSize = [...blobs.values()].reduce((s, b) => s + b.length, 0);

  try {
    await packManager.registerPack(BUNDLED_PACK_ID, manifest, blobs, true);
  } catch {
    console.warn('[firstBootInstall] registerPack failed for bundled pack — app will work without it');
    return false;
  }

  console.info(
    `[firstBootInstall] Installed bundled pack "${BUNDLED_PACK_ID}" (${entryCount} entries, ${Math.round(packSize / 1024)}KB)`,
  );
  return true;
}
