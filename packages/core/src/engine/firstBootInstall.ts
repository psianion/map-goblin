// src/engine/firstBootInstall.ts
//
// On boot, auto-installs every pack the bundled /packs/index.json lists.
// This ensures a zero-config first experience with no CDN dependency.

import pLimit from 'p-limit';
import { compareSemver } from './assetPackManager';
import type { AssetPackManager } from './assetPackManager';
import type { PackManifest } from './assetPackManager';

const FETCH_CONCURRENCY = 8;

interface BundledIndex {
  packs?: Record<string, { manifest?: string }>;
}

/**
 * Read the bundled pack index — manifest filenames are content-hashed and
 * change on every publish, so they can't be hardcoded.
 *
 * Mirrors AssetPackManager.resolveManifestPath, but reads the LOCAL bundled copy
 * (`/packs/index.json`, same origin) rather than the CDN — this is the baseline
 * shipped in the image, not a remote pack install.
 *
 * Throws on any failure; callers wrap the whole bundled-install path in
 * try/catch and soft-fail.
 */
async function fetchBundledIndex(): Promise<BundledIndex> {
  const res = await fetch('/packs/index.json');
  if (!res.ok) throw new Error(`Bundled pack index not found (status ${res.status})`);
  return (await res.json()) as BundledIndex;
}

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
 * Install or refresh one bundled pack. Returns true if an install happened.
 */
async function ensureOneBundledPack(
  packManager: AssetPackManager,
  packId: string,
  manifestPath: string,
): Promise<boolean> {
  const res = await fetch(`/packs/${manifestPath}`);
  if (!res.ok) {
    console.warn(`[firstBootInstall] Bundled pack manifest not found at /packs/${manifestPath}`);
    return false;
  }

  const manifest = (await res.json()) as PackManifest;

  // If the manifest has no entries yet (placeholder — gg-demo before its first
  // art drop), skip install.
  if (Object.keys(manifest.entries).length === 0) {
    console.info(`[firstBootInstall] Bundled pack "${packId}" has no entries — skipping (placeholder)`);
    return false;
  }

  const current = packManager.getInstalledPacks().find((p) => p.packId === packId);
  const bundledEntryCount = Object.keys(manifest.entries).length;
  const installedManifest = packManager
    .getPackManifests()
    .find((p) => p.packId === packId)?.manifest;

  if (current) {
    const versionDelta = compareSemver(manifest.version, current.version);

    // The installed copy is ahead of the build — it came from the CDN. Leave it alone.
    //
    // This check is the whole reason the function is not a plain content comparison.
    // The bundled manifest is frozen at whatever shipped in the image, so once the same
    // pack is also published to a CDN the two disagree permanently, and a content-only
    // test reads "differs, therefore stale" in both directions: every reload uninstalled
    // the newer CDN copy and reinstalled the older bundled one. A pack update could never
    // survive a refresh.
    if (versionDelta < 0) return false;

    // Same version, byte-for-byte identical — nothing to do. Compared on the full content
    // key, not entry count, so an art swap that forgot a version bump still ships.
    //
    // With no cached manifest the copy predates this check and falls through to a
    // reinstall — the cheap way to get it onto a known content key.
    if (versionDelta === 0 && installedManifest && contentKey(installedManifest) === contentKey(manifest)) {
      return false;
    }

    // Outdated copy: drop it so the reinstall below starts clean — no stale
    // textures lingering under keys the new manifest no longer declares.
    console.info(
      `[firstBootInstall] Bundled pack "${packId}" outdated (installed ${current.version}/${current.entryCount} entries, bundled ${manifest.version}/${bundledEntryCount}${installedManifest ? '' : ', no cached manifest'}) — reinstalling`,
    );
    await packManager.uninstallPack(packId);
  }

  // Download all atlas + file assets from the bundled path
  const allFiles = [...Object.keys(manifest.atlases), ...Object.keys(manifest.files)];
  const blobs = new Map<string, Uint8Array>();

  const limit = pLimit(FETCH_CONCURRENCY);
  try {
    await Promise.all(
      allFiles.map((file) =>
        limit(async () => {
          const fileRes = await fetch(`/packs/${packId}/${file}`);
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
  const packSize = [...blobs.values()].reduce((s, b) => s + b.length, 0);

  try {
    await packManager.registerPack(packId, manifest, blobs, true);
  } catch {
    console.warn(`[firstBootInstall] registerPack failed for bundled pack "${packId}" — app will work without it`);
    return false;
  }

  console.info(
    `[firstBootInstall] Installed bundled pack "${packId}" (${bundledEntryCount} entries, ${Math.round(packSize / 1024)}KB)`,
  );
  return true;
}

/**
 * Check every bundled pack against the installed state and install/refresh as
 * needed. Called after rehydrate() during boot.
 *
 * @returns true if any bundled pack was installed
 */
export async function ensureBundledPack(packManager: AssetPackManager): Promise<boolean> {
  const index = await fetchBundledIndex();

  // Retire bundled packs this build no longer ships (e.g. dungeon-classic
  // after the gg-demo/gg-forge split) — otherwise a returning browser keeps
  // serving retired art out of IndexedDB forever and its entries pollute the
  // catalog. CDN-installed packs (bundled: false) are never touched.
  const indexIds = new Set(Object.keys(index.packs ?? {}));
  try {
    for (const packId of await packManager.bundledInstalledIds()) {
      if (indexIds.has(packId)) continue;
      console.info(`[firstBootInstall] Bundled pack "${packId}" no longer ships — uninstalling`);
      await packManager.uninstallPack(packId);
    }
  } catch (err) {
    console.warn('[firstBootInstall] Retired-pack cleanup failed:', err);
  }

  let installedAny = false;
  for (const [packId, entry] of Object.entries(index.packs ?? {})) {
    if (!entry.manifest) continue;
    try {
      if (await ensureOneBundledPack(packManager, packId, entry.manifest)) installedAny = true;
    } catch (err) {
      // One broken pack must not cost the others.
      console.warn(`[firstBootInstall] Bundled pack "${packId}" install failed:`, err);
    }
  }
  return installedAny;
}
