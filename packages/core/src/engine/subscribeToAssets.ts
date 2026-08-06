// src/engine/subscribeToAssets.ts
//
// Zustand → PixiJS sync for asset children (AssetChild sprites inside DungeonLayer.children).
// Called once from CanvasHost alongside subscribeToStore(); returns a cleanup fn.

import { Assets, Sprite, Texture } from 'pixi.js';
import { useStore } from '../store/store';
import { getLayerEntry } from './sceneGraph';
import type { AssetChild, DungeonLayer } from '../store/types';
import { getTextureEntry } from '../assets/textureManifest';
import { resolveTexture } from '../assets/textureLoader';

/**
 * Apply all transform/style properties from an AssetChild onto an existing Sprite.
 * Uses width/height for non-uniform scaling.
 * Note: sprite.width/height setters compute scale relative to the current texture, so
 * this must be called again after a texture swap (async load).
 */
function syncSprite(sprite: Sprite, obj: AssetChild): void {
  sprite.visible = obj.visible;
  sprite.position.set(obj.position.x, obj.position.y);
  sprite.rotation = obj.rotation;
  // `scale` multiplies width/height everywhere else (bounds, hit-testing) but
  // was dropped here, so scaling a child grew its gizmo box while the art
  // stayed put. Gizmo resizes write width/height; scale is the legacy multiplier.
  sprite.width = obj.width * obj.scale;
  sprite.height = obj.height * obj.scale;
  if (obj.flipX) sprite.scale.x *= -1;
  if (obj.flipY) sprite.scale.y *= -1;
  sprite.tint = parseInt(obj.tint.replace('#', ''), 16);
}

/**
 * Resolve an AssetChild's assetId to a loadable URL.
 * Manifest-based IDs (e.g. 'fallen-leaves-green1-a1') are resolved to their
 * file path via the texture manifest. Data URLs and plain URLs pass through.
 */
function resolveAssetUrl(assetId: string): string {
  const entry = getTextureEntry(assetId);
  if (entry) return entry.path;
  return assetId;
}

/**
 * Ensure the asset URL is registered in the PixiJS Assets cache before loading.
 * For data: URLs (custom images) we need to call Assets.add() first if not already known.
 * For manifest-based IDs, register with the resolved path as src.
 */
function ensureRegistered(assetId: string, resolvedUrl: string): void {
  try {
    const existing = Assets.get<Texture>(resolvedUrl);
    if (existing) return;
  } catch {
    // not cached — fall through to register
  }
  if (assetId.startsWith('data:') || resolvedUrl !== assetId) {
    try {
      Assets.add({ alias: resolvedUrl, src: resolvedUrl });
    } catch {
      // Already registered — ignore duplicate-add errors
    }
  }
}

/**
 * The assetId a sprite's texture was resolved from. A swap rewrites `assetId`
 * on the same child, and a sprite that only resolved its texture at creation
 * kept the old art until a reload rebuilt it.
 */
const texturedAs = new WeakMap<Sprite, string>();

/** Resolve and assign the child's texture; async-loads uncached custom images. */
function applyTexture(sprite: Sprite, obj: AssetChild, spriteMap: Map<string, Sprite>): void {
  texturedAs.set(sprite, obj.assetId);
  const isCustomImage = obj.assetId.startsWith('data:') || obj.assetId.startsWith('blob:');
  if (!isCustomImage) {
    // Pack, legacy, or bundled texture — sync resolution via unified resolver
    const resolved = resolveTexture(obj.assetId);
    sprite.texture = resolved.width > 0 ? resolved : Texture.WHITE;
    return;
  }
  // Custom user-uploaded images bypass the pack system — use PIXI.Assets async path
  let cached: Texture | undefined;
  try {
    cached = Assets.get<Texture>(obj.assetId);
  } catch {
    cached = undefined;
  }
  sprite.texture = cached ?? Texture.WHITE;
  if (cached) return;
  const url = resolveAssetUrl(obj.assetId);
  ensureRegistered(obj.assetId, url);
  Assets.load<Texture>(url)
    .then((tex) => {
      // Only if this sprite is still live and still showing this asset — a
      // second swap while the load was in flight must not be overwritten.
      if (spriteMap.get(obj.id) === sprite && texturedAs.get(sprite) === obj.assetId) {
        sprite.texture = tex;
        syncSprite(sprite, obj);
      }
    })
    .catch((err: unknown) => {
      // Leave WHITE texture as fallback; surface which asset failed
      console.error(`[assets] texture load failed for "${obj.assetId}":`, err);
    });
}

