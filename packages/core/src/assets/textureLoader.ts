import { Assets, Rectangle, Texture } from 'pixi.js';
import { getTextureEntry, GRID_CELL_PX } from './textureManifest';
import { resolveLegacyId } from '../engine/legacyAssetMapping';
import { getAssetPackManager } from '../engine/assetPackInstance';
import { SPLAT_IMAGE_KEYS } from '../engine/terrain/terrainShared';

/**
 * Thin wrapper around PIXI.Assets with:
 * - Manifest-aware loading (looks up path via textureManifest)
 * - In-memory cache (Map<id, Texture>)
 * - Reference counting: retain(id) / release(id)
 * - Auto-unload when refCount hits 0
 */

const cache = new Map<string, Texture>();
const refCounts = new Map<string, number>();

// Content-trimmed views of pack atlas textures, keyed by pack entry ID.
// Pack atlases ship untrimmed cells (200px, trimmed:false); the renderer's
// wall math assumes content-height textures, so re-apply the legacy
// manifest's contentRect as a sub-frame into the atlas.
const trimmedPackCache = new Map<string, Texture>();

function applyContentRect(legacyId: string, packEntryId: string, packTex: Texture): Texture {
  const entry = getTextureEntry(legacyId);
  // Fallback texture is 1x1 — never sub-frame it
  if (!entry?.contentRect || packTex.width <= 1) return packTex;
  const cached = trimmedPackCache.get(packEntryId);
  if (cached) return cached;
  const { x, y, w, h } = entry.contentRect;
  const f = packTex.frame;
  const trimmed = new Texture({
    source: packTex.source,
    frame: new Rectangle(f.x + x, f.y + y, w, h),
  });
  trimmedPackCache.set(packEntryId, trimmed);
  return trimmed;
}

/** Load a texture by manifest ID. Returns Texture.EMPTY for unknown IDs. */
export async function load(textureId: string): Promise<Texture> {
  const cached = cache.get(textureId);
  if (cached) return cached;

  const entry = getTextureEntry(textureId);
  if (!entry) return Texture.EMPTY;

  // Prefer the installed pack's texture — the bundled /textures/ files are
  // not shipped with the app, so loading entry.path would just 404.
  const mapped = resolveLegacyId(textureId);
  if (mapped && mapped !== textureId) {
    const packTex = getAssetPackManager().getTextureOrNull(mapped);
    if (packTex) {
      const texture = applyContentRect(textureId, mapped, packTex);
      cache.set(textureId, texture);
      return texture;
    }
  }

  const baseTexture = await Assets.load<Texture>(entry.path);

  // Apply contentRect frame to exclude transparent padding
  let texture = baseTexture;
  if (entry.contentRect) {
    const { x, y, w, h } = entry.contentRect;
    texture = new Texture({
      source: baseTexture.source,
      frame: new Rectangle(x, y, w, h),
    });
  }

  cache.set(textureId, texture);
  return texture;
}

/** Get a cached texture synchronously. Returns undefined if not yet loaded. */
export function getSync(textureId: string): Texture | undefined {
  return cache.get(textureId);
}

/** Increment the reference count for a texture ID. */
export function retain(textureId: string): void {
  const current = refCounts.get(textureId) ?? 0;
  refCounts.set(textureId, current + 1);
}

/** Decrement the reference count. Unloads when it reaches 0. */
export function release(textureId: string): void {
  const current = refCounts.get(textureId) ?? 0;
  if (current <= 1) {
    refCounts.delete(textureId);
    const entry = getTextureEntry(textureId);
    if (entry) {
      Assets.unload(entry.path);
    }
    cache.delete(textureId);
    // unitCache is self-invalidating (see unitTexture) — nothing to clear here.
  } else {
    refCounts.set(textureId, current - 1);
  }
}

/** Get manifest entry for a texture ID (for grid dimensions, etc). */
export function getManifestEntry(textureId: string): ReturnType<typeof getTextureEntry> {
  return getTextureEntry(textureId);
}

/** Clear all cached textures and ref counts. */
export function reset(): void {
  for (const [id] of cache) {
    const entry = getTextureEntry(id);
    if (entry) {
      Assets.unload(entry.path);
    }
  }
  cache.clear();
  refCounts.clear();
  // unitCache is self-invalidating (see unitTexture) — nothing to clear here.
}

/**
 * Unified texture resolver — single entry point for all texture lookups.
 * O(1) sync path for render loop hot path. Never returns null.
 *
 * Resolution chain:
 * 1. Pack texture: id contains ':' → AssetPackManager.getTexture()
 * 2. Legacy ID: resolveLegacyId() maps old flat ID → pack format, retry step 1
 * 3. Bundled texture: textureLoader cache (getSync)
 * 4. Fallback: magenta 1x1 (visible missing-texture indicator)
 */
