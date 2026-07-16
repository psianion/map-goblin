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
  sprite.width = obj.width;
  sprite.height = obj.height;
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
            entry?.container.removeChild(sprite);
            sprite.destroy();
          }
          spriteMaps.delete(layerId);
        }
      }

      // ── Sync each dungeon layer's asset children ──────────────────────
      for (const layer of dungeonLayers) {
        const entry = getLayerEntry(layer.id);
        if (!entry) continue; // scene graph not ready yet for this layer

        // Ensure a sprite map exists for this layer
        if (!spriteMaps.has(layer.id)) {
          spriteMaps.set(layer.id, new Map());
        }
        const spriteMap = spriteMaps.get(layer.id)!;
        const currentObjectIds = new Set(layer.assets.map((o) => o.id));

        // Remove sprites for deleted children
        for (const [objId, sprite] of spriteMap.entries()) {
          if (!currentObjectIds.has(objId)) {
            entry.container.removeChild(sprite);
            sprite.destroy();
            spriteMap.delete(objId);
          }
        }

        // Add / update sprites for current asset children
        for (const obj of layer.assets) {
          if (spriteMap.has(obj.id)) {
            // Update existing sprite transform
            const sprite = spriteMap.get(obj.id)!;
            syncSprite(sprite, obj);
          } else {
            // Create new sprite — try unified resolver first (handles pack + legacy + bundled)
            const isCustomImage = obj.assetId.startsWith('data:') || obj.assetId.startsWith('blob:');
            let initialTexture: Texture;

            if (isCustomImage) {
              // Custom user-uploaded images bypass pack system — use PIXI.Assets async path
              let cached: Texture | undefined;
              try {
                cached = Assets.get<Texture>(obj.assetId);
              } catch {
                cached = undefined;
              }
              initialTexture = cached ?? Texture.WHITE;
            } else {
              // Pack, legacy, or bundled texture — sync resolution via unified resolver
              const resolved = resolveTexture(obj.assetId);
              initialTexture = resolved.width > 0 ? resolved : Texture.WHITE;
            }

            const sprite = new Sprite(initialTexture);
            sprite.anchor.set(0.5, 0.5);
            sprite.label = 'placed-' + obj.id;
            syncSprite(sprite, obj);
            entry.container.addChild(sprite);
            spriteMap.set(obj.id, sprite);

            // Async load only for custom images not yet cached
            if (isCustomImage && initialTexture === Texture.WHITE) {
              const url = resolveAssetUrl(obj.assetId);
              ensureRegistered(obj.assetId, url);
              Assets.load<Texture>(url)
                .then((tex) => {
                  if (spriteMap.get(obj.id) === sprite) {
                    sprite.texture = tex;
                    syncSprite(sprite, obj);
                  }
                })
                .catch((err: unknown) => {
                  // Leave WHITE texture as fallback; surface which asset failed
                  console.error(`[assets] texture load failed for "${obj.assetId}":`, err);
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
