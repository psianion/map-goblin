// src/engine/subscribeToAssets.ts
//
// Zustand → PixiJS sync for asset children (AssetChild sprites inside DungeonLayer.children).
// Called once from CanvasHost alongside subscribeToStore(); returns a cleanup fn.

import { Assets, Sprite, Texture } from 'pixi.js';
import { useStore } from '../store/store';
import { getLayerEntry, getOverheadContainer } from './sceneGraph';
import type { AssetChild } from '../store/types';
import { resolveTexture } from '../assets/textureLoader';
import { syncPropShadows } from './shadowPass';
import { isLayerShown } from '../store/selectors';
import { propField } from '../shared/propFields';
import type { Obb } from './tools/propPlacement';

/** Overhead props while the DM looks under them (`ui.seeUnderOverhead`). */
export const SEE_UNDER_ALPHA = 0.35;

/** Room for a layer's own z-order inside the overhead container, which holds every layer's. */
const LAYER_Z = 1e5;

/**
 * What a sprite carries besides its child's own fields. An overhead sprite lives in the
 * scene graph's overhead container, outside its layer's container, so the layer's
 * visibility and opacity (and the editor's look-under) are folded in here.
 */
interface SpriteLook {
  alpha: number;
  shown: boolean;
}
const looks = new WeakMap<Sprite, SpriteLook>();

/**
 * Transient fades by child id: the band x-ray, an erase stroke, a token under a canopy at
 * the table. Never a field on the child (a cancelled gesture has no command to rewind it).
 */
const fades = new Map<string, number>();

/** Sprite alpha: the child's opacity (with its look) times any fade on it. */
function applyAlpha(sprite: Sprite, childId: string): void {
  sprite.alpha = (looks.get(sprite)?.alpha ?? 1) * (fades.get(childId) ?? 1);
}

/**
 * Apply all transform/style properties from an AssetChild onto an existing Sprite.
 * Uses width/height for non-uniform scaling.
 * Note: sprite.width/height setters compute scale relative to the current texture, so
 * this must be called again after a texture swap (async load).
 */
function syncSprite(sprite: Sprite, obj: AssetChild): void {
  sprite.visible = obj.visible && (looks.get(sprite)?.shown ?? true);
  applyAlpha(sprite, obj.id);
  sprite.position.set(obj.position.x, obj.position.y);
  sprite.rotation = obj.rotation;
  // `scale` multiplies width/height everywhere else (bounds, hit-testing) but
  // was dropped here, so scaling a child grew its gizmo box while the art
  // stayed put. Gizmo resizes write width/height; scale is the legacy multiplier.
  sprite.width = obj.width * obj.scale;
  sprite.height = obj.height * obj.scale;
  // The width/height setters keep the scale's current sign, so a sprite flipped on
  // an earlier sync comes out of them still flipped. The flip is set from the child
  // outright; toggling it here unflipped every mirrored piece on alternate syncs,
  // and every layer update syncs every sprite.
  sprite.scale.x = Math.abs(sprite.scale.x) * (obj.flipX ? -1 : 1);
  sprite.scale.y = Math.abs(sprite.scale.y) * (obj.flipY ? -1 : 1);
  sprite.tint = parseInt(obj.tint.replace('#', ''), 16);
}

/**
 * Ensure a custom-image URL is registered in the PixiJS Assets cache before
 * loading. data: URLs need an Assets.add() first if not already known.
 */
