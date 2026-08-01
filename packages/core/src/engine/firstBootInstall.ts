// src/engine/firstBootInstall.ts
//
// On first visit (no packs in IndexedDB), auto-installs the bundled
// dungeon-classic pack from public/packs/. This ensures a zero-config
// first experience with no CDN dependency.

import pLimit from 'p-limit';
import type { AssetPackManager } from './assetPackManager';
import type { PackManifest } from './assetPackManager';

const BUNDLED_PACK_ID = 'dungeon-classic';
const FETCH_CONCURRENCY = 8;
const BUNDLED_PACK_PATH = '/packs/dungeon-classic/pack-4a9bdbee.json';

/**
 * A manifest's content, as one comparable string: its version, every entry id, and
 * every atlas/file checksum.
 *
 * Version-and-entry-count was the old staleness test and it is not enough. Swapping
 * the art behind an existing entry — same id, same file name, new bytes — moves
 * neither number, so every browser that had already installed the pack kept serving
 * the old blob out of IndexedDB forever, and only a profile wipe fixed it. The file
 * checksums are already in the manifest and they move whenever the bytes do, so
 * folding them in makes any future art swap invalidate on its own.
 *
 * Sorted, because object key order is not a contract.
 */
function contentKey(manifest: PackManifest): string {
  const entries = Object.keys(manifest.entries).sort().join(',');
  const files = [...Object.entries(manifest.atlases), ...Object.entries(manifest.files)]
    .map(([name, ref]) => `${name}@${ref.checksum}`)
    .sort()
    .join(',');
  return `${manifest.version}|${entries}|${files}`;
}

/**
 * Check if the bundled pack needs to be installed and install it if so.
 * Called after rehydrate() during boot.
 *
 * @returns true if the bundled pack was installed, false if already present
 */
export async function ensureBundledPack(packManager: AssetPackManager): Promise<boolean> {
  const installed = packManager.getInstalledPacks();
  const current = installed.find((p) => p.packId === BUNDLED_PACK_ID);

  // Fetch the bundled manifest even when a copy is already installed: the
  // manifest lives at a fixed path, so updated content arrives under the same
  // URL and an installed-check alone would pin every returning browser to its
  // first-ever copy forever. The fetch is a small local file — cheap at boot.
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

  // Installed and byte-for-byte the bundled content — nothing to do. Compared on
  // the full content key, not version and entry count, so an art swap that forgot
  // a version bump still ships. The installed manifest is the one already in
  // IndexedDB, put back into the cache by rehydrate; hashing that is why no extra
  // field has to be persisted alongside the install.
  const bundledEntryCount = Object.keys(manifest.entries).length;
  const installedManifest = packManager
    .getPackManifests()
    .find((p) => p.packId === BUNDLED_PACK_ID)?.manifest;
  if (current && installedManifest && contentKey(installedManifest) === contentKey(manifest)) {
    return false;
  }

  // Outdated copy: drop it so the reinstall below starts clean — no stale
  // textures lingering under keys the new manifest no longer declares.
  if (current) {
    // A copy with no cached manifest predates this check; reinstalling once is
    // the cheap way to get it onto a known content key.
    console.info(
      `[firstBootInstall] Bundled pack outdated (installed ${current.version}/${current.entryCount} entries, bundled ${manifest.version}/${bundledEntryCount}${installedManifest ? '' : ', no cached manifest'}) — reinstalling`,
    );
    await packManager.uninstallPack(BUNDLED_PACK_ID);
  }

  // Download all atlas + file assets from the bundled path
  const allFiles = [...Object.keys(manifest.atlases), ...Object.keys(manifest.files)];
  const blobs = new Map<string, Uint8Array>();

  const limit = pLimit(FETCH_CONCURRENCY);
  try {
    await Promise.all(
      allFiles.map((file) =>
        limit(async () => {
          const fileRes = await fetch(`/packs/${BUNDLED_PACK_ID}/${file}`);
          if (!fileRes.ok) throw new Error(file);
          blobs.set(file, new Uint8Array(await fileRes.arrayBuffer()));
        }),
      ),
    );
  } catch (err) {
    // First failure aborts the install, same as the old serial loop.
    limit.clearQueue();
    console.warn(`[firstBootInstall] Failed to fetch bundled file: ${(err as Error).message}`);
    return false;
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
