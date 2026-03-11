// src/engine/subscribeToAssets.ts
//
// Zustand → PixiJS sync for image layers (PlacedObject sprites).
// Phase 2 extension point — wire PlacedObject → Sprite sync here.
//
// Usage: call subscribeToAssets() in PixiRenderEngine.init() alongside
// subscribeToStore(), return the cleanup and call it in destroy().

/**
 * Subscribe to image layer changes (PlacedObjects) and sync PixiJS sprites.
 * Called once from PixiRenderEngine.init(). Returns cleanup function.
 *
 * @stub Phase 2 — implement when asset-pipeline is ready.
 */
export function subscribeToAssets(): () => void {
  const unsubscribers: (() => void)[] = [];

  // TODO (Phase 2): Wire image layer objects → PixiJS Sprites.
  // 1. Subscribe to layers filter (type === 'images')
  // 2. For each PlacedObject, create/update/destroy a PIXI.Sprite
  // 3. Load texture via Assets.load(obj.assetId)
  // 4. Apply position, rotation, scale, tint, flipX (scaleX = -1 if flipX)

  return () => {
    for (const unsub of unsubscribers) unsub();
  };
}