function ensureRegistered(assetId: string): void {
  try {
    const existing = Assets.get<Texture>(assetId);
    if (existing) return;
  } catch {
    // not cached — fall through to register
  }
  if (assetId.startsWith('data:')) {
    try {
      Assets.add({ alias: assetId, src: assetId });
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

/**
 * Have every placed sprite resolve its texture again on the next sync: after a pack is
 * installed or uninstalled, so a prop whose pack went shows the missing-texture
 * placeholder rather than art that is no longer there, and one whose pack came in shows it.
 */
export function refreshAssetTextures(): void {
  for (const spriteMap of spriteMaps.values()) {
    for (const sprite of spriteMap.values()) texturedAs.delete(sprite);
  }
}

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
  ensureRegistered(obj.assetId);
  Assets.load<Texture>(obj.assetId)
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

// Map from layerId → (childId → Sprite). Module-level so an overlay can reach a
// live sprite without the store carrying render state for it — see
// setAssetChildrenAlpha.
const spriteMaps = new Map<string, Map<string, Sprite>>();

/** Overhead children by id, with the child they were last synced from. */
const overhead = new Map<string, { sprite: Sprite; obj: AssetChild }>();

function writeFade(childId: string, alpha: number): void {
  if (alpha === 1) fades.delete(childId);
  else fades.set(childId, alpha);
}

/**
 * Fade or restore placed children, by hand, for the duration of a gesture.
 *
 * Alpha is deliberately NOT a field on the child: the band x-ray fades the rock
 * a drag would replace, and a cancelled drag has no command to rewind, so a
 * persisted alpha would leave translucent stones on the map for good. The fade
 * multiplies the child's own `opacity` and survives store updates mid-gesture;
 * pass 1 to put it back.
 */
export function setAssetChildrenAlpha(
  layerId: string,
  childIds: readonly string[],
  alpha: number,
): void {
  const spriteMap = spriteMaps.get(layerId);
  for (const id of childIds) {
    writeFade(id, alpha);
    const sprite = spriteMap?.get(id);
    if (sprite) applyAlpha(sprite, id);
  }
}

/** Fade one overhead prop (the table, for a token under it); 1 puts it back. Alpha only. */
export function setOverheadFade(childId: string, alpha: number): void {
  writeFade(childId, alpha);
  const entry = overhead.get(childId);
  if (entry) applyAlpha(entry.sprite, childId);
}

/** Every overhead prop on the map: its sprite and the oriented box it covers. */
export function overheadEntries(): { childId: string; sprite: Sprite; obb: Obb }[] {
  return [...overhead.values()].map(({ sprite, obj }) => ({
    childId: obj.id,
    sprite,
    obb: {
      cx: obj.position.x,
      cy: obj.position.y,
      hw: (obj.width * obj.scale) / 2,
      hh: (obj.height * obj.scale) / 2,
      rot: obj.rotation,
    },
  }));
}

function dropSprite(childId: string, sprite: Sprite): void {
  sprite.parent?.removeChild(sprite);
  sprite.destroy();
  overhead.delete(childId);
  fades.delete(childId);
}

/**
 * Subscribe to dungeon layer children (AssetChild nodes) and sync PixiJS sprites.
 * Called once from CanvasHost. Returns cleanup function.
 */
export function subscribeToAssets(): () => void {
  const unsub = useStore.subscribe(
    (state) =>
      state.layers.flatMap((l, index) =>
        l.type === 'dungeon'
          ? [
              {
                id: l.id,
                index,
                shown: isLayerShown(state, l),
                opacity: l.opacity,
                seeUnder: state.ui.seeUnderOverhead,
                assets: l.children.filter((c): c is AssetChild => c.childType === 'asset'),
              },
            ]
          : [],
      ),
    (dungeonLayers) => {
      const currentLayerIds = new Set(dungeonLayers.map((l) => l.id));

      // ── Remove sprite maps for layers that no longer exist ──────────
      for (const [layerId, spriteMap] of spriteMaps.entries()) {
        if (!currentLayerIds.has(layerId)) {
          for (const [id, sprite] of spriteMap) dropSprite(id, sprite);
          spriteMaps.delete(layerId);
        }
      }

      // ── Sync each dungeon layer's asset children ──────────────────────
      for (const layer of dungeonLayers) {
        const entry = getLayerEntry(layer.id);
        if (!entry?.sublayers) continue; // scene graph not ready yet for this layer
        const objectsLayer = entry.sublayers.objects;
        const overheadLayer = getOverheadContainer() ?? objectsLayer;

        // Ensure a sprite map exists for this layer
        if (!spriteMaps.has(layer.id)) {
          spriteMaps.set(layer.id, new Map());
        }
        const spriteMap = spriteMaps.get(layer.id)!;
        const currentObjectIds = new Set(layer.assets.map((o) => o.id));

        // Remove sprites for deleted children
        for (const [objId, sprite] of spriteMap.entries()) {
          if (!currentObjectIds.has(objId)) {
            dropSprite(objId, sprite);
            spriteMap.delete(objId);
          }
        }

        // Add / update sprites for current asset children. Index within
        // `layer.assets` (filter preserves relative order from layer.children)
        // becomes zIndex — objects.sortableChildren draws by it. Shapes/walls
        // stay union-rendered (Clipper2), so no per-child order applies there.
        // Overhead children go to the overhead container instead, above every
        // layer, ordered by layer and then the same index.
        for (let i = 0; i < layer.assets.length; i++) {
          const obj = layer.assets[i];
          let sprite = spriteMap.get(obj.id);
          if (!sprite) {
            sprite = new Sprite(Texture.WHITE);
            sprite.anchor.set(0.5, 0.5);
            sprite.label = 'placed-' + obj.id;
            spriteMap.set(obj.id, sprite);
          }
          const isOverhead = propField(obj, 'overhead');
          const home = isOverhead ? overheadLayer : objectsLayer;
          if (sprite.parent !== home) home.addChild(sprite);
          const opacity = propField(obj, 'opacity');
          looks.set(
            sprite,
            isOverhead
              ? { alpha: opacity * layer.opacity * (layer.seeUnder ? SEE_UNDER_ALPHA : 1), shown: layer.shown }
              : { alpha: opacity, shown: true },
          );
          if (isOverhead) overhead.set(obj.id, { sprite, obj });
          else overhead.delete(obj.id);
          // Covers both a fresh sprite and a swapped assetId on an existing
          // one. Texture before syncSprite: the width/height setters compute
          // scale relative to whatever texture the sprite holds.
          if (texturedAs.get(sprite) !== obj.assetId) applyTexture(sprite, obj, spriteMap);
          syncSprite(sprite, obj);
          sprite.zIndex = isOverhead ? layer.index * LAYER_Z + i : i;
        }

        // P3a — every prop that stands on this layer lays a silhouette down on it. Here rather
        // than in the shadow pass because this is the one loop that knows a child's texture,
        // and it is the same loop on the Table as in the Editor.
        syncPropShadows(
          layer.id,
          layer.assets.map((obj) => ({ sprite: spriteMap.get(obj.id)!, obj })),
        );
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
    overhead.clear();
    fades.clear();
  };
}
