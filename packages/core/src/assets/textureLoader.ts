import { Assets, Rectangle, Texture } from 'pixi.js';
import { getCatalogEntry, GRID_CELL_PX } from './packCatalog';
import { getAssetPackManager } from '../engine/assetPackInstance';
import { SPLAT_IMAGE_KEYS } from '../engine/terrain/terrainShared';

/**
 * Texture resolution for pack-scoped ids ('<packId>:<entryId>') and imported
 * images. Pack atlases ship untrimmed cells (200px, trimmed:false); the
 * renderer's wall math assumes content-height textures, so entries that carry a
 * manifest contentRect are handed back as a sub-frame into the atlas.
 */

const cache = new Map<string, Texture>();

// Content-trimmed views of pack textures, keyed by entry id. Validity is tied
// to the source Texture identity — a pack reinstall swaps what the id resolves
// to, and the trimmed view must follow.
const trimmedPackCache = new Map<string, { trimmed: Texture; src: Texture }>();

function applyContentRect(id: string, packTex: Texture): Texture {
  const entry = getCatalogEntry(id);
  // Fallback texture is 1x1 — never sub-frame it
  if (!entry?.contentRect || packTex.width <= 1) return packTex;
  const cached = trimmedPackCache.get(id);
  if (cached && cached.src === packTex) return cached.trimmed;
  const { x, y, w, h } = entry.contentRect;
  const f = packTex.frame;
  const trimmed = new Texture({
    source: packTex.source,
    frame: new Rectangle(f.x + x, f.y + y, w, h),
  });
  trimmedPackCache.set(id, { trimmed, src: packTex });
  return trimmed;
}

/**
 * Load a texture by pack id, waiting for the pack install if necessary.
 * Returns Texture.EMPTY (uncached, so a later rebuild can retry) when the pack
 * never delivers — install failed or the entry doesn't exist.
 */
export async function load(textureId: string): Promise<Texture> {
  const cached = cache.get(textureId);
  if (cached) return cached;

  if (!textureId.includes(':')) {
    // Not a pack id — an imported image resolves through Pixi's Assets cache,
    // anything else is unknown.
    try {
      return Assets.get<Texture>(textureId) ?? Texture.EMPTY;
    } catch {
      return Texture.EMPTY;
    }
  }

  // At a cold load the atlas may still be installing/rehydrating — wait for it
  // rather than resolving to the magenta fallback.
  const manager = getAssetPackManager();
  const packTex = manager.getTextureOrNull(textureId) ?? (await manager.waitForTexture(textureId));
  if (!packTex) return Texture.EMPTY;

  const texture = applyContentRect(textureId, packTex);
  cache.set(textureId, texture);
  return texture;
}

/** Get a cached texture synchronously. Returns undefined if not yet loaded. */
export function getSync(textureId: string): Texture | undefined {
  return cache.get(textureId);
}

/** Clear all cached textures. */
export function reset(): void {
  cache.clear();
  trimmedPackCache.clear();
  // unitCache is self-invalidating (see unitTexture) — nothing to clear here.
}

/**
 * Unified texture resolver — single entry point for all texture lookups.
 * O(1) sync path for render loop hot path. Never returns null.
 *
 * Resolution chain:
 * 1. Pack texture: id contains ':' → AssetPackManager, content-trimmed
 * 2. Imported image: Pixi Assets cache (registered by restoreCustomImages)
 * 3. Fallback: magenta 1x1 (visible missing-texture indicator)
 */
export function resolveTexture(id: string): Texture {
  if (id.includes(':') && !id.startsWith('data:') && !id.startsWith('blob:')) {
    const packManager = getAssetPackManager();
    return applyContentRect(id, packManager.getTexture(id));
  }

  const loaded = cache.get(id);
  if (loaded) return loaded;

  // An imported image. `importImageFile` registers the picture with Pixi under
  // the asset id as its alias, so without this an image the user just dropped
  // on the map came back magenta.
  const imported = Assets.get<Texture>(id);
  if (imported) return imported;

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
// id-only cache would go stale. reset() doesn't need to touch this: the next call
// for a reset id resolves to a different Texture and naturally misses.
const unitCache = new Map<string, { unit: UnitTexture; src: Texture }>();

/**
 * The single tileable unit for a texture id, plus its true px-per-cell size.
 * Every terrain/floor/water consumer that tiles a texture at "200px = 1 cell"
 * (splat palette, brush preview, floor fill, water banks) goes through this
 * instead of assuming the resolved texture IS the tile. The whole resolved
 * texture is the unit, sized from the catalog's natural size when present,
 * else the resolved texture's own pixel size (pack frames are already cropped
 * to one material, so this is never a whole atlas).
 *
 * Not cached until the texture actually resolves (width > 1) — an id that
 * hasn't loaded yet must not lock in the 1×1 fallback's bogus cell size.
 */
export function unitTexture(id: string): UnitTexture {
  const tex = resolveTexture(id);
  const cached = unitCache.get(id);
  if (cached && cached.src === tex) return cached.unit;
  if (tex.width <= 1) return { texture: tex, cellsWide: 1, cellsHigh: 1 };

  const entry = getCatalogEntry(id);
  const pxW = entry?.naturalWidth ?? tex.width;
  const pxH = entry?.naturalHeight ?? tex.height;

  const unit: UnitTexture = { texture: tex, cellsWide: pxW / GRID_CELL_PX, cellsHigh: pxH / GRID_CELL_PX };
  unitCache.set(id, { unit, src: tex });
  return unit;
}

/**
 * Register a document's `customImages` with Pixi under their asset ids — the alias
 * `resolveTexture` step 2 looks them up by. Lives here, next to that step, because
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
