// src/engine/firstBootInstall.ts
//
// The bundled packs, in three tiers. Tier 1 (`installBundledIndex`): the pack index and
// every manifest, no file. Tier 2 (`ensureMapAssets`): the asset sets one map uses.
// Tier 3 (`installLibrary`): every other set, in the background.

import { compareSemver } from './assetPackManager';
import type { AssetPackManager, AssetProgress, PackManifest } from './assetPackManager';

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
 * Register or refresh one bundled pack's manifest. Downloads no pack file. Returns true
 * if the pack was (re)registered.
 */
async function ensureOneBundledManifest(
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
    if (versionDelta === 0 && installedManifest && contentKey(installedManifest) === contentKey(manifest)) {
      return false;
    }

    // Outdated copy: drop it and every file it stored, so nothing stale is kept.
    // Its sets download again when a map needs them.
    console.info(
      `[firstBootInstall] Bundled pack "${packId}" outdated (installed ${current.version}, bundled ${manifest.version}${installedManifest ? '' : ', no cached manifest'}) — re-registering`,
    );
    await packManager.uninstallPack(packId);
  }

  await packManager.registerManifest(packId, manifest);
  return true;
}

/**
 * Tier 1: the bundled index and every manifest it lists. New packs are registered with no
 * set installed; a stale pack drops its files; packs this build no longer ships are
 * removed. Downloads no pack file. Bumps catalogVersion. Throws when the index cannot be
 * read; one broken pack never costs the others.
 */
export async function installBundledIndex(packManager: AssetPackManager): Promise<void> {
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

  await Promise.all(
    Object.entries(index.packs ?? {}).map(async ([packId, entry]) => {
      if (!entry.manifest) return;
      try {
        await ensureOneBundledManifest(packManager, packId, entry.manifest);
      } catch (err) {
        console.warn(`[firstBootInstall] Bundled pack "${packId}" install failed:`, err);
      }
    }),
  );
  packManager.catalogVersion++;
}

/**
 * Tier 2: only the files the texture ids `ids` draw from (see collectMapTextureIds): a
 * loose entry's file, an atlas entry's json and image. Not whole sets. Fetched per pack
 * with progress in phase `map`. Never throws: a file that fails is logged and the map
 * draws with fallbacks.
 */
export async function ensureMapAssets(
  packManager: AssetPackManager,
  ids: string[],
  onProgress?: (p: AssetProgress) => void,
): Promise<void> {
  let byPack: Map<string, string[]>;
  try {
    byPack = packManager.filesForTextureIds(ids);
  } catch (err) {
    console.warn('[firstBootInstall] ensureMapAssets: could not resolve the map\'s files', err);
    return;
  }

  let files = 0;
  let bytes = 0;
  for (const [packId, names] of byPack) {
    const missing = packManager.missingFileTotals(packId, names);
    files += missing.files;
    bytes += missing.bytes;
  }

  const job = files > 0 ? packManager.beginProgress('map') : null;
  job?.addTotal(files, bytes);
  if (job) onProgress?.(job.progress);
  const sink = job
    ? {
        advance(f: number, b: number) {
          job.advance(f, b);
          onProgress?.(job.progress);
        },
      }
    : undefined;

  try {
    await Promise.all(
      [...byPack].map(([packId, names]) =>
        packManager.ensureFiles(packId, names, sink).catch((err) => {
          console.warn(`[firstBootInstall] ensureMapAssets: files of pack "${packId}" failed`, err);
        }),
      ),
    );
  } finally {
    job?.end();
  }
}

/**
 * Tier 3: every set of the packs in `order` not stored yet, pack by pack, smallest set
 * first inside a pack; files a map already stored are not fetched again. Each set is committed as it lands, so a reload resumes where this
 * stopped. `signal` pauses it between sets. Never throws.
 */
export async function installLibrary(
  packManager: AssetPackManager,
  order: string[],
  onProgress?: (p: AssetProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const plan = order.flatMap((packId) =>
    packManager
      .getAssetSetStatus(packId)
      .filter((s) => s.missingFiles > 0)
      .map((s) => ({ packId, ...s })),
  );
  if (plan.length === 0) return;

  const job = packManager.beginProgress('library');
  job.addTotal(
    plan.reduce((s, p) => s + p.missingFiles, 0),
    plan.reduce((s, p) => s + p.missingBytes, 0),
  );
  onProgress?.(job.progress);
  const sink = {
    advance(f: number, b: number) {
      job.advance(f, b);
      onProgress?.(job.progress);
    },
  };

  try {
    for (const item of plan) {
      if (signal?.aborted) break;
      job.setPack(item.packId);
      try {
        await packManager.ensureAssetSets(item.packId, [item.set], sink);
      } catch (err) {
        console.warn(`[firstBootInstall] installLibrary: set "${item.set}" of "${item.packId}" failed`, err);
      }
    }
  } finally {
    job.end();
  }
}
