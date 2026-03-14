// src/engine/subscribeToAssets.ts
//
// Zustand → PixiJS sync for image layers (PlacedObject sprites).
// Called once from CanvasHost alongside subscribeToStore(); returns a cleanup fn.

import { Assets, Sprite, Texture } from 'pixi.js';
import { useStore } from '@/store/store';
import { getLayerEntry } from './sceneGraph';
import type { ImagesLayer, PlacedObject } from '@/store/types';

/**
 * Apply all transform/style properties from a PlacedObject onto an existing Sprite.
 * Uses width/height for non-uniform scaling when present; falls back to uniform scale
 * for legacy objects loaded from older save files.
 * Note: sprite.width/height setters compute scale relative to the current texture, so
 * this must be called again after a texture swap (async load).
 */
function syncSprite(sprite: Sprite, obj: PlacedObject): void {
  sprite.position.set(obj.position.x, obj.position.y);
  sprite.rotation = obj.rotation;
  if (obj.width && obj.height) {
    sprite.width = obj.width;
    sprite.height = obj.height;
    if (obj.flipX) sprite.scale.x *= -1;
    if (obj.flipY) sprite.scale.y *= -1;
  } else {
    // Fallback for legacy saves without explicit dimensions
    sprite.scale.set(
      obj.scale * (obj.flipX ? -1 : 1),
      obj.scale * (obj.flipY ? -1 : 1),
    );
  }
  sprite.tint = parseInt(obj.tint.replace('#', ''), 16);
}

/**
 * Ensure the asset URL is registered in the PixiJS Assets cache before loading.
 * For data: URLs (custom images) we need to call Assets.add() first if not already known.
 */
function ensureRegistered(assetId: string): void {
  if (!assetId.startsWith('data:')) return;
  try {
    // If the asset is already in the cache this throws or returns something valid —
    // either way, we can skip re-registering.
    const existing = Assets.get<Texture>(assetId);
    if (existing) return;
  } catch {
    // not cached — fall through to register
  }
  try {
    Assets.add({ alias: assetId, src: assetId });
  } catch {
    // Already registered — ignore duplicate-add errors
  }
}

/**
 * Subscribe to image layer changes (PlacedObjects) and sync PixiJS sprites.
 * Called once from CanvasHost. Returns cleanup function.
 */
export function subscribeToAssets(): () => void {
  // Map from layerId → (objectId → Sprite)
  const spriteMaps = new Map<string, Map<string, Sprite>>();

  const unsub = useStore.subscribe(
    (state) =>
      state.layers.filter((l): l is ImagesLayer => l.type === 'images'),
    (imageLayers) => {
      const currentLayerIds = new Set(imageLayers.map((l) => l.id));

      // ── Remove sprite maps for layers that no longer exist ──────────
      for (const [layerId, spriteMap] of spriteMaps.entries()) {
        if (!currentLayerIds.has(layerId)) {
          const entry = getLayerEntry(layerId);
          for (const sprite of spriteMap.values()) {
            entry?.container.removeChild(sprite);
            sprite.destroy();
          }
          spriteMaps.delete(layerId);
        }
      }

      // ── Sync each image layer ────────────────────────────────────────
      for (const layer of imageLayers) {
        const entry = getLayerEntry(layer.id);
        if (!entry) continue; // scene graph not ready yet for this layer

        // Ensure a sprite map exists for this layer
        if (!spriteMaps.has(layer.id)) {
          spriteMaps.set(layer.id, new Map());
        }
        const spriteMap = spriteMaps.get(layer.id)!;
        const currentObjectIds = new Set(layer.objects.map((o) => o.id));

        // Remove sprites for deleted objects
        for (const [objId, sprite] of spriteMap.entries()) {
          if (!currentObjectIds.has(objId)) {
            entry.container.removeChild(sprite);
            sprite.destroy();
            spriteMap.delete(objId);
          }
        }

        // Add / update sprites for current objects
        for (const obj of layer.objects) {
          if (spriteMap.has(obj.id)) {
            // Update existing sprite transform
            const sprite = spriteMap.get(obj.id)!;
            syncSprite(sprite, obj);
          } else {
            // Create new sprite
            const cached = Assets.get<Texture>(obj.assetId);
            const sprite = new Sprite(cached ?? Texture.WHITE);
            sprite.anchor.set(0.5, 0.5);
            sprite.label = 'placed-' + obj.id;
            syncSprite(sprite, obj);
            entry.container.addChild(sprite);
            spriteMap.set(obj.id, sprite);

            // If texture wasn't cached, load it asynchronously
            if (!cached) {
              ensureRegistered(obj.assetId);
              Assets.load<Texture>(obj.assetId)
                .then((tex) => {
                  // Only apply if the sprite still exists in the map
                  if (spriteMap.get(obj.id) === sprite) {
                    sprite.texture = tex;
                    // Re-sync dimensions: width/height setters depend on texture size,
                    // so must be reapplied after the texture changes.
                    syncSprite(sprite, obj);
                  }
                })
                .catch(() => {
                  // Leave WHITE texture as fallback — silently ignore load errors
                });
            }
          }
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
