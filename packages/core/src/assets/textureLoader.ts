import { Assets, Rectangle, Texture } from 'pixi.js';
import { getTextureEntry } from './textureManifest';
import { resolveLegacyId } from '../engine/legacyAssetMapping';
import { getAssetPackManager } from '../engine/assetPackInstance';

/**
 * Thin wrapper around PIXI.Assets with:
 * - Manifest-aware loading (looks up path via textureManifest)
 * - In-memory cache (Map<id, Texture>)
 * - Reference counting: retain(id) / release(id)
 * - Auto-unload when refCount hits 0
 */

const cache = new Map<string, Texture>();
const refCounts = new Map<string, number>();

/** Load a texture by manifest ID. Returns Texture.EMPTY for unknown IDs. */
export async function load(textureId: string): Promise<Texture> {
  const cached = cache.get(textureId);
  if (cached) return cached;

  const entry = getTextureEntry(textureId);
  if (!entry) return Texture.EMPTY;

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

  // 2. Legacy ID mapping
  const mapped = resolveLegacyId(id);
  if (mapped && mapped !== id) {
    const packManager = getAssetPackManager();
    return packManager.getTexture(mapped);
  }

  // 3. Bundled texture from existing cache
  const bundled = cache.get(id);
  if (bundled) return bundled;

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

let fallbackTexture: Texture | null = null;
const warnedIds = new Set<string>();