export function resolveTexture(id: string): Texture {
  // 1. Pack texture (contains ':')
  if (id.includes(':')) {
    const packManager = getAssetPackManager();
    return packManager.getTexture(id);
  }

  // 2. Legacy ID mapping (content-trimmed — see applyContentRect)
  const mapped = resolveLegacyId(id);
  if (mapped && mapped !== id) {
    const packManager = getAssetPackManager();
    return applyContentRect(id, mapped, packManager.getTexture(mapped));
  }

  // 3. Bundled texture from existing cache
  const bundled = cache.get(id);
  if (bundled) return bundled;

  // 3b. An imported image. `importImageFile` registers the picture with Pixi
  // under the asset id as its alias and never touches the map above, so without
  // this an image the user just dropped on the map came back magenta.
  const imported = Assets.get<Texture>(id);
  if (imported) return imported;

  // 4. Magenta fallback
  if (!warnedIds.has(id)) {
    warnedIds.add(id);
    console.warn(`[resolveTexture] Missing texture: "${id}" — using magenta fallback`);
  }
  if (!fallbackTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(0, 0, 1, 1);
    fallbackTexture = Texture.from(canvas);
  }
  return fallbackTexture;
}

export interface UnitTexture {
  /** The one tileable unit — the whole resolved texture. */
  texture: Texture;
  /** Unit size in grid cells (GRID_CELL_PX = 200px/cell), for tileScale/uTile math. */
  cellsWide: number;
  cellsHigh: number;
}

// Keyed on id, but validity is keyed on resolved Texture identity (`src`) — resolveTexture
// is deliberately live (pack installs/updates swap the texture an id resolves to), so an
// id-only cache would go stale. release()/reset() don't need to touch this: the next call
// for a released/reset id resolves to a different Texture and naturally misses.
const unitCache = new Map<string, { unit: UnitTexture; src: Texture }>();

/**
 * The single tileable unit for a texture id, plus its true px-per-cell size.
 * Every terrain/floor/water consumer that tiles a texture at "200px = 1 cell"
 * (splat palette, brush preview, floor fill, water banks) goes through this
 * instead of assuming the resolved texture IS the tile. The whole resolved
 * texture is the unit, sized from the manifest's naturalWidth/Height when
 * present, else the resolved texture's own pixel size (pack frames are
 * already cropped to one material, so this is never a whole atlas).
 *
 * Not cached until the texture actually resolves (width > 1) — an id that
 * hasn't loaded yet must not lock in the 1×1 fallback's bogus cell size.
 */
export function unitTexture(id: string): UnitTexture {
  const tex = resolveTexture(id);
  const cached = unitCache.get(id);
  if (cached && cached.src === tex) return cached.unit;
  if (tex.width <= 1) return { texture: tex, cellsWide: 1, cellsHigh: 1 };

  const entry = getTextureEntry(id);
  const pxW = entry?.naturalWidth ?? tex.width;
  const pxH = entry?.naturalHeight ?? tex.height;

  const unit: UnitTexture = { texture: tex, cellsWide: pxW / GRID_CELL_PX, cellsHigh: pxH / GRID_CELL_PX };
  unitCache.set(id, { unit, src: tex });
  return unit;
}

/**
 * Register a document's `customImages` with Pixi under their asset ids — the alias
 * `resolveTexture` step 3b looks them up by. Lives here, next to that step, because
 * every screen that opens a `.mapbuilder` needs it: the editor's own loader and the
 * table, which had no equivalent and drew every imported picture magenta.
 *
 * Must run *before* the document reaches the store: `loadFromFile` builds the scene
 * graph synchronously and resolves each texture as it goes, so an image registered
 * afterwards is already a fallback sprite by the time it arrives.
 *
 * Per-image failures are swallowed — one unreadable picture must not cost the map.
 */
export async function restoreCustomImages(
  customImages: Record<string, string> | undefined,
): Promise<void> {
  // Parallel: N sequential decode round-trips serialized the map-load critical
  // path. Splat bitmaps are not sprite textures — TerrainRenderer owns them.
  await Promise.all(
    Object.entries(customImages ?? {}).map(async ([id, dataUrl]) => {
      if (Assets.cache.has(id) || SPLAT_IMAGE_KEYS.includes(id as (typeof SPLAT_IMAGE_KEYS)[number])) return;
      try {
        await Assets.load({ alias: id, src: dataUrl });
      } catch (err) {
        console.warn('[restoreCustomImages] could not load', id, err);
      }
    }),
  );
}

/**
 * Register one image from binary (session binary asset fetch). Object URL over
 * data URL: no base64 anywhere. `loadParser` is pinned because a blob: URL has
 * no extension for the loader to sniff.
 */
export async function registerImageBlob(id: string, blob: Blob): Promise<void> {
  if (Assets.cache.has(id)) return;
  const url = URL.createObjectURL(blob);
  try {
    await Assets.load({ alias: id, src: url, loadParser: 'loadTextures' });
  } catch (err) {
    console.warn('[registerImageBlob] could not load', id, err);
  } finally {
    // The texture is decoded and uploaded by now — the URL has done its job.
    URL.revokeObjectURL(url);
  }
}

let fallbackTexture: Texture | null = null;
const warnedIds = new Set<string>();