/**
 * Subscribe to dungeon layer children (AssetChild nodes) and sync PixiJS sprites.
 * Called once from CanvasHost. Returns cleanup function.
 */
export function subscribeToAssets(): () => void {
  // Map from layerId → (childId → Sprite)
  const spriteMaps = new Map<string, Map<string, Sprite>>();

  const unsub = useStore.subscribe(
    (state) =>
      state.layers
        .filter((l): l is DungeonLayer => l.type === 'dungeon')
        .map((l) => ({
          id: l.id,
          assets: l.children.filter((c): c is AssetChild => c.childType === 'asset'),
        })),
    (dungeonLayers) => {
      const currentLayerIds = new Set(dungeonLayers.map((l) => l.id));

      // ── Remove sprite maps for layers that no longer exist ──────────
      for (const [layerId, spriteMap] of spriteMaps.entries()) {
        if (!currentLayerIds.has(layerId)) {
          const entry = getLayerEntry(layerId);
          for (const sprite of spriteMap.values()) {
            entry?.sublayers?.objects.removeChild(sprite);
            sprite.destroy();
          }
          spriteMaps.delete(layerId);
        }
      }

      // ── Sync each dungeon layer's asset children ──────────────────────
      for (const layer of dungeonLayers) {
        const entry = getLayerEntry(layer.id);
        if (!entry?.sublayers) continue; // scene graph not ready yet for this layer
        const objectsLayer = entry.sublayers.objects;

        // Ensure a sprite map exists for this layer
        if (!spriteMaps.has(layer.id)) {
          spriteMaps.set(layer.id, new Map());
        }
        const spriteMap = spriteMaps.get(layer.id)!;
        const currentObjectIds = new Set(layer.assets.map((o) => o.id));

        // Remove sprites for deleted children
        for (const [objId, sprite] of spriteMap.entries()) {
          if (!currentObjectIds.has(objId)) {
            objectsLayer.removeChild(sprite);
            sprite.destroy();
            spriteMap.delete(objId);
          }
        }

        // Add / update sprites for current asset children. Index within
        // `layer.assets` (filter preserves relative order from layer.children)
        // becomes zIndex — objects.sortableChildren draws by it. Shapes/walls
        // stay union-rendered (Clipper2), so no per-child order applies there.
        for (let i = 0; i < layer.assets.length; i++) {
          const obj = layer.assets[i];
          let sprite = spriteMap.get(obj.id);
          if (!sprite) {
            sprite = new Sprite(Texture.WHITE);
            sprite.anchor.set(0.5, 0.5);
            sprite.label = 'placed-' + obj.id;
            spriteMap.set(obj.id, sprite);
            objectsLayer.addChild(sprite);
          }
          // Covers both a fresh sprite and a swapped assetId on an existing
          // one. Texture before syncSprite: the width/height setters compute
          // scale relative to whatever texture the sprite holds.
          if (texturedAs.get(sprite) !== obj.assetId) applyTexture(sprite, obj, spriteMap);
          syncSprite(sprite, obj);
          sprite.zIndex = i;
        }
      }
    },
    { fireImmediately: true },
  );

  return () => {
    unsub();
    // Destroy all tracked sprites on cleanup
    for (const spriteMap of spriteMaps.values()) {
      for (const sprite of spriteMap.values()) {
        sprite.destroy();
      }
    }
    spriteMaps.clear();
  };
}
